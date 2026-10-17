"""``RtMidiTransport`` against a fake of the python-rtmidi API (PR #4 review, items 4 and 5).

The real library cannot be installed in the sandbox, so the fake reproduces the surface the
transport uses — ``MidiOut/MidiIn``: ``get_ports``, ``open_port``, ``close_port``, ``send_message``,
``set_callback``, ``cancel_callback``, ``ignore_types``, ``delete`` — and lets a test change the
port list between calls (hot-unplug), raise on open (busy) and deliver input events. This does not
replace the owner's P0b hardware test; it verifies the adapter's bookkeeping and the duplicate-name
handling that Windows requires.
"""

from __future__ import annotations

import threading

import pytest

from app.live import rtmidi as rt
from app.live.sender import ARM_PHRASE
from app.live.transport import PortBusyError, TransportError


class FakePort:
    """One opened handle. The fake library records every call on the shared ``world``."""

    def __init__(self, world, direction):
        self.world = world
        self.direction = direction
        self.index: int | None = None
        self.callback = None
        self.ignored = None

    def get_ports(self):
        return list(self.world.ports[self.direction])

    def open_port(self, index):
        name = self.world.ports[self.direction][index]
        if (self.direction, index) in self.world.busy:
            raise RuntimeError(f"MidiOutWinMM::openPort: error creating Windows MM MIDI output port ({name})")
        self.index = index
        self.world.opened.append((self.direction, index, name))

    def close_port(self):
        self.world.closed.append((self.direction, self.index))
        self.index = None

    def send_message(self, data):
        if self.index is None:
            raise RuntimeError("port not open")
        self.world.sent.append((self.index, bytes(data)))

    def ignore_types(self, sysex=True, timing=True, active_sense=True):
        self.ignored = (sysex, timing, active_sense)

    def set_callback(self, cb):
        self.callback = cb
        self.world.inputs[self.index] = self

    def cancel_callback(self):
        self.world.inputs.pop(self.index, None)
        self.callback = None

    def delete(self):
        pass


class FakeWorld:
    def __init__(self, outs, ins):
        self.ports = {"out": list(outs), "in": list(ins)}
        self.busy: set[tuple[str, int]] = set()
        self.opened: list[tuple[str, int, str]] = []
        self.closed: list[tuple[str, int | None]] = []
        self.sent: list[tuple[int, bytes]] = []
        self.inputs: dict[int, FakePort] = {}

    def module(self):
        world = self

        class MidiOut(FakePort):
            def __init__(self):
                super().__init__(world, "out")

        class MidiIn(FakePort):
            def __init__(self):
                super().__init__(world, "in")

        class Module:
            pass

        m = Module()
        m.MidiOut = MidiOut
        m.MidiIn = MidiIn
        return m

    def deliver(self, index: int, data: bytes) -> bool:
        port = self.inputs.get(index)
        if port is None or port.callback is None:
            return False
        done = threading.Event()

        def run():
            port.callback((list(data), 0.0), None)
            done.set()

        threading.Thread(target=run, daemon=True).start()
        return done.wait(timeout=2.0)


@pytest.fixture
def fake(monkeypatch):
    world = FakeWorld(
        outs=["Morningstar MC8", "Morningstar MC8", "Volante"], ins=["Morningstar MC8", "Morningstar MC8"]
    )
    monkeypatch.setattr(rt, "_rtmidi", world.module())
    monkeypatch.setattr(rt, "_IMPORT_ERROR", None)
    return world


def test_without_the_library_the_transport_is_unavailable_with_a_reason(monkeypatch):
    monkeypatch.setattr(rt, "_rtmidi", None)
    monkeypatch.setattr(rt, "_IMPORT_ERROR", "ModuleNotFoundError: No module named 'rtmidi'")
    t = rt.RtMidiTransport()
    ok, reason = t.available()
    assert ok is False and "pip install" in reason
    assert t.enumerate() == []
    with pytest.raises(TransportError):
        t.open_output("rtmidi:out:x#0")


def test_duplicate_names_get_distinct_ordinal_ids_and_open_the_right_index(fake):
    t = rt.RtMidiTransport()
    assert t.available() == (True, None)
    eps = t.enumerate()
    assert [e.id for e in eps] == [
        "rtmidi:out:Morningstar MC8#0",
        "rtmidi:out:Morningstar MC8#1",
        "rtmidi:out:Volante#0",
        "rtmidi:in:Morningstar MC8#0",
        "rtmidi:in:Morningstar MC8#1",
    ]
    assert [e.peer_count for e in eps] == [2, 2, 1, 2, 2]
    assert "2 ports share this name" in (eps[0].note or "") and eps[2].note is None
    t.open_output("rtmidi:out:Morningstar MC8#1")
    assert fake.opened == [("out", 1, "Morningstar MC8")]
    t.send("rtmidi:out:Morningstar MC8#1", bytes([0xC0, 5]))
    assert fake.sent == [(1, bytes([0xC0, 5]))]
    assert t.send_count == 1
    # Opening again is idempotent; the other duplicate opens index 0.
    t.open_output("rtmidi:out:Morningstar MC8#1")
    t.open_output("rtmidi:out:Morningstar MC8#0")
    assert [o[1] for o in fake.opened] == [1, 0]
    t.close("rtmidi:out:Morningstar MC8#1")
    assert fake.closed == [("out", 1)] and not t.is_open("rtmidi:out:Morningstar MC8#1")
    with pytest.raises(TransportError):
        t.send("rtmidi:out:Morningstar MC8#1", b"\xc0\x01")
    # Legacy/plain ids (no ordinal) mean the first port of that name.
    assert rt.parse_endpoint_id("rtmidi:out:Volante") == ("out", "Volante", 0)


def test_busy_port_and_disappearance_are_reported_not_remapped(fake):
    t = rt.RtMidiTransport()
    fake.busy.add(("out", 2))
    with pytest.raises(PortBusyError) as e:
        t.open_output("rtmidi:out:Volante#0")
    assert "another application" in str(e.value)
    assert not t.is_open("rtmidi:out:Volante#0")
    # The first MC8 is unplugged: its twin is now the only "Morningstar MC8". The ordinal #1 no
    # longer exists and is reported; it is not silently mapped onto the remaining port.
    t.open_output("rtmidi:out:Morningstar MC8#1")
    fake.ports["out"] = ["Morningstar MC8", "Volante"]
    ids = [e.id for e in t.enumerate() if e.direction == "out"]
    assert ids == ["rtmidi:out:Morningstar MC8#0", "rtmidi:out:Volante#0"]
    assert next(e for e in t.enumerate() if e.id == "rtmidi:out:Morningstar MC8#0").peer_count == 1
    t.close("rtmidi:out:Morningstar MC8#1")
    with pytest.raises(TransportError) as e2:
        t.open_output("rtmidi:out:Morningstar MC8#1")
    assert "only 1 port(s) named" in str(e2.value)
    fake.ports["out"] = ["Volante"]
    with pytest.raises(TransportError) as e3:
        t.open_output("rtmidi:out:Morningstar MC8#0")
    assert "not present any more" in str(e3.value)


def test_input_callback_delivers_bytes_ignores_sysex_types_and_closes_cleanly(fake):
    t = rt.RtMidiTransport()
    got: list[tuple[str, bytes]] = []
    t.open_input("rtmidi:in:Morningstar MC8#1", lambda eid, data: got.append((eid, data)))
    assert fake.opened == [("in", 1, "Morningstar MC8")]
    assert fake.inputs[1].ignored == (True, True, True)
    assert fake.deliver(1, bytes([0xC9, 0x02])) is True
    assert got == [("rtmidi:in:Morningstar MC8#1", bytes([0xC9, 0x02]))]
    # A callback that raises never propagates into the driver thread.
    t.close("rtmidi:in:Morningstar MC8#1")
    t.open_input("rtmidi:in:Morningstar MC8#0", lambda eid, data: (_ for _ in ()).throw(RuntimeError("boom")))
    assert fake.deliver(0, bytes([0xB0, 1, 1])) is True
    t.close_all()
    assert fake.inputs == {} and not t.is_open("rtmidi:in:Morningstar MC8#0")


def test_service_on_the_rtmidi_fake_binds_by_ordinal_and_holds_a_binding_whose_peer_count_changed(fake, tmp_path):
    """Service-level: real transport selected, an MC8 bound by ordinal, an audition reaches the
    fake driver; when the number of same-named ports changes the binding is held closed and the
    armed session is disarmed by the watcher, without any manual rescan."""
    from app.db import Database
    from app.live.service import LiveService
    from app.main import seed
    from app.models.live import EndpointBinding, LiveBindings

    db = Database(tmp_path / "rt.sqlite3")
    db.migrate()
    seed(db)
    svc = LiveService(db)
    svc.watch_interval_s = 0.05
    rig = "rig_demo_signal_loom"
    svc.set_mode("rtmidi")
    assert svc.status()["mode"] == "rtmidi"
    saved = svc.save_bindings(
        rig,
        LiveBindings(
            rig_id=rig,
            transport_mode="rtmidi",
            bindings=[
                EndpointBinding(endpoint_id="rtmidi:out:Morningstar MC8#1", instance_id="inst_mc8", port_id="usb"),
                EndpointBinding(
                    endpoint_id="rtmidi:in:Morningstar MC8#1", instance_id="inst_mc8", port_id="usb", direction="in"
                ),
            ],
        ),
    )
    assert [b.peer_count for b in saved.bindings] == [2, 2]  # recorded server-side at save time
    st = svc.connect(rig)
    assert {e["endpoint_id"]: e["open"] for e in st["endpoints"]} == {
        "rtmidi:out:Morningstar MC8#1": True,
        "rtmidi:in:Morningstar MC8#1": True,
    }
    assert [o[:2] for o in fake.opened] == [("out", 1), ("in", 1)]
    svc.sender.arm(ARM_PHRASE)
    ack = svc.dry_run(rig, "scene_clean")["confirmations_required"]
    assert any("Cross MIDI Thru" in a for a in ack)
    r = svc.audition(rig, "scene_clean", 0, False, ack)
    end = threading.Event()
    for _ in range(100):
        if any(j["id"] == r["job"]["id"] and j["done"] for j in svc.status()["jobs"]):
            break
        end.wait(0.02)
    assert [i for i, _ in fake.sent] == [1] * len(fake.sent) and len(fake.sent) == r["job"]["total"]
    # Hot change: the first MC8 goes away, so one "Morningstar MC8" remains. The binding said two.
    fake.ports["out"] = ["Morningstar MC8", "Volante"]
    fake.ports["in"] = ["Morningstar MC8"]
    for _ in range(100):
        s2 = svc.status()
        if not s2["armed"]:
            break
        end.wait(0.02)
    s2 = svc.status()
    assert s2["armed"] is False and s2["watching"] is True
    out_state = next(e for e in s2["endpoints"] if e["endpoint_id"] == "rtmidi:out:Morningstar MC8#1")
    assert out_state["missing"] is True and out_state["open"] is False  # #1 does not exist any more
    # Re-plug both: the ordinals exist again with the recorded peer count → rebound, still disarmed.
    fake.ports["out"] = ["Morningstar MC8", "Morningstar MC8", "Volante"]
    fake.ports["in"] = ["Morningstar MC8", "Morningstar MC8"]
    for _ in range(100):
        s3 = svc.status()
        if next(e for e in s3["endpoints"] if e["endpoint_id"] == "rtmidi:out:Morningstar MC8#1")["open"]:
            break
        end.wait(0.02)
    s3 = svc.status()
    assert s3["armed"] is False
    assert next(e for e in s3["endpoints"] if e["endpoint_id"] == "rtmidi:out:Morningstar MC8#1")["open"] is True
    # A third same-named port appears: #1 still exists, but the count differs from the binding →
    # held closed as ambiguous (the position may be a different device) and the user must re-save.
    svc.sender.arm(ARM_PHRASE)
    fake.ports["out"] = ["Morningstar MC8", "Morningstar MC8", "Morningstar MC8", "Volante"]
    for _ in range(100):
        s4 = svc.status()
        if not s4["armed"]:
            break
        end.wait(0.02)
    s4 = svc.status()
    amb = next(e for e in s4["endpoints"] if e["endpoint_id"] == "rtmidi:out:Morningstar MC8#1")
    assert s4["armed"] is False and amb["ambiguous"] is True and amb["open"] is False
    assert "Re-save the binding" in amb["error"]
    # Re-saving records the new count and the port opens again (still disarmed).
    svc.save_bindings(rig, svc.get_bindings(rig))
    s5 = svc.status()
    assert next(e for e in s5["endpoints"] if e["endpoint_id"] == "rtmidi:out:Morningstar MC8#1")["open"] is True
    assert s5["armed"] is False
    svc.close()
    db.close()
