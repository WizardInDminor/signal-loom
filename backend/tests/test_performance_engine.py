"""The performance engine under a fake clock and fake transports (charter §6/§9): explicit start,
budget and per-destination limits, deduplication, newest-value coalescing, lease expiry, Stop
priority during an in-flight send, disarm/transport-error stop paths, tempo change without a
burst, controller identity, and a real thread that stops when asked. No sleeps decide an outcome."""

from __future__ import annotations

import threading
import time

import pytest

from app.live.performance import Destination, FakeClock, PerformanceEngine
from app.live.sender import ARM_PHRASE, LiveRefused, LiveSender, Resolved
from app.live.transport import EndpointInfo, TransportError, encode
from app.live.virtual import VirtualPedal, VirtualTransport
from app.models.texture import Lfo, Macro, Mapping, Texture

EP = "virt:x:out"


def world(n_pedals: int = 2) -> tuple[VirtualTransport, dict[str, VirtualPedal]]:
    t = VirtualTransport()
    pedals = {f"inst_{i}": VirtualPedal(f"inst_{i}", f"Pedal {i}", i + 1) for i in range(n_pedals)}
    t.set_world([EndpointInfo(EP, "Virtual X", "out", "virtual")], {EP: list(pedals.values())})
    t.open_output(EP)
    return t, pedals


def template(inst: str, channel: int, cc: int) -> Resolved:
    return Resolved(
        type="cc",
        channel=channel,
        number=cc,
        value=0,
        target_instance_id=inst,
        target_label=inst,
        endpoint_id=EP,
        endpoint_name="Virtual X",
        data=encode("cc", channel, cc, 0),
        route_status="supported",
        route_evidence="published",
        route_reason="test",
        deterministic=True,
        explanation="test",
        source_kind="performance",
        coalesce_key=f"{inst}:cc:{cc}",
    )


def texture(
    n: int = 2, *, lfo: bool = True, depth: float = 1.0, beats: float = 1.0, bpm: float = 120.0, base: float = 0.0
) -> Texture:
    maps = [
        Mapping(
            id=f"map_{i}",
            instance_id=f"inst_{i}",
            cc=20 + i,
            output_min=0 if i % 2 == 0 else 127,
            output_max=127 if i % 2 == 0 else 0,
        )
        for i in range(n)
    ]
    return Texture(
        id="tex_t",
        name="T",
        tempo_bpm=bpm,
        macros=[
            Macro(
                id="macro_m",
                name="M",
                base=base,
                mappings=maps,
                lfo=Lfo(enabled=lfo, beats_per_cycle=beats, depth=depth),
            )
        ],
    )


def destinations(tex: Texture) -> list[Destination]:
    out = []
    for mac in tex.macros:
        for m in mac.mappings:
            i = int(m.instance_id.split("_")[1])
            out.append(
                Destination(
                    m.id,
                    mac.id,
                    m.instance_id,
                    m.instance_id,
                    m.cc,
                    m.output_min,
                    m.output_max,
                    template(m.instance_id, i + 1, m.cc),
                )
            )
    return out


def armed(transport) -> LiveSender:
    s = LiveSender()
    s.attach_transport(transport)
    s.arm(ARM_PHRASE)
    return s


def engine(sender: LiveSender, clock: FakeClock, **kw) -> PerformanceEngine:
    return PerformanceEngine(sender, clock, run_thread=False, **kw)


def settle(sender: LiveSender, job_id: str, handed: int, timeout: float = 3.0) -> None:
    """Wait until everything handed to the sender has been sent, failed or coalesced away."""
    end = time.time() + timeout
    while time.time() < end:
        j = next(j for j in sender.jobs() if j.id == job_id)
        if j.sent + j.failed + j.coalesced >= handed and sender.queue_length() == 0:
            return
        time.sleep(0.005)
    raise AssertionError(f"job did not settle {handed} handed values")


def test_engine_starts_idle_and_start_needs_arming_and_destinations():
    t, _ = world()
    s = LiveSender()
    s.attach_transport(t)
    clock = FakeClock()
    e = engine(s, clock)
    assert e.status()["state"] == "idle" and s.armed is False
    with pytest.raises(LiveRefused) as x:
        e.start("rig", texture(), destinations(texture()))
    assert x.value.code == "live.disarmed"
    s.arm(ARM_PHRASE)
    with pytest.raises(LiveRefused) as x:
        e.start("rig", texture(), [])
    assert x.value.code == "live.no_destinations"
    assert e.status()["state"] == "idle" and t.send_count == 0
    # Arming alone, and ticking an idle engine, send nothing.
    assert e.tick() == {"performing": False} and t.send_count == 0


def test_budget_dedup_and_round_robin_hold_under_a_fake_clock():
    t, pedals = world(3)
    s = armed(t)
    clock = FakeClock()
    e = engine(s, clock)  # 2 per tick, 1 per destination per tick
    # Three destinations whose values change every tick: period 0.125 s, so the 0.1 s ticks land on
    # phases 0, 0.8, 0.6, 0.4, 0.2, 0 → effective 0.5, 0.1, 0.3, 0.7, 0.9, 0.5 (never clamped).
    tex = texture(3, beats=0.25, bpm=120, depth=0.5, base=0.5)
    sess = e.start("rig", tex, destinations(tex))
    assert e.status()["state"] == "performing"
    r = e.tick()  # t = 0: every destination differs from "never commanded" → 3 planned, 2 handed, 1 deferred
    assert r["handed"] == 2
    c = e.status()["counters"]
    assert c["planned"] == 3 and c["handed"] == 2 and c["deferred"] == 1
    settle(s, sess.job_id, 2)
    for _ in range(5):
        clock.advance(0.1)
        e.tick()
    st = e.status()
    c = st["counters"]
    assert c["ticks"] == 6 and c["planned"] == 18
    # Aggregate budget: exactly max_per_tick per tick; the third change each tick is deferred, never queued.
    assert c["handed"] == 12 and c["deferred"] == 6
    # Per destination: at most one per tick, and round robin shares the budget evenly — nobody starves.
    assert [d["handed"] for d in st["destinations"]] == [4, 4, 4]
    settle(s, sess.job_id, c["handed"])
    # Nothing unbounded accumulated in the sender: the queue never held more than one per destination.
    assert s.queue_length() <= 3
    # The simulated pedals saw only seven-bit values inside the authored ranges.
    for p in pedals.values():
        for v in p.cc.values():
            assert 0 <= v <= 127
    e.stop()


def test_unchanged_values_are_deduplicated_not_resent():
    t, pedals = world()
    s = armed(t)
    clock = FakeClock()
    e = engine(s, clock)
    tex = texture(2, lfo=False, base=0.5)  # constant: 64 and 64 (127 − 63.5 → 64 half-up as well)
    sess = e.start("rig", tex, destinations(tex))
    assert e.tick()["handed"] == 2
    settle(s, sess.job_id, 2)
    for _ in range(20):
        clock.advance(0.1)
        assert e.tick()["handed"] == 0
    c = e.status()["counters"]
    assert c["handed"] == 2 and c["deduplicated"] == 40 and c["planned"] == 2
    assert t.send_count == 2
    assert pedals["inst_0"].cc == {20: 64} and pedals["inst_1"].cc == {21: 64}
    e.stop()


class BlockingTransport(VirtualTransport):
    """send() parks inside the driver until released (the Session 4 race fixture)."""

    def __init__(self) -> None:
        super().__init__()
        self.entered = threading.Event()
        self.release = threading.Event()
        self.set_world([EndpointInfo(EP, "Virtual X", "out", "virtual")], {})
        self.open_output(EP)

    def send(self, endpoint_id: str, data: bytes) -> None:
        self.entered.set()
        assert self.release.wait(timeout=5.0), "test did not release the blocked send"
        super().send(endpoint_id, data)


def test_newest_value_wins_and_the_queue_never_grows_per_destination():
    t, pedals = world(1)
    s = armed(t)
    clock = FakeClock()
    e = engine(s, clock, max_per_tick=1)
    tex = texture(1, beats=0.25, bpm=120, depth=0.5, base=0.5)
    sess = e.start("rig", tex, destinations(tex))
    with s.hold_worker():  # a control action is pending: the worker yields, so nothing leaves the queue
        e.tick()  # v1 queued
        clock.advance(0.1)
        e.tick()  # v2 replaces v1 in the queue (same device/CC, unsent)
        clock.advance(0.1)
        e.tick()  # v3 replaces v2
        st = e.status()
        assert st["counters"]["handed"] == 3
        job = next(j for j in s.jobs() if j.id == sess.job_id)
        assert job.coalesced == 2 and job.total == 1 and s.queue_length() == 1
        v3 = st["destinations"][0]["last_commanded"]
    settle(s, sess.job_id, 3)
    assert [rec.data[2] for rec in t.sent] == [v3]  # v1 and v2 were never transmitted: newest wins
    assert pedals["inst_0"].cc == {20: v3}
    e.stop()


def test_lease_expiry_stops_the_stream_even_though_the_backend_stays_armed():
    t, _ = world()
    s = armed(t)
    clock = FakeClock()
    e = engine(s, clock, lease_s=5.0)
    tex = texture()
    sess = e.start("rig", tex, destinations(tex))
    e.tick()
    settle(s, sess.job_id, 2)
    clock.advance(4.0)
    e.heartbeat(sess.controller_id)  # renews: 5 s from now
    clock.advance(4.0)
    assert e.tick()["performing"] is True  # 4 s since the heartbeat: alive
    clock.advance(1.5)
    assert e.tick() == {"performing": False}
    st = e.status()
    assert st["state"] == "stopped" and "lease expired" in st["stop_reason"] and st["stopped_by"] == "lease"
    assert s.armed is True  # the lease protects against unattended output; it does not disarm
    before = t.send_count
    clock.advance(1.0)
    e.tick()
    assert t.send_count == before
    with pytest.raises(LiveRefused) as x:  # nothing more can be enqueued for the ended performance
        s.stream_one(sess.job_id, template("inst_0", 1, 20))
    assert x.value.code == "live.stream_closed"
    with pytest.raises(LiveRefused) as x:
        e.heartbeat(sess.controller_id)
    assert x.value.code == "live.not_performing"


def test_only_the_controller_may_heartbeat_or_change_params_but_anyone_may_stop():
    t, _ = world()
    s = armed(t)
    clock = FakeClock()
    e = engine(s, clock)
    tex = texture()
    sess = e.start("rig", tex, destinations(tex))
    with pytest.raises(LiveRefused) as x:
        e.heartbeat("not-the-controller")
    assert x.value.code == "live.not_controller"
    with pytest.raises(LiveRefused) as x:
        e.set_params("nope", macros={"macro_m": {"base": 0.5}})
    assert x.value.code == "live.not_controller"
    with pytest.raises(LiveRefused) as x:  # a second start cannot hijack
        e.start("rig", tex, destinations(tex))
    assert x.value.code == "live.already_performing"
    assert e.stop("second tab pressed Stop")["state"] == "stopped"
    # A fresh start after a stop issues a new controller id.
    sess2 = e.start("rig", tex, destinations(tex))
    assert sess2.controller_id != sess.controller_id
    e.stop()


def test_stop_during_an_in_flight_send_waits_and_nothing_follows():
    t = BlockingTransport()
    s = armed(t)
    clock = FakeClock()
    e = engine(s, clock)
    tex = texture(2)
    e.start("rig", tex, destinations(tex))
    with s.hold_worker():
        e.tick()  # two values queued while the worker yields
        assert s.queue_length() == 2
    assert t.entered.wait(timeout=5.0)  # the worker took the first and is parked inside the driver
    assert s.in_flight is not None  # lock-free peek: the sender lock is held during the send
    done = threading.Event()
    result: dict = {}

    def do_stop():
        result["status"] = e.stop("Stop pressed")
        done.set()

    threading.Thread(target=do_stop, daemon=True).start()
    assert not done.wait(timeout=0.3)  # cannot return while the driver holds a message
    t.release.set()
    assert done.wait(timeout=5.0)
    st = result["status"]
    assert st["state"] == "stopped" and st["stopped_by"] == "user"
    assert t.send_count == 1  # exactly the in-flight message went out; the queued one was cancelled
    assert s.queue_length() == 0
    log = [x.kind for x in s.log()]
    assert "cancelled" in log and log[-1] == "stopped"
    # After Stop returned: ticks do nothing and the transport sees nothing more.
    for _ in range(3):
        clock.advance(0.1)
        assert e.tick() == {"performing": False}
    assert t.send_count == 1


@pytest.mark.parametrize("how", ["disarm", "transport_change", "close"])
def test_any_sender_disarm_stops_the_performance_before_the_next_message(how):
    t, _ = world()
    s = armed(t)
    clock = FakeClock()
    e = engine(s, clock)
    tex = texture()
    sess = e.start("rig", tex, destinations(tex))
    e.tick()
    settle(s, sess.job_id, 2)
    before = t.send_count
    {"disarm": lambda: s.disarm("user"), "transport_change": lambda: s.attach_transport(t), "close": lambda: s.close()}[
        how
    ]()
    st = e.status()  # the hook recorded the stop; status finalises it without a tick
    assert st["state"] == "stopped" and st["stop_reason"].startswith("disarmed:") and st["stopped_by"] == "sender"
    clock.advance(0.5)
    assert e.tick() == {"performing": False}
    assert t.send_count == before
    if how != "close":
        s.arm(ARM_PHRASE)  # re-arming never resumes: an explicit start is needed again
        assert e.tick() == {"performing": False} and e.status()["state"] == "stopped"


class FailingTransport(VirtualTransport):
    def __init__(self) -> None:
        super().__init__()
        self.set_world([EndpointInfo(EP, "Virtual X", "out", "virtual")], {})
        self.open_output(EP)

    def send(self, endpoint_id: str, data: bytes) -> None:
        raise TransportError("WinMM: device gone")


def test_a_driver_error_fails_closed_disarms_and_faults_the_performance():
    t = FailingTransport()
    s = armed(t)
    clock = FakeClock()
    e = engine(s, clock)
    tex = texture()
    sess = e.start("rig", tex, destinations(tex))
    e.tick()
    end = time.time() + 3
    while time.time() < end and s.armed:
        time.sleep(0.005)
    assert s.armed is False
    st = e.status()
    assert st["state"] in ("stopped", "fault") and "disarmed" in st["stop_reason"]
    kinds = [x.kind for x in s.log()]
    assert "failed" in kinds and "disarmed" in kinds
    clock.advance(0.2)
    assert e.tick() == {"performing": False}
    with pytest.raises(LiveRefused):
        s.stream_one(sess.job_id, template("inst_0", 1, 20))


def test_tempo_and_division_changes_freeze_the_phase_and_never_burst():
    t, _ = world()
    s = armed(t)
    clock = FakeClock()
    e = engine(s, clock)
    tex = texture(2, beats=4, bpm=60, depth=0.5, base=0.5)  # period 4 s
    sess = e.start("rig", tex, destinations(tex))
    e.tick()
    clock.advance(1.0)  # a quarter cycle: phase 0.25, LFO at the crest
    e.tick()
    st = e.status()
    assert st["macros"][0]["phase"] == pytest.approx(0.25) and st["macros"][0]["lfo"] == pytest.approx(1.0)
    handed_before = st["counters"]["handed"]
    e.set_params(sess.controller_id, tempo_bpm=120)  # period now 2 s; the phase must not jump
    e.tick()
    st = e.status()
    assert st["tempo_bpm"] == 120 and st["macros"][0]["phase"] == pytest.approx(0.25)
    assert st["counters"]["handed"] - handed_before <= 2  # one tick's budget, no catch-up burst
    clock.advance(0.5)  # a quarter of the new period: phase 0.5
    e.tick()
    assert e.status()["macros"][0]["phase"] == pytest.approx(0.5)
    # A division change behaves the same; a disabled → enabled LFO starts from the frozen phase.
    e.set_params(sess.controller_id, macros={"macro_m": {"beats_per_cycle": 8}})
    e.tick()
    assert e.status()["macros"][0]["phase"] == pytest.approx(0.5) and e.status()["macros"][0]["beats_per_cycle"] == 8
    e.set_params(sess.controller_id, macros={"macro_m": {"base": 0.9, "depth": 0.1, "enabled": False}})
    e.tick()
    m = e.status()["macros"][0]
    assert m["base"] == 0.9 and m["depth"] == 0.1 and m["lfo_enabled"] is False and m["effective"] == 0.9
    with pytest.raises(LiveRefused) as x:
        e.set_params(sess.controller_id, tempo_bpm=5)
    assert x.value.code == "live.invalid_param"
    with pytest.raises(LiveRefused):
        e.set_params(sess.controller_id, macros={"macro_m": {"base": 1.5}})
    with pytest.raises(LiveRefused):
        e.set_params(sess.controller_id, macros={"macro_other": {"base": 0.5}})
    e.stop()


def test_the_real_thread_ticks_on_its_own_and_exits_when_stopped():
    t, _ = world()
    s = armed(t)
    e = PerformanceEngine(s, tick_s=0.01, run_thread=True)
    tex = texture(2, beats=0.25, bpm=240)
    e.start("rig", tex, destinations(tex))
    end = time.time() + 3
    while time.time() < end and e.status()["counters"]["ticks"] < 5:
        time.sleep(0.01)
    assert e.status()["counters"]["ticks"] >= 5
    st = e.stop()
    assert st["state"] == "stopped"
    assert e._thread is not None and not e._thread.is_alive()
    sent = t.send_count
    time.sleep(0.05)
    assert t.send_count == sent  # nothing after Stop returned
    # Per-destination rate: at most 1 per tick over the run.
    for d in st["destinations"]:
        assert d["handed"] <= st["counters"]["ticks"]


def test_a_new_engine_on_a_fresh_process_is_idle_and_disarmed():
    t, _ = world()
    s = LiveSender()
    s.attach_transport(t)
    e = PerformanceEngine(s, FakeClock(), run_thread=False)
    st = e.status()
    assert st["state"] == "idle" and st["has_controller"] is False and s.armed is False
    assert e.stop()["state"] == "idle"  # Stop on nothing is harmless


def test_start_right_after_an_audition_never_overlaps_its_in_flight_message():
    """Review observation: ``pending_discrete`` counts queued messages, not the one in flight. The
    sender lock serialises everything anyway: Start itself (it opens the stream under the sender
    lock) waits for the audition's in-flight message, and the first performance value follows it."""
    t = BlockingTransport()
    s = armed(t)
    clock = FakeClock()
    e = engine(s, clock)
    s.audition("scene", [template("inst_0", 1, 40)], delay_ms=0)
    assert t.entered.wait(timeout=5.0)  # the audition's only message is in flight; the queue is empty
    # Lock-free peeks (the sender lock is held for the whole send): nothing queued, one in flight —
    # exactly the state ``pending_discrete()`` would report as 0.
    assert s.in_flight is not None and len(s._queue) == 0
    tex = texture(1, lfo=False, base=0.5)
    done = threading.Event()

    def start_in_background():
        e.start("rig", tex, destinations(tex))
        e.tick()
        done.set()

    th = threading.Thread(target=start_in_background, daemon=True)
    th.start()
    assert not done.wait(timeout=0.3)  # Start cannot complete while the audition byte sits in the driver
    assert len(t.sent) == 0 and e.state == "idle"  # lock-free peeks: Start holds the engine lock while it waits
    t.release.set()
    assert done.wait(timeout=5.0)
    settle(s, e.session.job_id, 1)
    assert [rec.data[1] for rec in t.sent] == [40, 20]  # audition first, then the performance value, never interleaved
    e.stop()
