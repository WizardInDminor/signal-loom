"""Session 4 end to end over the API with the virtual transport: the P0a acceptance milestone.

Bindings live apart from the rig; the service starts disarmed; dry run sends nothing; arming is
explicit; an audition reaches the simulated pedals in order; a panel send and a capture go through
the ordinary rig PUT; disconnect disarms; hot-unplug disarms and reconnect never re-arms; the
follower never overstates; remote clients are refused."""

from __future__ import annotations

import os
import time

from fastapi.testclient import TestClient

from app.live.sender import ARM_PHRASE
from app.main import create_app

RIG = "rig_demo_signal_loom"


def settle(client: TestClient, job_id: str, timeout: float = 3.0) -> dict:
    end = time.time() + timeout
    while time.time() < end:
        st = client.get("/api/live/status").json()
        job = next((j for j in st["jobs"] if j["id"] == job_id), None)
        if job and job["done"]:
            return job
        time.sleep(0.02)
    raise AssertionError("job did not finish")


def test_cold_start_is_disarmed_and_bindings_live_outside_the_rig_document(client):
    st = client.get("/api/live/status").json()
    assert st["armed"] is False and st["mode"] == "virtual" and st["connected_rig_id"] is None
    assert st["transports"]["virtual"]["available"] is True
    # rtmidi is honestly reported; the sandbox has no native library (CI condition).
    assert "available" in st["transports"]["rtmidi"]
    # Selecting the real transport when it is unavailable is refused, never substituted.
    if not st["transports"]["rtmidi"]["available"]:
        r = client.post("/api/live/mode", json={"mode": "rtmidi"})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "live.transport_unavailable"
        assert client.get("/api/live/status").json()["mode"] == "virtual"
    # Bindings: empty by default, saved apart, never in the project file.
    assert client.get(f"/api/live/rigs/{RIG}/bindings").json()["bindings"] == []
    b = client.post(f"/api/live/rigs/{RIG}/bindings/suggest").json()
    assert {x["endpoint_id"] for x in b["bindings"]} == {"virt:inst_mc8:out", "virt:inst_mc8:in"}
    rig = client.get(f"/api/rigs/{RIG}").json()
    assert "live" not in rig and "bindings" not in rig
    export = client.get(f"/api/rigs/{RIG}/export").json()
    assert "bindings" not in export and "live" not in export and export["format_version"] == 1
    # Round trip of the bindings document with a declared channel group and delay.
    b["send_delay_ms"] = 35
    b["channel_groups"] = [{"channel": 3, "instance_ids": ["inst_sunset", "inst_bigsky"], "note": "together"}]
    saved = client.put(f"/api/live/rigs/{RIG}/bindings", json=b).json()
    assert saved["send_delay_ms"] == 35 and saved["channel_groups"][0]["channel"] == 3
    assert client.get(f"/api/live/rigs/{RIG}/bindings").json()["send_delay_ms"] == 35
    # Unknown rig → 409 with a code (not a 500).
    assert client.put("/api/live/rigs/nope/bindings", json={"rig_id": "nope"}).status_code == 409


def test_virtual_round_trip_dry_run_arm_audition_capture_reload(client):
    client.post(f"/api/live/rigs/{RIG}/bindings/suggest")
    cov = client.get(f"/api/live/rigs/{RIG}/coverage").json()
    pc = {r["label"]: r["status"] for r in cov["rows"] if r["kind"] == "pc"}
    assert pc == {"MC8": "supported", "ML10X": "supported", "BigSky MX": "supported", "Sunset": "supported"}
    # Dry run: exact bytes, order, destination; nothing transmitted; works even while disconnected.
    dry = client.post(f"/api/live/rigs/{RIG}/scenes/scene_solo/dry-run").json()
    assert dry["sent"] is False
    assert [m["summary"] for m in dry["messages"]] == [
        "CC 0 = 0 ch 10 → ML10X",
        "PC 2 ch 10 → ML10X",
        "CC 12 = 127 ch 10 → ML10X",
        "PC 2 ch 3 → Sunset",
        "CC 10 = 127 ch 3 → Sunset",
        "CC 15 = 127 ch 3 → Sunset",
        "CC 0 = 0 ch 2 → BigSky MX",
        "PC 2 ch 2 → BigSky MX",
        "CC 102 = 127 ch 2 → BigSky MX",
    ]
    assert dry["messages"][1]["hex"] == "C9 02" and all(
        m["endpoint_name"] == "Virtual USB — MC8" for m in dry["messages"]
    )
    assert client.get("/api/live/events").json()["log"] == []
    assert all(p["simulated"] is None for p in client.get(f"/api/live/rigs/{RIG}/panels").json()["panels"])
    # Audition while disconnected / disarmed: refused with a code, still nothing in the log.
    r = client.post(f"/api/live/rigs/{RIG}/scenes/scene_solo/audition", json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.not_connected"
    st = client.post(f"/api/live/rigs/{RIG}/connect").json()
    assert st["armed"] is False and st["connected_rig_id"] == RIG
    assert {e["endpoint_id"]: e["open"] for e in st["endpoints"]} == {
        "virt:inst_mc8:out": True,
        "virt:inst_mc8:in": True,
    }
    r = client.post(f"/api/live/rigs/{RIG}/scenes/scene_solo/audition", json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.disarmed"
    assert [e["kind"] for e in client.get("/api/live/events").json()["log"]] == []
    # Arm explicitly.
    assert client.post("/api/live/arm", json={"confirm": "ok"}).status_code == 409
    assert client.post("/api/live/arm", json={"confirm": ARM_PHRASE}).json()["armed"] is True
    # The routes have hardware prerequisites (Cross MIDI Thru, Omniport mode, Strymon's MIDI EXP
    # cable): the first send is refused until they are acknowledged, and nothing is queued meanwhile.
    dry = client.post(f"/api/live/rigs/{RIG}/scenes/scene_solo/dry-run").json()
    need = dry["confirmations_required"]
    assert any("Cross MIDI Thru" in n for n in need) and any("Omniport" in n for n in need)
    r = client.post(f"/api/live/rigs/{RIG}/scenes/scene_solo/audition", json={"delay_ms": 5})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.confirm_route"
    assert r.json()["detail"]["items"] == need
    assert client.get("/api/live/status").json()["queue_length"] == 0
    assert [e["kind"] for e in client.get("/api/live/events").json()["log"] if e["kind"] == "queued"] == []
    # Acknowledging a different (made-up) item does not satisfy the specific ones.
    r = client.post(
        f"/api/live/rigs/{RIG}/scenes/scene_solo/audition",
        json={"delay_ms": 5, "acknowledge": ["prerequisite: something else"]},
    )
    assert r.status_code == 409
    # Audition with a 5 ms delay after acknowledging: ordered, logged, the simulated pedals change.
    r = client.post(f"/api/live/rigs/{RIG}/scenes/scene_solo/audition", json={"delay_ms": 5, "acknowledge": need})
    assert r.status_code == 200, r.text
    assert client.post(f"/api/live/rigs/{RIG}/scenes/scene_solo/dry-run").json()["confirmations_required"] == []
    job = settle(client, r.json()["job"]["id"])
    assert job["sent"] == 9 and job["failed"] == 0
    ev = client.get("/api/live/events").json()
    sent = [e for e in ev["log"] if e["kind"] == "sent"]
    assert [e["resolved"]["summary"] for e in sent] == [m["summary"] for m in dry["messages"]]
    sim = ev["simulated"]
    assert (
        sim["inst_ml10x"]["program"] == 2
        and sim["inst_ml10x"]["bank_msb"] == 0
        and sim["inst_ml10x"]["cc"] == {"12": 127}
    )
    assert (
        sim["inst_sunset"]["program"] == 2
        and sim["inst_sunset"]["bypassed"] is False
        and sim["inst_sunset"]["cc"] == {"15": 127}
    )
    assert (
        sim["inst_bigsky"]["bypassed"] is False and sim["inst_mc8"]["program"] is None
    )  # channel 16: nothing addressed it
    # Panel: one control on the Sunset (CC 15 to 64) with coalescing; last-sent and simulated differ from the scene.
    r = client.post(
        f"/api/live/rigs/{RIG}/send",
        json={"instance_id": "inst_sunset", "type": "cc", "number": 15, "value": 64, "coalesce": True},
    )
    assert r.status_code == 200, r.text
    settle(client, r.json()["job"]["id"])
    panel = next(
        p for p in client.get(f"/api/live/rigs/{RIG}/panels").json()["panels"] if p["instance_id"] == "inst_sunset"
    )
    assert panel["last_sent"]["cc"]["15"]["value"] == 64 and panel["simulated"]["cc"] == {"15": 64}
    assert panel["observed"] is None  # nothing replied; most pedals do not
    assert panel["controls"]["bypass"]["cc"] == 10 and [c["cc"] for c in panel["controls"]["cc"]] == [15, 100]
    # Capture to scene = an ordinary revisioned PUT of the rig (the UI does this from last-sent values).
    rig = client.get(f"/api/rigs/{RIG}").json()
    scene = next(s for s in rig["scenes"] if s["id"] == "scene_solo")
    state = next(d for d in scene["device_states"] if d["instance_id"] == "inst_sunset")
    cv = next(c for c in state["cc_values"] if c["cc"] == 15)
    cv["value"] = 64
    rig["revision"] += 1
    assert client.put(f"/api/rigs/{RIG}", json=rig).status_code == 200
    dry2 = client.post(f"/api/live/rigs/{RIG}/scenes/scene_solo/dry-run").json()
    assert "CC 15 = 64 ch 3 → Sunset" in [m["summary"] for m in dry2["messages"]]
    # Stop with an empty queue is harmless; disconnect disarms and drops everything.
    assert client.post("/api/live/stop").json()["cancelled"] == 0
    st = client.post("/api/live/disconnect").json()
    assert st["armed"] is False and st["connected_rig_id"] is None and st["queue_length"] == 0
    assert client.get("/api/live/events").json()["log"][-1]["kind"] == "disarmed"
    assert st["acknowledged"] == []  # a new connection session asks again


def test_toggle_needs_confirmation_and_unsupported_routes_are_refused(client):
    client.post(f"/api/live/rigs/{RIG}/bindings/suggest")
    client.post(f"/api/live/rigs/{RIG}/connect")
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    ack = client.post(f"/api/live/rigs/{RIG}/scenes/scene_solo/dry-run").json()["confirmations_required"]
    client.post(f"/api/live/rigs/{RIG}/scenes/scene_solo/audition", json={"delay_ms": 0, "acknowledge": ack})
    r = client.post(
        f"/api/live/rigs/{RIG}/send",
        json={"instance_id": "inst_sunset", "type": "cc", "number": 15, "value": 127, "deterministic": False},
    )
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.confirm_nondeterministic"
    r = client.post(
        f"/api/live/rigs/{RIG}/send",
        json={
            "instance_id": "inst_sunset",
            "type": "cc",
            "number": 15,
            "value": 127,
            "deterministic": False,
            "confirm_nondeterministic": True,
        },
    )
    assert r.status_code == 200
    r = client.post(f"/api/live/rigs/{RIG}/send", json={"instance_id": "inst_sunset", "type": "sysex", "number": 0})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.message_type_forbidden"
    r = client.post(
        f"/api/live/rigs/{RIG}/send", json={"instance_id": "inst_plumes", "type": "cc", "number": 1, "value": 1}
    )
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.not_a_target"
    # Unbind everything: routes vanish, bindings change disarms, sends are refused as unreachable.
    b = client.get(f"/api/live/rigs/{RIG}/bindings").json()
    b["bindings"] = []
    client.put(f"/api/live/rigs/{RIG}/bindings", json=b)
    assert client.get("/api/live/status").json()["armed"] is False
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    r = client.post(
        f"/api/live/rigs/{RIG}/send", json={"instance_id": "inst_sunset", "type": "cc", "number": 15, "value": 1}
    )
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.route_unavailable"


def test_hot_unplug_disarms_and_reconnect_rebinds_without_rearming(client):
    client.post(f"/api/live/rigs/{RIG}/bindings/suggest")
    client.post(f"/api/live/rigs/{RIG}/connect")
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    svc = client.app.state.live
    svc.virtual.unplug("virt:inst_mc8:out")
    st = client.post("/api/live/refresh").json()
    assert st["armed"] is False
    assert next(e for e in st["endpoints"] if e["endpoint_id"] == "virt:inst_mc8:out")["missing"] is True
    assert any("endpoint lost" in e["message"] for e in client.get("/api/live/events").json()["log"])
    cov = client.get(f"/api/live/rigs/{RIG}/coverage").json()
    assert all(r["status"] == "unreachable" for r in cov["rows"] if r["kind"] == "pc")
    svc.virtual.unplug("virt:inst_mc8:out", False)
    st = client.post("/api/live/refresh").json()
    assert next(e for e in st["endpoints"] if e["endpoint_id"] == "virt:inst_mc8:out")["open"] is True
    assert st["armed"] is False  # detect-and-rebind only
    # Port contention: busy endpoint reported, send refused, release/reacquire are explicit.
    svc.virtual.set_busy("virt:inst_mc8:out", True)
    st = client.post("/api/live/refresh").json()
    ep = next(e for e in st["endpoints"] if e["endpoint_id"] == "virt:inst_mc8:out")
    assert ep["busy"] is True and "another application" in ep["error"]
    svc.virtual.set_busy("virt:inst_mc8:out", False)
    st = client.post("/api/live/release", json={"endpoint_id": "virt:inst_mc8:out"}).json()
    assert next(e for e in st["endpoints"] if e["endpoint_id"] == "virt:inst_mc8:out")["released"] is True
    st = client.post("/api/live/reacquire", json={"endpoint_id": "virt:inst_mc8:out"}).json()
    assert (
        next(e for e in st["endpoints"] if e["endpoint_id"] == "virt:inst_mc8:out")["open"] is True
        and st["armed"] is False
    )


def test_follower_reports_possible_ambiguous_or_no_evidence_never_certainty(client):
    client.post(f"/api/live/rigs/{RIG}/bindings/suggest")
    f = client.get(f"/api/live/rigs/{RIG}/follower").json()
    assert f["listening"] is False and "Connect the rig" in f["text"]
    client.post(f"/api/live/rigs/{RIG}/connect")
    f = client.get(f"/api/live/rigs/{RIG}/follower").json()
    assert f["listening"] is True and f["status"] == "no_evidence"

    def inj(t, ch, n, v=None):
        return client.post(
            "/api/live/virtual/inject",
            json={"endpoint_id": "virt:inst_mc8:in", "type": t, "channel": ch, "number": n, "value": v},
        )

    # Part of the Solo scene: ambiguous/incomplete.
    assert inj("pc", 10, 2).status_code == 200
    f = client.get(f"/api/live/rigs/{RIG}/follower").json()
    assert f["status"] == "ambiguous" and "incomplete" in f["text"]
    # Every message of Solo: "possible", with the caveat spelled out.
    for t, ch, n, v in [
        ("cc", 10, 0, 0),
        ("cc", 10, 12, 127),
        ("pc", 3, 2, None),
        ("cc", 3, 10, 127),
        ("cc", 3, 15, 127),
        ("cc", 2, 0, 0),
        ("pc", 2, 2, None),
        ("cc", 2, 102, 127),
    ]:
        inj(t, ch, n, v)
    f = client.get(f"/api/live/rigs/{RIG}/follower").json()
    assert f["status"] == "possible" and f["candidates"][0]["scene_name"] == "Solo"
    assert "does not prove which footswitch" in f["text"]
    # Observed messages are listed as observations, decoded, with their input name.
    ev = client.get("/api/live/events").json()
    assert (
        ev["observed"][0]["summary"] == "PC 2 ch 10"
        and ev["observed"][0]["endpoint_name"] == "Virtual USB — MC8 (to computer)"
    )
    panel = next(
        p for p in client.get(f"/api/live/rigs/{RIG}/panels").json()["panels"] if p["instance_id"] == "inst_ml10x"
    )
    assert (
        panel["observed"]["program"] == 2 and panel["simulated"]["program"] is None
    )  # observation ≠ simulated pedal state
    # SysEx cannot be injected either: the encoder refuses it.
    assert inj("sysex", 1, 0).status_code == 422
    # A new connection session starts with an empty observation window.
    client.post("/api/live/disconnect")
    client.post(f"/api/live/rigs/{RIG}/connect")
    assert client.get("/api/live/events").json()["observed"] == []
    assert client.get(f"/api/live/rigs/{RIG}/follower").json()["status"] == "no_evidence"


def test_remote_clients_are_refused(client):
    assert client.get("/api/live/status", headers={"x-forwarded-for": "192.168.1.20"}).status_code == 403
    assert client.get("/api/live/status", headers={"x-forwarded-for": "127.0.0.1"}).status_code == 200
    assert (
        client.post(
            "/api/live/arm", json={"confirm": ARM_PHRASE}, headers={"x-forwarded-for": "10.0.0.5, 127.0.0.1"}
        ).status_code
        == 403
    )


def test_restart_starts_disarmed_and_keeps_bindings(db_path):
    os.environ.pop("SIGNAL_LOOM_NO_DEMO", None)
    with TestClient(create_app(db_path)) as c:
        c.post(f"/api/live/rigs/{RIG}/bindings/suggest")
        c.post(f"/api/live/rigs/{RIG}/connect")
        c.post("/api/live/arm", json={"confirm": ARM_PHRASE})
        assert c.get("/api/live/status").json()["armed"] is True
    with TestClient(create_app(db_path)) as c:
        st = c.get("/api/live/status").json()
        assert st["armed"] is False and st["connected_rig_id"] is None
        assert len(c.get(f"/api/live/rigs/{RIG}/bindings").json()["bindings"]) == 2
        # Deleting the rig removes its workstation-local bindings too.
        c.delete(f"/api/rigs/{RIG}")
        assert c.get(f"/api/live/rigs/{RIG}/bindings").json()["bindings"] == []


def test_unverified_route_needs_a_specific_acknowledgement_before_anything_is_queued(client):
    """ML10X bound by its own USB: the BigSky behind the ML10X's Thru is 'unverified' (USB → Thru
    forwarding is undocumented). A panel send to it is refused with the exact hop named, nothing is
    queued, and it goes out only once that item is acknowledged; the acknowledgement is remembered
    for the session and forgotten on reconnect."""
    b = client.get(f"/api/live/rigs/{RIG}/bindings").json()
    b["bindings"] = [
        {"endpoint_id": "virt:inst_ml10x:out", "instance_id": "inst_ml10x", "port_id": "usb", "direction": "out"}
    ]
    client.put(f"/api/live/rigs/{RIG}/bindings", json=b)
    client.post(f"/api/live/rigs/{RIG}/connect")
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    body = {"instance_id": "inst_bigsky", "type": "pc", "number": 3}
    r = client.post(f"/api/live/rigs/{RIG}/send", json=body)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.confirm_route"
    items = r.json()["detail"]["items"]
    assert (
        len(items) == 1 and items[0].startswith("unverified route to BigSky MX for PC") and "not documented" in items[0]
    )
    assert client.app.state.live.virtual.send_count == 0
    r = client.post(f"/api/live/rigs/{RIG}/send", json={**body, "acknowledge": items})
    assert r.status_code == 200 and "unverified" in r.json()["warnings"][0]
    settle(client, r.json()["job"]["id"])
    assert client.app.state.live.virtual.send_count == 1
    # Remembered within the session…
    assert client.post(f"/api/live/rigs/{RIG}/send", json=body).status_code == 200
    # …and the ML10X's own USB route asks for its own, different prerequisite (DC power for the relays).
    r = client.post(f"/api/live/rigs/{RIG}/send", json={"instance_id": "inst_ml10x", "type": "pc", "number": 1})
    assert r.status_code == 409
    assert r.json()["detail"]["items"] == [
        "prerequisite: ML10X powered from its DC inlet (USB alone does not switch relays)"
    ]
    r = client.post(
        f"/api/live/rigs/{RIG}/send",
        json={"instance_id": "inst_ml10x", "type": "pc", "number": 1, "acknowledge": r.json()["detail"]["items"]},
    )
    assert r.status_code == 200
    # Reconnect: asked again.
    client.post(f"/api/live/rigs/{RIG}/connect")
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    assert client.post(f"/api/live/rigs/{RIG}/send", json=body).status_code == 409


def test_idle_armed_session_is_disarmed_automatically_when_an_endpoint_vanishes(db_path, monkeypatch):
    """No rescan, no send, no UI: the backend watcher notices the loss and disarms."""
    monkeypatch.setenv("SIGNAL_LOOM_LIVE_WATCH_S", "0.05")
    os.environ.pop("SIGNAL_LOOM_NO_DEMO", None)
    with TestClient(create_app(db_path)) as client:
        svc = client.app.state.live
        assert svc.watch_interval_s == 0.05
        client.post(f"/api/live/rigs/{RIG}/bindings/suggest")
        st = client.post(f"/api/live/rigs/{RIG}/connect").json()
        assert st["watching"] is True
        client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
        assert client.get("/api/live/status").json()["armed"] is True
        checks_before = svc.check_count
        svc.virtual.unplug("virt:inst_mc8:out")
        deadline = time.time() + 3.0
        while time.time() < deadline and client.get("/api/live/status").json()["armed"]:
            time.sleep(0.02)
        st = client.get("/api/live/status").json()
        assert st["armed"] is False
        assert next(e for e in st["endpoints"] if e["endpoint_id"] == "virt:inst_mc8:out")["missing"] is True
        assert svc.check_count > checks_before and st["last_check_at"] is not None
        assert any(
            "endpoint change: lost virt:inst_mc8:out" in e["message"]
            for e in client.get("/api/live/events").json()["log"]
        )
        # The simulated pedals were not reset by the watcher (unlike a manual rescan).
        assert set(client.get("/api/live/events").json()["simulated"]) == {
            "inst_mc8",
            "inst_ml10x",
            "inst_bigsky",
            "inst_sunset",
        }
        # It comes back: rebound by the watcher, still disarmed, and an audition is refused until re-armed.
        svc.virtual.unplug("virt:inst_mc8:out", False)
        deadline = time.time() + 3.0
        while (
            time.time() < deadline
            and not next(
                e for e in client.get("/api/live/status").json()["endpoints"] if e["endpoint_id"] == "virt:inst_mc8:out"
            )["open"]
        ):
            time.sleep(0.02)
        st = client.get("/api/live/status").json()
        assert next(e for e in st["endpoints"] if e["endpoint_id"] == "virt:inst_mc8:out")["open"] is True
        assert st["armed"] is False
        assert (
            client.post(f"/api/live/rigs/{RIG}/scenes/scene_solo/audition", json={}).json()["detail"]["code"]
            == "live.disarmed"
        )
        # Disconnect stops watching that rig; the thread stays idle.
        assert client.post("/api/live/disconnect").json()["watching"] is False


def test_a_failed_port_enumeration_fails_closed_while_armed_and_never_rearms(client):
    """The watcher (or a manual check) cannot establish whether the bound ports are still there:
    disarm, drop the queue, record the cause; a later good probe rebinds but leaves it disarmed."""
    svc = client.app.state.live
    client.post(f"/api/live/rigs/{RIG}/bindings/suggest")
    client.post(f"/api/live/rigs/{RIG}/connect")
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    ack = client.post(f"/api/live/rigs/{RIG}/scenes/scene_solo/dry-run").json()["confirmations_required"]
    # Queue a slow audition so there is something pending when enumeration breaks.
    r = client.post(f"/api/live/rigs/{RIG}/scenes/scene_solo/audition", json={"delay_ms": 300, "acknowledge": ack})
    assert r.status_code == 200
    good_enumerate = svc.virtual.enumerate

    def broken():
        raise RuntimeError("MMSYSERR_NODRIVER: midiOutGetDevCaps failed")

    svc.virtual.enumerate = broken
    result = svc.check_endpoints()  # exactly what the watcher thread calls
    assert "MMSYSERR_NODRIVER" in result["error"]
    st = client.get("/api/live/status").json()
    assert st["armed"] is False and st["queue_length"] == 0
    assert "MMSYSERR_NODRIVER" in st["last_check_error"]
    assert all("last port check failed" in (e["error"] or "") for e in st["endpoints"])
    log = client.get("/api/live/events").json()["log"]
    dis = next(e for e in log if e["kind"] == "disarmed")
    assert "port enumeration failed" in dis["message"] and "MMSYSERR_NODRIVER" in dis["message"]
    assert any(e["kind"] == "cancelled" for e in log)
    # Enumeration recovers: endpoints are still open/rebound, the error clears, still disarmed.
    svc.virtual.enumerate = good_enumerate
    svc.check_endpoints()
    st = client.get("/api/live/status").json()
    assert st["armed"] is False and st["last_check_error"] is None
    assert next(e for e in st["endpoints"] if e["endpoint_id"] == "virt:inst_mc8:out")["open"] is True
    assert (
        client.post(f"/api/live/rigs/{RIG}/scenes/scene_solo/audition", json={}).json()["detail"]["code"]
        == "live.disarmed"
    )
    # Disarmed and idle: a failure is recorded but there is nothing to drop.
    svc.virtual.enumerate = broken
    svc.check_endpoints()
    assert client.get("/api/live/status").json()["last_check_error"] is not None
    svc.virtual.enumerate = good_enumerate
