"""The armed sender: the only code path that calls a transport's ``send``.

Rules, each proven by a test:
- Disarmed by construction; ``arm`` needs the explicit confirmation phrase; nothing re-arms.
- ``dry_run`` resolves messages to endpoints and bytes and never touches the transport.
- ``audition``/``send`` refuse while disarmed, refuse any type but PC/CC, refuse non-deterministic
  (toggle) messages unless the caller confirmed them, refuse a target whose route for that kind is
  unsupported or unreachable, and refuse — *before anything is queued* — a route whose
  prerequisites (Cross MIDI Thru, Omniport mode, a special cable) or unverified hops the user has
  not acknowledged in this connection session.
- Messages go out in order from one worker thread with the configured delay; ``stop`` cancels
  what is still queued and says so; ``disarm``/``disconnect`` drop the queue.
- **In-flight semantics.** A message is dequeued, checked against ``armed`` and handed to the
  transport while the sender's lock is held. ``disarm``, ``stop``, ``attach_transport`` and
  ``close`` take the same lock, so they cannot return while a send is in flight, and no send can
  *begin* after any of them has returned. The one message already handed to the driver completes
  (its bytes are gone) and is logged as sent; everything behind it is cancelled.
- A slider's CC stream is coalesced: a queued, unsent CC for the same device and controller is
  replaced instead of piling up.
- **Streaming (Session 5).** The performance engine hands values over one at a time through
  ``stream_one`` under one long-lived job: the same lock, armed check, route check and coalescing
  apply, no "queued" log line is written per value, and ``cancel_job`` (a control call) drops what
  is queued for that job and finishes it so nothing of it can be enqueued afterwards. The sender
  tells registered ``on_disarm`` hooks about every disarm from inside the critical section, so a
  running performance learns about it before the next message could possibly begin.
- Everything is logged with a monotonic sequence so the UI can poll for what happened.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Literal

from ..models.rig import utcnow_iso
from .transport import ALLOWED_OUTPUT_TYPES, ForbiddenMessageError, Transport, TransportError, encode

ARM_PHRASE = "send MIDI to my rig"

LogKind = Literal["armed", "disarmed", "queued", "sent", "failed", "cancelled", "stopped", "refused", "note"]


class LiveRefused(Exception):
    """A request that the safety rules refuse; carries a code for the API."""

    def __init__(self, code: str, message: str, detail: dict | None = None):
        super().__init__(message)
        self.code = code
        self.detail = detail or {}


@dataclass
class Resolved:
    """A compiled/user message resolved to a concrete endpoint and byte string (dry run output)."""

    type: str
    channel: int
    number: int
    value: int | None
    target_instance_id: str
    target_label: str
    endpoint_id: str | None
    endpoint_name: str | None
    data: bytes
    route_status: str  # supported | unverified | unsupported | unreachable
    route_evidence: str | None
    route_reason: str
    deterministic: bool
    explanation: str
    source_kind: str
    coalesce_key: str | None = None
    # What the user must acknowledge once per connection session before this goes out: the route's
    # hardware prerequisites and, for an unverified route, the undocumented hop.
    needs_ack: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "type": self.type,
            "channel": self.channel,
            "number": self.number,
            "value": self.value,
            "target_instance_id": self.target_instance_id,
            "target_label": self.target_label,
            "endpoint_id": self.endpoint_id,
            "endpoint_name": self.endpoint_name,
            "hex": self.data.hex(" ").upper(),
            "route_status": self.route_status,
            "route_evidence": self.route_evidence,
            "route_reason": self.route_reason,
            "deterministic": self.deterministic,
            "explanation": self.explanation,
            "source_kind": self.source_kind,
            "needs_ack": list(self.needs_ack),
            "summary": (f"PC {self.number}" if self.type == "pc" else f"CC {self.number} = {self.value}")
            + f" ch {self.channel} → {self.target_label}",
        }


@dataclass
class LogEntry:
    seq: int
    at: str
    kind: LogKind
    message: str
    job_id: str | None = None
    resolved: Resolved | None = None
    rig_id: str | None = None

    def as_dict(self) -> dict:
        return {
            "seq": self.seq,
            "at": self.at,
            "kind": self.kind,
            "message": self.message,
            "job_id": self.job_id,
            "resolved": self.resolved.as_dict() if self.resolved else None,
            "rig_id": self.rig_id,
        }


@dataclass
class Queued:
    job_id: str
    index: int
    total: int
    resolved: Resolved
    delay_ms: int
    cancelled: bool = False
    # A streamed (performance) value: logged tersely, never with a per-value "queued" entry.
    quiet: bool = False


@dataclass
class Job:
    id: str
    label: str
    total: int
    sent: int = 0
    failed: int = 0
    cancelled: int = 0
    coalesced: int = 0
    started_at: str = field(default_factory=utcnow_iso)
    finished_at: str | None = None
    # A streaming job grows while it runs and is finished explicitly (``cancel_job``), not when its
    # count is reached.
    streaming: bool = False

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "total": self.total,
            "sent": self.sent,
            "failed": self.failed,
            "cancelled": self.cancelled,
            "coalesced": self.coalesced,
            "pending": max(0, self.total - self.sent - self.failed - self.cancelled),
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "done": self.finished_at is not None,
            "streaming": self.streaming,
        }

    def _maybe_finish(self) -> None:
        if not self.streaming and self.sent + self.failed + self.cancelled >= self.total and self.finished_at is None:
            self.finished_at = utcnow_iso()


class LiveSender:
    LOG_LIMIT = 1000

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._armed = False
        self._armed_at: str | None = None
        self._transport: Transport | None = None
        self._queue: deque[Queued] = deque()
        self._log: deque[LogEntry] = deque(maxlen=self.LOG_LIMIT)
        self._seq = 0
        self._jobs: dict[str, Job] = {}
        self._job_counter = 0
        self._wake = threading.Event()
        self._worker: threading.Thread | None = None
        self._closing = False
        self._in_flight: Queued | None = None
        # Control calls (disarm, stop, attach, close) announce themselves before taking the lock, and
        # the worker yields to them between messages, so a control call never waits behind more
        # than the one message already in flight — whatever the lock's fairness.
        self._ctl_lock = threading.Lock()
        self._ctl_waiting = 0
        self._ctl_free = threading.Event()
        self._ctl_free.set()
        # Route prerequisites / unverified hops the user acknowledged in this connection session.
        self._acknowledged: set[str] = set()
        # Called (inside the disarm critical section, lock held) with the reason on every disarm.
        # Hooks must not block or take locks that a sender caller may hold.
        self._on_disarm: list[Callable[[str], None]] = []
        # last message Signal Loom attempted to send, per device: "last sent", never "device state"
        self.last_sent: dict[str, dict] = {}
        # The rig the sender currently works for; stamped on every log entry so a rig page shows
        # its own history only. Set by the service on connect, cleared on disconnect.
        self.rig_id: str | None = None

    # -- state ------------------------------------------------------------------------
    @property
    def armed(self) -> bool:
        return self._armed  # lock-free read: callers that need a consistent view hold the lock themselves

    @property
    def in_flight(self) -> Queued | None:
        # Lock-free on purpose: readable while a send holds the lock (reading a reference is atomic).
        return self._in_flight

    @contextmanager
    def hold_worker(self) -> Iterator[None]:
        """Announce a pending control action: the worker finishes the message in flight (if any)
        and then waits between messages until the block exits. Takes no lock itself, so a caller
        may acquire other locks (the service's) inside without losing its priority."""
        with self._ctl_lock:
            self._ctl_waiting += 1
            self._ctl_free.clear()
        try:
            yield
        finally:
            with self._ctl_lock:
                self._ctl_waiting -= 1
                if self._ctl_waiting == 0:
                    self._ctl_free.set()

    @contextmanager
    def _control(self) -> Iterator[None]:
        """Take the sender lock with priority over the worker's next message."""
        with self.hold_worker(), self._lock:
            yield

    def attach_transport(self, transport: Transport | None) -> None:
        """Changing transport (connect/disconnect/mode switch) always disarms, drops the queue and
        forgets the session's acknowledgements. Blocks while a send is in flight."""
        with self._control():
            if self._armed or self._queue:
                self._disarm_locked("transport changed")
            self._transport = transport
            self._acknowledged.clear()

    def _emit(
        self, kind: LogKind, message: str, job_id: str | None = None, resolved: Resolved | None = None
    ) -> LogEntry:
        with self._lock:
            self._seq += 1
            e = LogEntry(self._seq, utcnow_iso(), kind, message, job_id, resolved, self.rig_id)
            self._log.append(e)
            return e

    def log(self, since: int = 0, limit: int = 200, rig_id: str | None = None) -> list[LogEntry]:
        with self._lock:
            out = [e for e in self._log if e.seq > since and (rig_id is None or e.rig_id == rig_id)]
            return out[-limit:]

    @property
    def seq(self) -> int:
        with self._lock:
            return self._seq

    def jobs(self) -> list[Job]:
        with self._lock:
            return list(self._jobs.values())[-20:]

    def queue_length(self) -> int:
        with self._lock:
            return sum(1 for q in self._queue if not q.cancelled)

    def pending_discrete(self) -> int:
        """Queued audition/panel messages (streamed performance values excluded)."""
        with self._lock:
            return sum(1 for q in self._queue if not q.cancelled and not q.quiet)

    def status(self) -> dict:
        with self._lock:
            return {
                "armed": self._armed,
                "armed_at": self._armed_at,
                "queue_length": self.queue_length(),
                "in_flight": self._in_flight.resolved.as_dict()["summary"] if self._in_flight else None,
                "seq": self._seq,
                "arm_phrase": ARM_PHRASE,
                "acknowledged": sorted(self._acknowledged),
                "jobs": [j.as_dict() for j in self.jobs()],
            }

    # -- arming -----------------------------------------------------------------------
    def arm(self, confirm: str) -> None:
        with self._lock:
            if self._transport is None:
                raise LiveRefused("live.not_connected", "Connect a rig to a transport before arming.")
            if confirm.strip().casefold() != ARM_PHRASE.casefold():
                raise LiveRefused(
                    "live.confirm_required",
                    f"Arming needs the confirmation phrase '{ARM_PHRASE}'. Nothing is sent while disarmed.",
                    {"arm_phrase": ARM_PHRASE},
                )
            if self._armed:
                return
            self._armed = True
            self._armed_at = utcnow_iso()
            self._emit(
                "armed", "Armed by the user. Auditions and panel sends may now transmit PC/CC to bound endpoints."
            )

    def disarm(self, reason: str = "user") -> None:
        """Returns only once no send is in flight; after it returns no send can begin."""
        with self._control():
            self._disarm_locked(reason)

    def _disarm_locked(self, reason: str) -> None:
        dropped = self._cancel_queue_locked()
        was = self._armed
        self._armed = False
        self._armed_at = None
        if was or dropped:
            self._emit(
                "disarmed",
                f"Disarmed ({reason}). {dropped} queued message(s) dropped; already transmitted messages are not undone.",
            )
        for hook in list(self._on_disarm):
            try:
                hook(reason)
            except Exception as e:  # pragma: no cover - a hook must never break a disarm
                self._emit("note", f"disarm hook failed: {e}")

    def on_disarm(self, hook: Callable[[str], None]) -> None:
        """Register a non-blocking callback told the reason of every disarm (performance engine)."""
        with self._lock:
            self._on_disarm.append(hook)

    def acknowledge(self, items: list[str]) -> None:
        with self._lock:
            self._acknowledged.update(i for i in items if i)

    @property
    def acknowledged(self) -> set[str]:
        with self._lock:
            return set(self._acknowledged)

    # -- dry run ----------------------------------------------------------------------
    @staticmethod
    def dry_run(resolved: list[Resolved]) -> list[dict]:
        """Pure: returns the resolved list; by construction there is no transport call here."""
        return [r.as_dict() for r in resolved]

    # -- sending ----------------------------------------------------------------------
    def _check_allowed(self, resolved: list[Resolved], confirm_nondeterministic: bool) -> list[str]:
        warnings: list[str] = []
        if not self._armed:
            raise LiveRefused(
                "live.disarmed", "Signal Loom is disarmed: nothing is transmitted. Arm it explicitly to audition."
            )
        if self._transport is None:
            raise LiveRefused("live.not_connected", "No transport is connected.")
        for r in resolved:
            if r.type not in ALLOWED_OUTPUT_TYPES:
                raise LiveRefused(
                    "live.message_type_forbidden",
                    f"'{r.type}' messages are not allowed; only PC and CC are transmitted.",
                )
            if r.route_status in ("unsupported", "unreachable") or r.endpoint_id is None:
                raise LiveRefused(
                    "live.route_unavailable",
                    f"'{r.target_label}': {r.type.upper()} route is {r.route_status} — {r.route_reason}",
                    {"target_instance_id": r.target_instance_id, "kind": r.type},
                )
        # Prerequisites and unverified hops: acknowledged once per connection session, before
        # anything is queued. The list is specific (which setting, which hop, which device).
        pending: list[str] = []
        for r in resolved:
            for item in r.needs_ack:
                if item not in self._acknowledged and item not in pending:
                    pending.append(item)
        if pending:
            raise LiveRefused(
                "live.confirm_route",
                "Before the first send over these routes, confirm that the hardware prerequisites are set and that "
                "you accept the unverified hops. Nothing has been queued.",
                {
                    "items": pending,
                    "messages": [r.as_dict() for r in resolved if any(i in pending for i in r.needs_ack)],
                },
            )
        for r in resolved:
            if r.route_status == "unverified":
                warnings.append(
                    f"'{r.target_label}': the route is unverified ({r.route_reason}); the message is sent, arrival is not known."
                )
        toggles = [r for r in resolved if not r.deterministic]
        if toggles and not confirm_nondeterministic:
            raise LiveRefused(
                "live.confirm_nondeterministic",
                "Some messages are toggles or have state-dependent effects; confirm explicitly before sending them.",
                {"messages": [t.as_dict() for t in toggles]},
            )
        return warnings

    def audition(
        self, label: str, resolved: list[Resolved], delay_ms: int, confirm_nondeterministic: bool = False
    ) -> tuple[Job, list[str]]:
        with self._lock:
            warnings = self._check_allowed(resolved, confirm_nondeterministic)
            self._job_counter += 1
            job = Job(id=f"job_{self._job_counter}", label=label, total=len(resolved))
            self._jobs[job.id] = job
            for i, r in enumerate(resolved):
                self._queue.append(Queued(job.id, i, len(resolved), r, delay_ms))
                self._emit("queued", f"{i + 1}/{len(resolved)} {r.as_dict()['summary']}", job.id, r)
            if not resolved:
                job.finished_at = utcnow_iso()
            self._ensure_worker()
            return job, warnings

    def send_one(
        self, resolved: Resolved, confirm_nondeterministic: bool = False, coalesce: bool = False
    ) -> tuple[Job, list[str]]:
        """A panel control: one message, optionally coalesced with a queued unsent one for the
        same device/controller (slider drags), so the queue never grows beyond the newest value."""
        with self._lock:
            warnings = self._check_allowed([resolved], confirm_nondeterministic)
            if coalesce and resolved.coalesce_key:
                for q in self._queue:
                    if not q.cancelled and q.resolved.coalesce_key == resolved.coalesce_key:
                        q.resolved = resolved
                        self._emit("note", f"coalesced into queued {resolved.as_dict()['summary']}", q.job_id, resolved)
                        return self._jobs[q.job_id], warnings
            self._job_counter += 1
            job = Job(id=f"job_{self._job_counter}", label=f"send {resolved.as_dict()['summary']}", total=1)
            self._jobs[job.id] = job
            self._queue.append(Queued(job.id, 0, 1, resolved, 0))
            self._emit("queued", resolved.as_dict()["summary"], job.id, resolved)
            self._ensure_worker()
            return job, warnings

    # -- streaming (performance engine) ------------------------------------------------------
    def open_stream(self, label: str) -> Job:
        """A long-lived job for a performance. Values are handed over one at a time with
        ``stream_one``; ``cancel_job`` ends it."""
        with self._lock:
            self._job_counter += 1
            job = Job(id=f"job_{self._job_counter}", label=label, total=0, streaming=True)
            self._jobs[job.id] = job
            return job

    def stream_one(self, job_id: str, resolved: Resolved) -> str:
        """Hand one performance value to the queue. Returns "queued" or "coalesced". Refuses (raises
        ``LiveRefused``) while disarmed, for an unavailable route, an unacknowledged route, a
        non-deterministic message, or once the job has been finished — so nothing can be enqueued
        after ``cancel_job`` returned."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.finished_at is not None:
                raise LiveRefused("live.stream_closed", "This performance has ended; nothing more is queued for it.")
            self._check_allowed([resolved], confirm_nondeterministic=False)
            if resolved.coalesce_key:
                for q in self._queue:
                    if not q.cancelled and q.job_id == job_id and q.resolved.coalesce_key == resolved.coalesce_key:
                        q.resolved = resolved  # newest value wins; the queue never grows per destination
                        job.coalesced += 1
                        return "coalesced"
            job.total += 1
            self._queue.append(Queued(job_id, job.total - 1, job.total, resolved, 0, quiet=True))
            self._ensure_worker()
            return "queued"

    def cancel_job(self, job_id: str, reason: str) -> int:
        """Finish a streaming job: drop what it still has queued (logged), mark it finished so no
        later ``stream_one`` can add to it. A control call: returns only once no send is in flight."""
        with self._control():
            job = self._jobs.get(job_id)
            if job is None:
                return 0
            n = 0
            kept: deque[Queued] = deque()
            while self._queue:
                q = self._queue.popleft()
                if q.job_id != job_id or q.cancelled:
                    kept.append(q)
                    continue
                q.cancelled = True
                job.cancelled += 1
                n += 1
                self._emit("cancelled", f"{q.resolved.as_dict()['summary']} cancelled ({reason})", job_id, q.resolved)
            self._queue = kept
            if job.finished_at is None:
                job.finished_at = utcnow_iso()
            return n

    def stop(self) -> int:
        """Cancel everything still queued. Returns only once no send is in flight; transmitted
        messages are not undone (and the log says so)."""
        with self._control():
            n = self._cancel_queue_locked()
            self._emit(
                "stopped",
                f"Stop pressed: {n} queued message(s) cancelled. Messages already transmitted are not undone.",
            )
            return n

    def _cancel_queue_locked(self) -> int:
        n = 0
        while self._queue:
            q = self._queue.popleft()
            if q.cancelled:
                continue
            q.cancelled = True
            n += 1
            job = self._jobs.get(q.job_id)
            if job:
                job.cancelled += 1
                self._emit(
                    "cancelled",
                    f"{q.index + 1}/{q.total} {q.resolved.as_dict()['summary']} cancelled",
                    q.job_id,
                    q.resolved,
                )
                job._maybe_finish()
        return n

    # -- worker -----------------------------------------------------------------------
    def _ensure_worker(self) -> None:
        if self._worker is None or not self._worker.is_alive():
            self._closing = False
            self._worker = threading.Thread(target=self._run, name="signal-loom-midi-sender", daemon=True)
            self._worker.start()
        self._wake.set()

    def _run(self) -> None:
        while not self._closing:
            delay_ms = 0
            if not self._ctl_free.wait(timeout=0.5):
                continue  # a control call is waiting for the lock: let it go first
            with self._lock:
                item = self._queue.popleft() if self._queue else None
                if item is not None and not item.cancelled:
                    delay_ms = self._send_locked(item)
            if item is None:
                self._wake.clear()
                self._wake.wait(timeout=0.5)
                continue
            if delay_ms and not self._closing:
                time.sleep(delay_ms / 1000.0)  # outside the lock: Stop/disarm never wait on a delay

    def _send_locked(self, item: Queued) -> int:
        """Dequeue-check-send as one critical section. Returns the delay to honour afterwards."""
        r = item.resolved
        job = self._jobs.get(item.job_id)
        if not self._armed or self._transport is None or (job is not None and job.finished_at is not None):
            item.cancelled = True
            if job:
                job.cancelled += 1
                job._maybe_finish()
            why = "disarmed meanwhile" if not self._armed or self._transport is None else "its job already ended"
            self._emit("cancelled", f"{r.as_dict()['summary']} not sent: {why}", item.job_id, r)
            return 0
        self._in_flight = item
        try:
            data = encode(r.type, r.channel, r.number, r.value)
            self._transport.send(r.endpoint_id or "", data)
            if job:
                job.sent += 1
            self.last_sent[r.target_instance_id] = self._merge_last(self.last_sent.get(r.target_instance_id), r)
            if item.quiet:
                self._emit("sent", f"performance {r.as_dict()['summary']} → {r.endpoint_name}", item.job_id, r)
            else:
                self._emit(
                    "sent",
                    f"{item.index + 1}/{item.total} {r.as_dict()['summary']} → {r.endpoint_name}",
                    item.job_id,
                    r,
                )
        except (TransportError, ForbiddenMessageError, ValueError) as e:
            if job:
                job.failed += 1
            self._emit("failed", f"{r.as_dict()['summary']}: {e}", item.job_id, r)
            if isinstance(e, TransportError):
                # A port that vanished mid-audition: stop everything and disarm (no auto re-arm).
                self._disarm_locked(f"transport error: {e}")
        finally:
            self._in_flight = None
            if job:
                job._maybe_finish()
        return item.delay_ms

    @staticmethod
    def _merge_last(prev: dict | None, r: Resolved) -> dict:
        cur = dict(prev or {"program": None, "bank_msb": None, "bank_lsb": None, "cc": {}, "at": None})
        cur["cc"] = dict(cur.get("cc") or {})
        if r.type == "pc":
            cur["program"] = r.number
        elif r.number == 0:
            cur["bank_msb"] = r.value
        elif r.number == 32:
            cur["bank_lsb"] = r.value
        else:
            cur["cc"][str(r.number)] = {"value": r.value, "source_kind": r.source_kind, "at": utcnow_iso()}
        cur["at"] = utcnow_iso()
        cur["last"] = r.as_dict()["summary"]
        return cur

    def close(self) -> None:
        with self._control():
            self._closing = True
            self._disarm_locked("shutdown")
            self._wake.set()
