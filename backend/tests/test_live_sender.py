"""Session 4 safety boundary, proven on the sender and the virtual transport alone.

Every rule in charter §0/§6 that concerns *output* is here: disarmed by default, zero output
while disarmed, dry run never calls a transport, explicit arming, ordered dispatch with delay,
Stop and disconnect semantics, forbidden message types, toggle confirmation, coalescing, and
"reconnect never re-arms"."""

from __future__ import annotations

import time

import pytest

from app.live.sender import ARM_PHRASE, LiveRefused, LiveSender, Resolved
from app.live.transport import EndpointInfo, ForbiddenMessageError, TransportError, decode, encode
from app.live.virtual import VirtualPedal, VirtualTransport


class ExplodingTransport(VirtualTransport):
    """A transport whose send() fails the test outright: proves a code path makes zero sends."""

    def send(self, endpoint_id: str, data: bytes) -> None:  # pragma: no cover - must never run
        raise AssertionError(f"transport.send was called with {data.hex()} — a dry run or a disarmed path sent MIDI")


def resolved(
    type_="cc",
    number=10,
    value=127,
    channel=3,
    target="inst_sunset",
    label="Sunset",
    ep="virt:x:out",
    deterministic=True,
    status="supported",
) -> Resolved:
    return Resolved(
        type=type_,
        channel=channel,
        number=number,
        value=value,
        target_instance_id=target,
        target_label=label,
        endpoint_id=ep if status not in ("unsupported", "unreachable") else None,
        endpoint_name="Virtual X",
        data=encode(type_, channel, number, value) if type_ in ("pc", "cc") else b"",
        route_status=status,
        route_evidence="published",
        route_reason="test",
        deterministic=deterministic,
        explanation="test",
        source_kind="device_cc",
        coalesce_key=f"{target}:cc:{number}" if type_ == "cc" else None,
    )


def world(pedal_channel=3):
    t = VirtualTransport()
    pedal = VirtualPedal(
        "inst_sunset",
        "Sunset",
        pedal_channel,
        bypass_cc=10,
        bypass_on=127,
        bypass_off=0,
        bypass_deterministic=True,
        pc_supported=True,
    )
    t.set_world([EndpointInfo("virt:x:out", "Virtual X", "out", "virtual")], {"virt:x:out": [pedal]})
    t.open_output("virt:x:out")
    return t, pedal


def wait(sender: LiveSender, job_id: str, timeout=3.0):
    end = time.time() + timeout
    while time.time() < end:
        j = next(j for j in sender.jobs() if j.id == job_id)
        if j.finished_at:
            return j
        time.sleep(0.01)
    raise AssertionError("job did not finish")


# ------------------------------------------------------------------ wire format and the type gate


def test_encode_only_pc_and_cc_and_decode_round_trips():
    assert encode("pc", 1, 5, None) == bytes([0xC0, 5])
    assert encode("cc", 16, 102, 127) == bytes([0xBF, 102, 127])
    assert decode(bytes([0xC9, 2])).summary() == "PC 2 ch 10"
    assert decode(bytes([0xB2, 15, 64])).as_dict()["value"] == 64
    assert decode(bytes([0xF0, 0x7E, 0xF7])).type == "other"  # SysEx is displayed raw, never interpreted
    for bad in ("sysex", "note_on", "clock", "start"):
        with pytest.raises(ForbiddenMessageError):
            encode(bad, 1, 0, 0)
    with pytest.raises(ValueError):
        encode("cc", 17, 0, 0)
    with pytest.raises(ValueError):
        encode("cc", 1, 0, 128)


# ------------------------------------------------------------------------------------ disarmed


def test_disarmed_by_default_and_nothing_sends_while_disarmed():
    s = LiveSender()
    assert s.armed is False
    t = ExplodingTransport()
    s.attach_transport(t)
    assert s.armed is False
    with pytest.raises(LiveRefused) as e:
        s.audition("x", [resolved()], 0)
    assert e.value.code == "live.disarmed"
    with pytest.raises(LiveRefused) as e:
        s.send_one(resolved())
    assert e.value.code == "live.disarmed"
    assert t.send_count == 0
    # Dry run is pure: it cannot even reach the transport.
    out = LiveSender.dry_run([resolved(), resolved("pc", 3, None)])
    assert [m["hex"] for m in out] == ["B2 0A 7F", "C2 03"]
    assert t.send_count == 0


def test_arm_requires_the_phrase_and_transport():
    s = LiveSender()
    with pytest.raises(LiveRefused) as e:
        s.arm(ARM_PHRASE)
    assert e.value.code == "live.not_connected"
    s.attach_transport(VirtualTransport())
    with pytest.raises(LiveRefused) as e:
        s.arm("yes")
    assert e.value.code == "live.confirm_required"
    assert s.armed is False
    s.arm("  Send MIDI To My Rig ")
    assert s.armed is True
    kinds = [e.kind for e in s.log()]
    assert kinds == ["armed"]


def test_attaching_a_transport_again_disarms_never_rearms():
    s = LiveSender()
    t, _ = world()
    s.attach_transport(t)
    s.arm(ARM_PHRASE)
    s.attach_transport(t)  # a reconnect / rebind
    assert s.armed is False
    assert s.log()[-1].kind == "disarmed"


# ------------------------------------------------------------------------- ordered dispatch


def test_audition_sends_in_order_with_delay_and_updates_simulated_pedal():
    s = LiveSender()
    t, pedal = world()
    s.attach_transport(t)
    s.arm(ARM_PHRASE)
    msgs = [resolved("pc", 7, None), resolved("cc", 10, 0), resolved("cc", 15, 100)]
    t0 = time.monotonic()
    job, warnings = s.audition("scene", msgs, delay_ms=40)
    j = wait(s, job.id)
    elapsed = time.monotonic() - t0
    assert j.sent == 3 and j.failed == 0 and j.cancelled == 0 and warnings == []
    assert [r.data for r in t.sent] == [bytes([0xC2, 7]), bytes([0xB2, 10, 0]), bytes([0xB2, 15, 100])]
    assert elapsed >= 0.08  # three messages, two full gaps at least
    assert pedal.program == 7 and pedal.bypassed is True and pedal.cc == {15: 100}
    assert s.last_sent["inst_sunset"]["program"] == 7
    assert s.last_sent["inst_sunset"]["cc"]["15"]["value"] == 100
    sent_log = [e for e in s.log() if e.kind == "sent"]
    assert [e.resolved.number for e in sent_log] == [7, 10, 15]


def test_stop_cancels_queued_messages_and_keeps_the_sent_ones():
    s = LiveSender()
    t, pedal = world()
    s.attach_transport(t)
    s.arm(ARM_PHRASE)
    msgs = [resolved("cc", n, 1) for n in range(20, 30)]
    job, _ = s.audition("long", msgs, delay_ms=60)
    time.sleep(0.1)
    n = s.stop()
    j = wait(s, job.id)
    assert n >= 1 and j.cancelled == n and j.sent + j.cancelled == 10
    assert t.send_count == j.sent
    assert s.armed is True  # Stop is not disarm
    stop_entry = next(e for e in s.log() if e.kind == "stopped")
    assert "not undone" in stop_entry.message


def test_disarm_and_disconnect_drop_the_queue():
    s = LiveSender()
    t, _ = world()
    s.attach_transport(t)
    s.arm(ARM_PHRASE)
    job, _ = s.audition("long", [resolved("cc", n, 1) for n in range(40, 50)], delay_ms=60)
    time.sleep(0.05)
    s.disarm("user")
    j = wait(s, job.id)
    assert s.armed is False and s.queue_length() == 0
    assert j.sent + j.cancelled == 10 and j.cancelled >= 1
    # A later audition is refused: disarmed.
    with pytest.raises(LiveRefused):
        s.audition("again", [resolved()], 0)
    # Disconnect (attach None) from an armed state does the same.
    s.attach_transport(t)
    s.arm(ARM_PHRASE)
    s.audition("x", [resolved("cc", n, 1) for n in range(5)], delay_ms=60)
    s.attach_transport(None)
    assert s.armed is False and s.queue_length() == 0


# ------------------------------------------------------------------------------- refusals


def test_rejects_forbidden_types_unroutable_targets_and_unconfirmed_toggles():
    s = LiveSender()
    t, _ = world()
    s.attach_transport(t)
    s.arm(ARM_PHRASE)
    bad = resolved()
    bad.type = "sysex"
    with pytest.raises(LiveRefused) as e:
        s.audition("x", [bad], 0)
    assert e.value.code == "live.message_type_forbidden"
    with pytest.raises(LiveRefused) as e:
        s.audition("x", [resolved(status="unreachable")], 0)
    assert e.value.code == "live.route_unavailable"
    with pytest.raises(LiveRefused) as e:
        s.audition("x", [resolved(status="unsupported")], 0)
    assert e.value.code == "live.route_unavailable"
    with pytest.raises(LiveRefused) as e:
        s.audition("x", [resolved(deterministic=False)], 0)
    assert e.value.code == "live.confirm_nondeterministic"
    assert e.value.detail["messages"][0]["number"] == 10
    assert t.send_count == 0
    # Confirmed toggles go out; unverified routes go out with a warning.
    job, warnings = s.audition(
        "x", [resolved(deterministic=False), resolved(status="unverified")], 0, confirm_nondeterministic=True
    )
    j = wait(s, job.id)
    assert j.sent == 2 and len(warnings) == 1 and "unverified" in warnings[0]


def test_coalescing_keeps_only_the_newest_value_per_controller():
    s = LiveSender()
    t, pedal = world()
    s.attach_transport(t)
    s.arm(ARM_PHRASE)
    # Block the worker with a slow audition first so the slider stream queues up.
    blocker, _ = s.audition("blocker", [resolved("cc", 20, 1), resolved("cc", 21, 1)], delay_ms=150)
    time.sleep(0.02)
    jobs = [s.send_one(resolved("cc", 15, v), coalesce=True)[0] for v in (10, 20, 30, 40)]
    assert len({j.id for j in jobs}) == 1  # all four collapsed into one queued message
    wait(s, blocker.id)
    wait(s, jobs[0].id)
    cc15 = [r for r in t.sent if r.data[1] == 15]
    assert [r.data[2] for r in cc15] == [40]
    assert pedal.cc[15] == 40
    # Without coalescing every value is sent.
    for v in (1, 2, 3):
        s.send_one(resolved("cc", 16, v))
    time.sleep(0.3)
    assert [r.data[2] for r in t.sent if r.data[1] == 16] == [1, 2, 3]


def test_transport_error_mid_audition_disarms_and_reports():
    class Flaky(VirtualTransport):
        def send(self, endpoint_id, data):
            if data[1] == 2:
                raise TransportError("port vanished")
            super().send(endpoint_id, data)

    s = LiveSender()
    t = Flaky()
    t.set_world([EndpointInfo("virt:x:out", "Virtual X", "out", "virtual")], {})
    t.open_output("virt:x:out")
    s.attach_transport(t)
    s.arm(ARM_PHRASE)
    job, _ = s.audition("x", [resolved("cc", n, 1) for n in (1, 2, 3)], 0)
    j = wait(s, job.id)
    assert j.sent == 1 and j.failed == 1 and j.cancelled == 1
    assert s.armed is False
    assert any(e.kind == "failed" and "port vanished" in e.message for e in s.log())


# -------------------------------------------------------------------- virtual transport itself


def test_virtual_transport_enumerates_filters_by_channel_and_models_busy_and_unplug():
    t = VirtualTransport()
    a = VirtualPedal("a", "A", 1, bypass_cc=102, bypass_on=127, bypass_off=0, bypass_deterministic=True)
    b = VirtualPedal("b", "B", 1)
    c = VirtualPedal("c", "C", 2)
    t.set_world(
        [EndpointInfo("virt:bus:out", "Bus", "out", "virtual"), EndpointInfo("virt:mc8:in", "MC8 in", "in", "virtual")],
        {"virt:bus:out": [a, b, c]},
    )
    ids = {e.id for e in t.enumerate()}
    assert {"virt:bus:out", "virt:mc8:in", "virt:generic:out", "virt:generic:in"} <= ids
    with pytest.raises(TransportError):
        t.send("virt:bus:out", bytes([0xC0, 1]))  # not open
    t.open_output("virt:bus:out")
    t.send("virt:bus:out", bytes([0xC0, 9]))  # channel 1: a and b react, c does not (shared bus)
    assert a.program == 9 and b.program == 9 and c.program is None
    t.send("virt:bus:out", bytes([0xB0, 102, 0]))
    assert a.bypassed is True and b.cc == {102: 0}
    # Toggle-style bypass flips.
    tog = VirtualPedal("t", "T", 5, bypass_cc=80, bypass_deterministic=False)
    tog.receive("x", decode(bytes([0xB4, 80, 127])), "simulation_tested")
    tog.receive("x", decode(bytes([0xB4, 80, 127])), "simulation_tested")
    assert tog.bypassed is True
    # Busy and unplug are visible and block opening; input injection needs a listener.
    t.set_busy("virt:bus:out", True)
    assert next(e for e in t.enumerate() if e.id == "virt:bus:out").busy is True
    with pytest.raises(TransportError):
        t.open_output("virt:bus:out")
    t.set_busy("virt:bus:out", False)
    t.unplug("virt:bus:out")
    assert "virt:bus:out" not in {e.id for e in t.enumerate()}
    got: list[bytes] = []
    assert t.inject("virt:mc8:in", bytes([0xC0, 1])) is False
    t.open_input("virt:mc8:in", lambda eid, data: got.append(data))
    assert t.inject("virt:mc8:in", bytes([0xC0, 1])) is True
    assert got == [bytes([0xC0, 1])]


def test_route_prerequisites_and_unverified_hops_are_acknowledged_before_anything_is_queued():
    s = LiveSender()
    t, _ = world()
    s.attach_transport(t)
    s.arm(ARM_PHRASE)
    r1 = resolved("pc", 1, None)
    r1.needs_ack = ["prerequisite: MC8: enable Cross MIDI Thru"]
    r2 = resolved("cc", 15, 1, status="unverified")
    r2.needs_ack = ["prerequisite: MC8: enable Cross MIDI Thru", "unverified route to Sunset for CC: not documented"]
    with pytest.raises(LiveRefused) as e:
        s.audition("x", [r1, r2], 0)
    assert e.value.code == "live.confirm_route"
    assert e.value.detail["items"] == [
        "prerequisite: MC8: enable Cross MIDI Thru",
        "unverified route to Sunset for CC: not documented",
    ]
    assert s.queue_length() == 0 and t.send_count == 0 and [x.kind for x in s.log()] == ["armed"]
    # A partial acknowledgement is still refused, naming only what is missing.
    s.acknowledge(["prerequisite: MC8: enable Cross MIDI Thru"])
    with pytest.raises(LiveRefused) as e:
        s.audition("x", [r1, r2], 0)
    assert e.value.detail["items"] == ["unverified route to Sunset for CC: not documented"]
    job, _ = s.audition("x", [r1], 0)  # r1 alone is fully acknowledged
    wait(s, job.id)
    s.acknowledge(["unverified route to Sunset for CC: not documented"])
    job, warnings = s.audition("x", [r1, r2], 0)
    wait(s, job.id)
    assert t.send_count == 3 and len(warnings) == 1
    # A new transport (reconnect) forgets the session's acknowledgements.
    s.attach_transport(t)
    assert s.acknowledged == set()
