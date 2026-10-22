"""The bounded performance engine (Session 5): streams a texture's macro → CC values to the
Session 4 sender under explicit Start/Stop, a renewable lease and a documented message budget.

What it never does: start on its own (loading a rig, opening a tab, selecting a texture, editing a
macro, changing BPM, previewing, saving, reloading, arming or reconnecting start nothing); send
through anything but ``LiveSender``; queue ahead of time; survive a disarm; outlive its lease.

Timing is the backend's monotonic clock through a ``Clock`` abstraction (tests inject a fake and
step it). A tick every ``tick_s`` (100 ms) evaluates every destination from the pure evaluator and
hands at most ``max_per_tick`` changed values (2 → 20 msg/s aggregate) to the sender, at most one
per destination per tick (10 msg/s per destination). Unchanged seven-bit values are deduplicated;
values the budget cannot carry this tick are *not* queued but recomputed next tick from the newest
state (``deferred``), starting at a rotating index so no destination starves. The sender coalesces
per device/CC, so the queue never holds more than one message per destination.

Stop paths — Stop button, lease expiry, any sender disarm (user, bindings/transport change, lost or
ambiguous endpoint, enumeration failure, transport error, shutdown) — cancel what is queued for the
performance and finish its job, after which ``stream_one`` refuses; the one message already handed
to the driver completes. ``stop()`` returns only after that, and after the tick thread has exited.
"""

from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass, field, replace
from typing import Literal, Protocol

from ..instrument.evaluator import EvaluationError, evaluate_macro, period_s, phase_at
from ..models.rig import utcnow_iso
from ..models.texture import Macro, Texture
from .sender import LiveRefused, LiveSender, Resolved
from .transport import encode

State = Literal["idle", "performing", "stopped", "fault"]


class Clock(Protocol):
    def monotonic(self) -> float: ...
    def wait(self, timeout: float) -> None: ...  # sleep up to ``timeout``; may return early when woken
    def wake(self) -> None: ...


class RealClock:
    def __init__(self) -> None:
        self._ev = threading.Event()

    def monotonic(self) -> float:
        return time.monotonic()

    def wait(self, timeout: float) -> None:
        self._ev.wait(timeout)
        self._ev.clear()

    def wake(self) -> None:
        self._ev.set()


class FakeClock:
    """A clock tests step by hand. ``wait`` blocks until time passes the deadline or ``wake``."""

    def __init__(self, start: float = 1000.0) -> None:
        self._now = start
        self._cv = threading.Condition()
        self._woken = False

    def monotonic(self) -> float:
        with self._cv:
            return self._now

    def advance(self, dt: float) -> None:
        with self._cv:
            self._now += dt
            self._cv.notify_all()

    def wait(self, timeout: float) -> None:
        with self._cv:
            deadline = self._now + timeout
            while self._now < deadline and not self._woken:
                self._cv.wait(timeout=0.5)
            self._woken = False

    def wake(self) -> None:
        with self._cv:
            self._woken = True
            self._cv.notify_all()


@dataclass
class Destination:
    mapping_id: str
    macro_id: str
    instance_id: str
    label: str
    cc: int
    output_min: int
    output_max: int
    template: Resolved  # resolved route for this device's CC; value and bytes are replaced per send
    last_value: int | None = None  # last value handed to the sender ("last commanded", not pedal state)
    last_at: float | None = None
    handed: int = 0

    def as_dict(self) -> dict:
        return {
            "mapping_id": self.mapping_id,
            "macro_id": self.macro_id,
            "instance_id": self.instance_id,
            "label": self.label,
            "cc": self.cc,
            "channel": self.template.channel,
            "output_min": self.output_min,
            "output_max": self.output_max,
            "endpoint_name": self.template.endpoint_name,
            "route_status": self.template.route_status,
            "last_commanded": self.last_value,
            "handed": self.handed,
        }


@dataclass
class MacroRuntime:
    """The live copy of a macro's parameters. Editing it never writes the rig document."""

    macro: Macro
    base: float
    phase0: float = 0.0
    t0: float = 0.0
    # Last evaluation, for the UI.
    phase: float = 0.0
    lfo: float = 0.0
    effective: float = 0.0

    def as_dict(self) -> dict:
        return {
            "macro_id": self.macro.id,
            "name": self.macro.name,
            "base": self.base,
            "lfo_enabled": self.macro.lfo.enabled,
            "depth": self.macro.lfo.depth,
            "beats_per_cycle": self.macro.lfo.beats_per_cycle,
            "phase": self.phase,
            "lfo": self.lfo,
            "effective": self.effective,
        }


@dataclass
class Counters:
    ticks: int = 0
    evaluations: int = 0
    planned: int = 0  # values that differed from the last commanded one
    handed: int = 0  # handed to the sender (queued or coalesced there)
    deduplicated: int = 0  # unchanged seven-bit values skipped
    deferred: int = 0  # changed values the budget postponed (recomputed next tick, never queued)
    refused: int = 0  # the sender refused (disarmed, route) → fault

    def as_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class Session:
    rig_id: str
    texture_id: str
    texture_name: str
    controller_id: str
    job_id: str
    started_at: str
    started_mono: float
    tempo_bpm: float
    macros: dict[str, MacroRuntime]
    destinations: list[Destination]
    lease_deadline: float
    heartbeats: int = 0
    stopped_at: str | None = None
    stop_reason: str | None = None
    stopped_by: str | None = None
    counters: Counters = field(default_factory=Counters)


class PerformanceEngine:
    DEFAULT_TICK_S = 0.1
    DEFAULT_MAX_PER_TICK = 2  # 2 per 100 ms = 20 msg/s aggregate; one per destination per tick = 10/s each
    DEFAULT_LEASE_S = 5.0

    def __init__(
        self,
        sender: LiveSender,
        clock: Clock | None = None,
        *,
        lease_s: float = DEFAULT_LEASE_S,
        tick_s: float = DEFAULT_TICK_S,
        max_per_tick: int = DEFAULT_MAX_PER_TICK,
        run_thread: bool = True,
    ) -> None:
        self.sender = sender
        self.clock: Clock = clock or RealClock()
        self.lease_s = float(lease_s)
        self.tick_s = float(tick_s)
        self.max_per_tick = int(max_per_tick)
        self.run_thread = run_thread
        self._lock = threading.RLock()
        self.state: State = "idle"
        self.session: Session | None = None
        self.last: Session | None = None  # the previous session, for the "stopped" report
        self._thread: threading.Thread | None = None
        self._stop_request: tuple[str, str] | None = None  # (reason, by) set lock-free by the disarm hook
        self._stop_flag = threading.Event()
        self._rr = 0
        self._closing = False
        sender.on_disarm(self._on_sender_disarm)

    # -- hooks --------------------------------------------------------------------------
    def _on_sender_disarm(self, reason: str) -> None:
        """Called inside the sender's disarm critical section: record only, take no engine lock.
        The sender has already dropped the queue; the next tick (or status call) finalises."""
        if self.state == "performing":
            self._stop_request = (f"disarmed: {reason}", "sender")
            self._stop_flag.set()
            self.clock.wake()

    # -- lifecycle ---------------------------------------------------------------------
    @property
    def performing(self) -> bool:
        return self.state == "performing" and not self._stop_flag.is_set()

    def start(self, rig_id: str, texture: Texture, destinations: list[Destination], *, by: str = "user") -> Session:
        """Begin streaming. The service has already proven: connected, armed, no pending discrete
        sends, every destination eligible, routed to an open endpoint and acknowledged."""
        with self._lock:
            self._apply_pending_stop_locked()
            if self.state == "performing":
                raise LiveRefused(
                    "live.already_performing",
                    f"A performance of '{self.session.texture_name if self.session else '?'}' is running; stop it first.",
                )
            if not self.sender.armed:
                raise LiveRefused("live.disarmed", "Arm first: a performance never starts while disarmed.")
            if not destinations:
                raise LiveRefused(
                    "live.no_destinations", "This texture has no eligible, enabled destination to perform."
                )
            now = self.clock.monotonic()
            macros: dict[str, MacroRuntime] = {}
            for m in texture.macros:
                rt = MacroRuntime(macro=m.model_copy(deep=True), base=m.base, phase0=0.0, t0=now)
                macros[m.id] = rt
            job = self.sender.open_stream(f"performance '{texture.name}'")
            self.session = Session(
                rig_id=rig_id,
                texture_id=texture.id,
                texture_name=texture.name,
                controller_id=secrets.token_urlsafe(12),
                job_id=job.id,
                started_at=utcnow_iso(),
                started_mono=now,
                tempo_bpm=texture.tempo_bpm,
                macros=macros,
                destinations=list(destinations),
                lease_deadline=now + self.lease_s,
            )
            self.state = "performing"
            self._stop_request = None
            self._stop_flag.clear()
            self._rr = 0
            self.sender._emit(
                "note",
                f"PERFORMING '{texture.name}': {len(destinations)} destination(s), budget {self.max_per_tick}/{self.tick_s:g}s "
                f"aggregate and 1/{self.tick_s:g}s per destination, lease {self.lease_s:g}s. Started by the user; stops on Stop, lease expiry or any disarm.",
            )
            if self.run_thread:
                self._thread = threading.Thread(target=self._run, name="signal-loom-performance", daemon=True)
                self._thread.start()
            return self.session

    def heartbeat(self, controller_id: str) -> dict:
        with self._lock:
            self._apply_pending_stop_locked()
            s = self._require_controller(controller_id)
            s.lease_deadline = self.clock.monotonic() + self.lease_s
            s.heartbeats += 1
            return self.status()

    def set_params(
        self,
        controller_id: str,
        *,
        tempo_bpm: float | None = None,
        macros: dict[str, dict] | None = None,
    ) -> dict:
        """Live parameter changes from the controlling browser. A tempo or division change freezes
        the current phase as the new origin so the waveform continues instead of jumping."""
        with self._lock:
            self._apply_pending_stop_locked()
            s = self._require_controller(controller_id)
            now = self.clock.monotonic()
            if tempo_bpm is not None:
                try:
                    period_s(tempo_bpm, 1.0)
                except EvaluationError as e:
                    raise LiveRefused("live.invalid_param", str(e)) from e
                if tempo_bpm != s.tempo_bpm:
                    for rt in s.macros.values():
                        self._freeze_phase(rt, s.tempo_bpm, now)
                    s.tempo_bpm = float(tempo_bpm)
            for mid, p in (macros or {}).items():
                rt = s.macros.get(mid)
                if rt is None:
                    raise LiveRefused("live.invalid_param", f"Macro '{mid}' is not part of this performance.")
                try:
                    if "base" in p and p["base"] is not None:
                        rt.base = float(Macro(name="x", base=p["base"]).base)
                    lfo = rt.macro.lfo
                    changes = {}
                    for k in ("enabled", "depth", "beats_per_cycle"):
                        if k in p and p[k] is not None:
                            changes[k] = p[k]
                    if changes:
                        new_lfo = lfo.model_copy(update=changes)
                        if new_lfo.beats_per_cycle != lfo.beats_per_cycle or (new_lfo.enabled and not lfo.enabled):
                            self._freeze_phase(rt, s.tempo_bpm, now)
                        rt.macro.lfo = type(lfo).model_validate(new_lfo.model_dump())
                except (ValueError, EvaluationError) as e:
                    raise LiveRefused("live.invalid_param", str(e)) from e
            return self.status()

    def _freeze_phase(self, rt: MacroRuntime, bpm: float, now: float) -> None:
        if rt.macro.lfo.enabled:
            per = period_s(bpm, rt.macro.lfo.beats_per_cycle)
            rt.phase0 = phase_at(now - rt.t0, per, rt.phase0)
        rt.t0 = now

    def request_stop(self, reason: str, by: str = "system") -> None:
        """Non-blocking: ask the running performance to stop; finalised by the next tick/status."""
        if self.state == "performing":
            self._stop_request = (reason, by)
            self._stop_flag.set()
            self.clock.wake()

    def stop(self, reason: str = "Stop pressed", by: str = "user") -> dict:
        """Stop and return only once nothing of the performance can still be sent: its queued values
        are cancelled, its job finished (so no late enqueue), the in-flight message done, the tick
        thread exited."""
        with self._lock:
            if self.state == "performing":
                self._stop_locked(reason, by)
            else:
                self._apply_pending_stop_locked()
            thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            self.clock.wake()
            thread.join(timeout=5.0)
        return self.status()

    def _stop_locked(self, reason: str, by: str) -> None:
        s = self.session
        if s is None or self.state != "performing":
            return
        self.state = "stopped"
        s.stopped_at = utcnow_iso()
        s.stop_reason = reason
        s.stopped_by = by
        self._stop_flag.set()
        self._stop_request = None
        n = self.sender.cancel_job(s.job_id, f"performance stopped: {reason}")
        self.sender._emit(
            "stopped",
            f"PERFORMANCE STOPPED ({reason}): {n} queued value(s) cancelled, {s.counters.handed} handed to the sender in total. "
            "Values already transmitted are not undone; pedals keep whatever they last received.",
        )
        self.last = s
        self.clock.wake()

    def _apply_pending_stop_locked(self) -> None:
        req = self._stop_request
        if req is not None and self.state == "performing":
            self._stop_locked(*req)
        self._stop_request = None

    def _require_controller(self, controller_id: str) -> Session:
        s = self.session
        if s is None or self.state != "performing":
            raise LiveRefused("live.not_performing", "No performance is running.")
        if not controller_id or not secrets.compare_digest(controller_id, s.controller_id):
            raise LiveRefused(
                "live.not_controller",
                "Another browser tab or client controls this performance. Stop it there (or press Stop here) before taking over.",
            )
        return s

    # -- the tick ------------------------------------------------------------------------
    def tick(self) -> dict:
        """One evaluation pass. Public so tests drive it deterministically with a fake clock."""
        plan: list[tuple[Destination, int, Resolved]] = []
        job_id: str | None = None
        with self._lock:
            self._apply_pending_stop_locked()
            s = self.session
            if s is None or self.state != "performing":
                return {"performing": False}
            now = self.clock.monotonic()
            if now > s.lease_deadline:
                self._stop_locked(
                    f"lease expired: no heartbeat from the controlling browser for {self.lease_s:g}s", "lease"
                )
                return {"performing": False}
            if not self.sender.armed:
                self._stop_locked("sender is disarmed", "sender")
                return {"performing": False}
            c = s.counters
            c.ticks += 1
            # Evaluate every macro once; every destination once.
            values: dict[str, int] = {}
            for rt in s.macros.values():
                try:
                    mv = evaluate_macro(rt.macro, s.tempo_bpm, now - rt.t0, rt.phase0, base=rt.base)
                except EvaluationError as e:
                    self._fault_locked(f"evaluation error: {e}")
                    return {"performing": False}
                rt.phase, rt.lfo, rt.effective = mv.phase, mv.lfo, mv.effective
                for m in mv.mappings:
                    values[m.mapping_id] = m.value
            c.evaluations += len(s.destinations)
            changed = [
                d
                for d in s.destinations
                if values.get(d.mapping_id) is not None and values[d.mapping_id] != d.last_value
            ]
            c.deduplicated += len(s.destinations) - len(changed)
            c.planned += len(changed)
            if changed:
                # Round-robin start so a tick that cannot carry every change never favours the same ones.
                n = len(s.destinations)
                order = sorted(changed, key=lambda d: (s.destinations.index(d) - self._rr) % n)
                take, defer = order[: self.max_per_tick], order[self.max_per_tick :]
                c.deferred += len(defer)
                self._rr = (self._rr + len(take)) % max(1, n)
                for d in take:
                    v = values[d.mapping_id]
                    r = replace(d.template, value=v, data=encode("cc", d.template.channel, d.cc, v))
                    plan.append((d, v, r))
            job_id = s.job_id
        # Hand over outside the engine lock: the sender's lock orders us against disarm/stop.
        for d, v, r in plan:
            try:
                outcome = self.sender.stream_one(job_id or "", r)
            except LiveRefused as e:
                with self._lock:
                    if self.session is not None:
                        self.session.counters.refused += 1
                    self._fault_locked(f"sender refused: {e}")
                return {"performing": False}
            with self._lock:
                if self.session is not None and self.session.job_id == job_id:
                    d.last_value = v
                    d.last_at = self.clock.monotonic()
                    d.handed += 1
                    self.session.counters.handed += 1
                    if outcome == "coalesced":
                        pass
        return {"performing": self.state == "performing", "handed": len(plan)}

    def _fault_locked(self, reason: str) -> None:
        s = self.session
        if s is None or self.state != "performing":
            return
        self._stop_locked(reason, "fault")
        self.state = "fault"

    def _run(self) -> None:
        while not self._closing:
            with self._lock:
                running = self.state == "performing" and not self._stop_flag.is_set()
            if not running:
                with self._lock:
                    self._apply_pending_stop_locked()
                return
            self.tick()
            if self.state != "performing":
                return
            self.clock.wait(self.tick_s)

    # -- reporting ----------------------------------------------------------------------
    def status(self) -> dict:
        with self._lock:
            self._apply_pending_stop_locked()
            s = self.session
            now = self.clock.monotonic()
            out: dict = {
                "state": self.state,
                "tick_s": self.tick_s,
                "max_per_tick": self.max_per_tick,
                "budget": {
                    "aggregate_per_s": round(self.max_per_tick / self.tick_s),
                    "per_destination_per_s": round(1 / self.tick_s),
                },
                "lease_s": self.lease_s,
                "texture_id": s.texture_id if s else None,
                "texture_name": s.texture_name if s else None,
                "rig_id": s.rig_id if s else None,
                "job_id": s.job_id if s else None,
                "started_at": s.started_at if s else None,
                "stopped_at": s.stopped_at if s else None,
                "stop_reason": s.stop_reason if s else None,
                "stopped_by": s.stopped_by if s else None,
                "elapsed_s": round(now - s.started_mono, 3) if s and self.state == "performing" else None,
                "lease_remaining_s": round(max(0.0, s.lease_deadline - now), 3)
                if s and self.state == "performing"
                else None,
                "heartbeats": s.heartbeats if s else 0,
                "has_controller": bool(s and self.state == "performing"),
                "tempo_bpm": s.tempo_bpm if s else None,
                "counters": s.counters.as_dict() if s else Counters().as_dict(),
                "macros": [rt.as_dict() for rt in s.macros.values()] if s else [],
                "destinations": [d.as_dict() for d in s.destinations] if s else [],
                "note": "Values are what Signal Loom commanded; they are not pedal state. A virtual performance is not hardware evidence.",
            }
            return out

    def close(self) -> None:
        self._closing = True
        self.stop("backend shutting down", by="shutdown")
