"""Deterministic interleaving tests for the sender's in-flight semantics (PR #4 review, item 1).

A blocking fake transport parks the worker *inside* ``transport.send`` while holding the sender
lock. From another thread we call disarm / stop / attach_transport(None) and prove that (a) the
call does not return while the send is in flight, (b) once it returns, the message behind the
in-flight one is cancelled and never transmitted, and (c) exactly the in-flight message is logged
as sent. The same is shown through the service for disconnect, endpoint release and a mode switch.
No sleeps decide the outcome: every step waits on an Event.
"""

from __future__ import annotations

import threading

import pytest

from app.live.sender import ARM_PHRASE, LiveSender
from app.live.transport import EndpointInfo
from app.live.virtual import VirtualTransport

from .test_live_sender import resolved, wait


class BlockingTransport(VirtualTransport):
    """send() signals ``entered`` and then blocks until ``release`` is set."""

    def __init__(self) -> None:
        super().__init__()
        self.entered = threading.Event()
        self.release = threading.Event()
        self.set_world([EndpointInfo("virt:x:out", "Virtual X", "out", "virtual")], {})
        self.open_output("virt:x:out")

    def send(self, endpoint_id: str, data: bytes) -> None:
        self.entered.set()
        assert self.release.wait(timeout=5.0), "test did not release the blocked send"
        super().send(endpoint_id, data)


def armed_sender(t: BlockingTransport) -> LiveSender:
    s = LiveSender()
    s.attach_transport(t)
    s.arm(ARM_PHRASE)
    return s


def start_blocked_audition(s: LiveSender, t: BlockingTransport, n: int = 3):
    job, _ = s.audition("race", [resolved("cc", 20 + i, 1) for i in range(n)], delay_ms=0)
    assert t.entered.wait(timeout=5.0), "worker never entered send"
    # Lock-free peek: status() itself takes the sender lock and would wait for the send to finish.
    assert s.in_flight is not None and s.in_flight.resolved.number == 20
    return job


def run_in_thread(fn):
    done = threading.Event()
    result: dict = {}

    def target():
        try:
            result["value"] = fn()
        except Exception as e:  # pragma: no cover - surfaced by the assertion below
            result["error"] = e
        finally:
            done.set()

    threading.Thread(target=target, daemon=True).start()
    return done, result


@pytest.mark.parametrize("action", ["disarm", "stop", "disconnect", "close"])
def test_control_calls_block_during_an_in_flight_send_and_nothing_starts_after_them(action):
    t = BlockingTransport()
    s = armed_sender(t)
    job = start_blocked_audition(s, t)
    call = {
        "disarm": lambda: s.disarm("user"),
        "stop": lambda: s.stop(),
        "disconnect": lambda: s.attach_transport(None),
        "close": lambda: s.close(),
    }[action]
    done, result = run_in_thread(call)
    # The control call cannot complete while the first message is being handed to the transport.
    assert not done.wait(timeout=0.3), f"{action} returned while a send was in flight"
    assert t.send_count == 0  # the bytes have not left yet either
    t.release.set()
    assert done.wait(timeout=5.0), f"{action} never returned after the send completed"
    assert "error" not in result
    j = wait(s, job.id)
    # Exactly the in-flight message went out; the two behind it were cancelled, none sent later.
    assert t.send_count == 1 and [r.data[1] for r in t.sent] == [20]
    assert j.sent == 1 and j.cancelled == 2 and j.failed == 0
    kinds = [e.kind for e in s.log()]
    assert kinds.count("sent") == 1 and kinds.count("cancelled") == 2
    if action in ("disarm", "disconnect", "close"):
        assert s.armed is False
    else:
        assert s.armed is True  # Stop cancels, it does not disarm
        assert kinds[-1] in ("stopped", "cancelled")
    # The log is explicit about what was and was not undone.
    assert any("not undone" in e.message for e in s.log() if e.kind in ("stopped", "disarmed"))
    assert s.status()["in_flight"] is None


def test_a_disarm_that_wins_the_race_cancels_everything_and_sends_nothing():
    """Disarm acquired first: the worker finds ``armed`` false in the same critical section."""
    t = BlockingTransport()
    s = LiveSender()
    s.attach_transport(t)
    s.arm(ARM_PHRASE)
    # Hold the lock ourselves so the worker cannot start a send, queue, then disarm before releasing.
    with s._lock:
        job, _ = s.audition("race", [resolved("cc", 30, 1), resolved("cc", 31, 1)], delay_ms=0)
        s.disarm("user")
    j = wait(s, job.id)
    assert t.send_count == 0 and j.cancelled == 2 and j.sent == 0
    assert not t.entered.is_set()


def test_service_disconnect_release_and_mode_switch_wait_for_the_in_flight_send(tmp_path, monkeypatch):
    from app.db import Database
    from app.live.service import LiveService
    from app.main import seed

    db = Database(tmp_path / "race.sqlite3")
    db.migrate()
    seed(db)
    svc = LiveService(db)
    rig = "rig_demo_signal_loom"
    for action in ("disconnect", "release", "mode"):
        blocking = BlockingTransport()
        svc.virtual = blocking  # the service's virtual transport, replaced by the blocking fake
        svc.suggest_bindings(rig)
        svc.connect(rig)
        assert blocking.is_open("virt:inst_mc8:out")
        svc.sender.arm(ARM_PHRASE)
        ack = svc.dry_run(rig, "scene_solo")["confirmations_required"]
        svc.audition(rig, "scene_solo", 0, False, ack)
        assert blocking.entered.wait(timeout=5.0)
        if action == "disconnect":
            done, result = run_in_thread(svc.disconnect)
        elif action == "release":
            done, result = run_in_thread(lambda: svc.release("virt:inst_mc8:out"))
        else:
            monkeypatch.setattr(svc.rtmidi, "available", lambda: (True, None))
            monkeypatch.setattr(svc.rtmidi, "enumerate", lambda: [])
            done, result = run_in_thread(lambda: svc.set_mode("rtmidi"))
        assert not done.wait(timeout=0.3), f"{action} returned during an in-flight send"
        blocking.release.set()
        assert done.wait(timeout=5.0) and "error" not in result
        st = svc.status()
        assert st["armed"] is False and st["queue_length"] == 0 and st["in_flight"] is None
        assert blocking.send_count == 1  # the one in flight; nothing behind it
        svc.disconnect()
        svc.set_mode("virtual") if action == "mode" else None
        svc._released.clear()
    svc.close()
    db.close()
