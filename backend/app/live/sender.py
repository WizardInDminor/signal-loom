"""The armed sender: the only code path that calls a transport's ``send``.

Rules, each proven by a test:
- Disarmed by construction; ``arm`` needs the explicit confirmation phrase; nothing re-arms.
- ``dry_run`` resolves messages to endpoints and bytes and never touches the transport.
- ``audition``/``send`` refuse while disarmed, refuse any type but PC/CC, refuse non-deterministic
  (toggle) messages unless the caller confirmed them, and refuse a target whose route for that
  kind is unsupported or unreachable (an *unverified* route is allowed with a warning).
- Messages go out in order from one worker thread with the configured delay; ``stop`` cancels
  what is still queued and says so; ``disarm``/``disconnect`` drop the queue.
- A slider's CC stream is coalesced: a queued, unsent CC for the same device and controller is
  replaced instead of piling up.
- Everything is logged with a monotonic sequence so the UI can poll for what happened.
"""

from __future__ import annotations

import threading
import time
from collections import deque
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

    def as_dict(self) -> dict:
        return {
            "seq": self.seq,
            "at": self.at,
            "kind": self.kind,
            "message": self.message,
            "job_id": self.job_id,
            "resolved": self.resolved.as_dict() if self.resolved else None,
        }


@dataclass
class Queued:
    job_id: str
    index: int
    total: int
    resolved: Resolved
    delay_ms: int
    cancelled: bool = False


@dataclass
class Job:
    id: str
    label: str
    total: int
    sent: int = 0
    failed: int = 0
    cancelled: int = 0
    started_at: str = field(default_factory=utcnow_iso)
    finished_at: str | None = None

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "total": self.total,
            "sent": self.sent,
            "failed": self.failed,
            "cancelled": self.cancelled,
            "pending": max(0, self.total - self.sent - self.failed - self.cancelled),
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "done": self.finished_at is not None,
        }


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
        # last message Signal Loom attempted to send, per device: "last sent", never "device state"
        self.last_sent: dict[str, dict] = {}

    # -- state ------------------------------------------------------------------------
    @property
    def armed(self) -> bool:
        with self._lock:
            return self._armed

    def attach_transport(self, transport: Transport | None) -> None:
        """Changing transport (connect/disconnect/mode switch) always disarms and drops the queue."""
        with self._lock:
            if self._armed or self._queue:
                self._disarm_locked("transport changed")
            self._transport = transport

    def _emit(
        self, kind: LogKind, message: str, job_id: str | None = None, resolved: Resolved | None = None
    ) -> LogEntry:
        with self._lock:
            self._seq += 1
            e = LogEntry(self._seq, utcnow_iso(), kind, message, job_id, resolved)
            self._log.append(e)
            return e

    def log(self, since: int = 0, limit: int = 200) -> list[LogEntry]:
        with self._lock:
            out = [e for e in self._log if e.seq > since]
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

    def status(self) -> dict:
        with self._lock:
            return {
                "armed": self._armed,
                "armed_at": self._armed_at,
                "queue_length": self.queue_length(),
                "seq": self._seq,
                "arm_phrase": ARM_PHRASE,
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
        with self._lock:
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

    def stop(self) -> int:
        """Cancel everything still queued. Transmitted messages are not undone (and this says so)."""
        with self._lock:
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
                if job.sent + job.failed + job.cancelled >= job.total:
                    job.finished_at = utcnow_iso()
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
            with self._lock:
                item = self._queue.popleft() if self._queue else None
                transport = self._transport
                armed = self._armed
            if item is None:
                self._wake.clear()
                self._wake.wait(timeout=0.5)
                continue
            if item.cancelled:
                continue
            r = item.resolved
            job = self._jobs.get(item.job_id)
            if not armed or transport is None:
                with self._lock:
                    item.cancelled = True
                    if job:
                        job.cancelled += 1
                    self._emit("cancelled", f"{r.as_dict()['summary']} not sent: disarmed meanwhile", item.job_id, r)
                continue
            try:
                data = encode(r.type, r.channel, r.number, r.value)
                transport.send(r.endpoint_id or "", data)
                with self._lock:
                    if job:
                        job.sent += 1
                    self.last_sent[r.target_instance_id] = self._merge_last(self.last_sent.get(r.target_instance_id), r)
                    self._emit(
                        "sent",
                        f"{item.index + 1}/{item.total} {r.as_dict()['summary']} → {r.endpoint_name}",
                        item.job_id,
                        r,
                    )
            except (TransportError, ForbiddenMessageError, ValueError) as e:
                with self._lock:
                    if job:
                        job.failed += 1
                    self._emit("failed", f"{r.as_dict()['summary']}: {e}", item.job_id, r)
                    if isinstance(e, TransportError):
                        # A port that vanished mid-audition: stop everything and disarm (no auto re-arm).
                        self._disarm_locked(f"transport error: {e}")
            finally:
                with self._lock:
                    if job and job.sent + job.failed + job.cancelled >= job.total and job.finished_at is None:
                        job.finished_at = utcnow_iso()
            if item.delay_ms and not self._closing:
                time.sleep(item.delay_ms / 1000.0)

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
        with self._lock:
            self._closing = True
            self._disarm_locked("shutdown")
            self._wake.set()
