"""The performance API end to end on the virtual transport (charter §9): zero sends from opening,
editing, previewing and readiness even while armed; Start refused while disconnected, disarmed,
not ready or unacknowledged; a running performance moves two simulated pedals in opposite
directions under the budget; auditions are refused meanwhile; only the controller may heartbeat;
Stop is open to anyone and nothing follows it; lease expiry stops; a restart is idle and disarmed;
remote clients are refused."""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.live.sender import ARM_PHRASE
from app.main import create_app

DEMO = "rig_demo_signal_loom"


def make_virtual_rig(client: TestClient) -> str:
    r = client.post("/api/rigs", json={"name": "Undertow test", "template": "virtual_instrument"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def sent_count(client: TestClient) -> int:
    return client.app.state.live.virtual.send_count


def wait_until(pred, timeout: float = 4.0):
    end = time.time() + timeout
    while time.time() < end:
        v = pred()
        if v:
            return v
        time.sleep(0.02)
    raise AssertionError("condition not met in time")


def test_preview_readiness_and_editing_never_send_even_when_armed(client):
    rig_id = make_virtual_rig(client)
    client.post(f"/api/live/rigs/{rig_id}/bindings/suggest")
    tex = "tex_undertow"
    ready = client.get(f"/api/live/rigs/{rig_id}/textures/{tex}/readiness").json()
    assert ready["can_start"] is False and any("Connect" in b for b in ready["blockers"])
    assert ready["distinct_devices"] == ["inst_vpedal_a", "inst_vpedal_b"]
    a, b = ready["mappings"]
    assert (a["values"], b["values"]) == (
        {"at_0": 100, "at_half": 65, "at_1": 30},
        {"at_0": 15, "at_half": 63, "at_1": 110},
    )
    assert a["inverted"] is True and b["inverted"] is False
    assert a["eligibility"]["basis"] == "synthetic" and a["route"]["status"] == "supported"
    # Start while disconnected: refused with a code, nothing queued.
    r = client.post(f"/api/live/rigs/{rig_id}/textures/{tex}/start", json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.not_connected"
    client.post(f"/api/live/rigs/{rig_id}/connect")
    r = client.post(f"/api/live/rigs/{rig_id}/textures/{tex}/start", json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.disarmed"
    assert client.post("/api/live/arm", json={"confirm": ARM_PHRASE}).json()["armed"] is True
    # Armed: opening, reading, editing the macro/BPM/mappings, analysing, readiness, status polling — zero sends.
    rig = client.get(f"/api/rigs/{rig_id}").json()
    rig["textures"][0]["macros"][0]["base"] = 0.8
    rig["textures"][0]["tempo_bpm"] = 100
    rig["textures"][0]["macros"][0]["mappings"][0]["output_min"] = 90
    rig["revision"] += 1
    assert client.put(f"/api/rigs/{rig_id}", json=rig).status_code == 200
    client.get(f"/api/rigs/{rig_id}/analysis")
    client.post("/api/rigs/analyze", json=rig)
    client.get(f"/api/live/rigs/{rig_id}/textures/{tex}/readiness")
    client.get("/api/live/status")
    client.get(f"/api/live/events?rig_id={rig_id}")
    client.get(f"/api/live/rigs/{rig_id}/panels")
    dup = client.post(f"/api/rigs/{rig_id}/duplicate").json()
    client.get(f"/api/rigs/{rig_id}/export")
    time.sleep(0.25)
    assert sent_count(client) == 0
    assert client.get("/api/live/status").json()["performance"]["state"] == "idle"
    assert [e for e in client.get("/api/live/events").json()["log"] if e["kind"] in ("sent", "queued")] == []
    client.delete(f"/api/rigs/{dup['id']}")
    client.post("/api/live/disconnect")


def test_start_performs_two_pedals_in_opposite_directions_then_stop_ends_everything(client):
    rig_id = make_virtual_rig(client)
    client.post(f"/api/live/rigs/{rig_id}/bindings/suggest")
    client.post(f"/api/live/rigs/{rig_id}/connect")
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    tex = "tex_undertow"
    ready = client.get(f"/api/live/rigs/{rig_id}/textures/{tex}/readiness").json()
    assert ready["can_start"] is True and ready["confirmations_required"] == [], ready["blockers"]
    r = client.post(f"/api/live/rigs/{rig_id}/textures/{tex}/start", json={})
    assert r.status_code == 200, r.text
    controller = r.json()["controller_id"]
    st = r.json()["status"]
    assert st["performance"]["state"] == "performing" and st["performance"]["texture_name"] == "Undertow"
    assert st["performance"]["budget"] == {"aggregate_per_s": 20, "per_destination_per_s": 10}

    # The simulated pedals receive the authored opposition: A falls as B rises, for one effective value.
    def both_received():
        sim = client.get("/api/live/events").json()["simulated"]
        return sim if sim.get("inst_vpedal_a", {}).get("cc") and sim.get("inst_vpedal_b", {}).get("cc") else None

    sim = wait_until(both_received)
    va, vb = sim["inst_vpedal_a"]["cc"]["21"], sim["inst_vpedal_b"]["cc"]["22"]
    assert 30 <= va <= 100 and 15 <= vb <= 110
    ea, eb = (100 - va) / 70, (vb - 15) / 95  # the same effective value, within rounding
    assert abs(ea - eb) < 0.03
    # Let it run: counts rise, the per-destination budget holds, nothing piles up.
    time.sleep(0.6)
    perf = client.get("/api/live/perform/status").json()
    assert perf["state"] == "performing" and perf["counters"]["ticks"] >= 4
    c = perf["counters"]
    assert c["handed"] <= 2 * c["ticks"] and all(d["handed"] <= c["ticks"] for d in perf["destinations"])
    assert client.get("/api/live/status").json()["queue_length"] <= 2
    # The log distinguishes performance sends from auditions and says nothing about pedal state.
    log = client.get(f"/api/live/events?rig_id={rig_id}").json()["log"]
    assert any(e["kind"] == "sent" and e["message"].startswith("performance CC") for e in log)
    assert any(e["kind"] == "note" and e["message"].startswith("PERFORMING") for e in log)
    # One deterministic rule: auditions and panel sends are refused while performing.
    r = client.post(f"/api/live/rigs/{rig_id}/scenes/scene_undertow_start/audition", json={"delay_ms": 0})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.performing"
    r = client.post(
        f"/api/live/rigs/{rig_id}/send", json={"instance_id": "inst_vpedal_a", "type": "cc", "number": 21, "value": 5}
    )
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.performing"
    r = client.post(f"/api/live/rigs/{rig_id}/textures/{tex}/start", json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.already_performing"
    # Only the controller heartbeats or changes parameters; a second tab cannot hijack.
    assert client.post("/api/live/perform/heartbeat", json={"controller_id": "someone-else"}).status_code == 409
    assert client.post("/api/live/perform/heartbeat", json={"controller_id": controller}).json()["heartbeats"] == 1
    r = client.post("/api/live/perform/params", json={"controller_id": "x", "macros": {"macro_bloom": {"base": 1.0}}})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.not_controller"
    r = client.post(
        "/api/live/perform/params",
        json={"controller_id": controller, "tempo_bpm": 90, "macros": {"macro_bloom": {"base": 1.0, "enabled": False}}},
    )
    assert r.status_code == 200 and r.json()["tempo_bpm"] == 90

    # With the LFO off and the macro at 1: A settles at 30, B at 110 — and then nothing more is sent (dedup).
    def settled():
        sim = client.get("/api/live/events").json()["simulated"]
        return sim["inst_vpedal_a"]["cc"].get("21") == 30 and sim["inst_vpedal_b"]["cc"].get("22") == 110

    wait_until(settled)
    n = sent_count(client)
    time.sleep(0.35)
    assert sent_count(client) == n
    # Stop (no controller id needed): state stopped, queue empty, and no further sends afterwards.
    st = client.post("/api/live/perform/stop").json()
    assert st["performance"]["state"] == "stopped" and st["performance"]["stopped_by"] == "user"
    assert st["armed"] is True and st["queue_length"] == 0  # Stop is not Disarm
    n = sent_count(client)
    time.sleep(0.3)
    assert sent_count(client) == n
    log = client.get(f"/api/live/events?rig_id={rig_id}").json()["log"]
    assert any(
        e["kind"] == "stopped" and "PERFORMANCE STOPPED" in e["message"] and "not undone" in e["message"] for e in log
    )
    # The saved texture was not touched by performing (runtime state is not authored intent).
    rig = client.get(f"/api/rigs/{rig_id}").json()
    assert rig["textures"][0]["macros"][0]["base"] == 0.35 and rig["textures"][0]["tempo_bpm"] == 72
    # Auditions work again after Stop.
    r = client.post(f"/api/live/rigs/{rig_id}/scenes/scene_undertow_start/audition", json={"delay_ms": 0})
    assert r.status_code == 200, r.text
    client.post("/api/live/disconnect")
    assert client.get("/api/live/status").json()["armed"] is False


def test_disarm_disconnect_and_lease_expiry_stop_a_running_performance(client):
    rig_id = make_virtual_rig(client)
    client.post(f"/api/live/rigs/{rig_id}/bindings/suggest")
    client.post(f"/api/live/rigs/{rig_id}/connect")
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    tex = "tex_undertow"
    svc = client.app.state.live
    # Disarm stops it.
    client.post(f"/api/live/rigs/{rig_id}/textures/{tex}/start", json={})
    st = client.post("/api/live/disarm").json()
    assert st["armed"] is False and st["performance"]["state"] == "stopped"
    assert st["performance"]["stop_reason"].startswith("disarmed:")
    n = sent_count(client)
    time.sleep(0.25)
    assert sent_count(client) == n
    # Re-arming never resumes.
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    assert client.get("/api/live/status").json()["performance"]["state"] == "stopped"
    # An unplugged endpoint (watcher path) stops and disarms.
    client.post(f"/api/live/rigs/{rig_id}/textures/{tex}/start", json={})
    svc.virtual.unplug("virt:inst_vpedal_a:out")
    svc.check_endpoints()
    st = client.get("/api/live/status").json()
    assert st["armed"] is False and st["performance"]["state"] == "stopped"
    svc.virtual.unplug("virt:inst_vpedal_a:out", False)
    svc.check_endpoints()
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    # Disconnect stops it.
    client.post(f"/api/live/rigs/{rig_id}/textures/{tex}/start", json={})
    st = client.post("/api/live/disconnect").json()
    assert st["performance"]["state"] == "stopped" and st["connected_rig_id"] is None
    # A short lease, no heartbeat: stops on its own while the backend stays armed.
    client.post(f"/api/live/rigs/{rig_id}/connect")
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    svc.performance.lease_s = 0.3
    r = client.post(f"/api/live/rigs/{rig_id}/textures/{tex}/start", json={})
    assert r.status_code == 200
    perf = wait_until(lambda: (p := client.get("/api/live/perform/status").json())["state"] != "performing" and p)
    assert perf["state"] == "stopped" and "lease expired" in perf["stop_reason"] and perf["stopped_by"] == "lease"
    assert client.get("/api/live/status").json()["armed"] is True
    n = sent_count(client)
    time.sleep(0.25)
    assert sent_count(client) == n
    svc.performance.lease_s = 5.0
    # A bindings change while performing stops it too (bindings change disarms).
    client.post(f"/api/live/rigs/{rig_id}/textures/{tex}/start", json={})
    b = client.get(f"/api/live/rigs/{rig_id}/bindings").json()
    b["send_delay_ms"] = 30
    client.put(f"/api/live/rigs/{rig_id}/bindings", json=b)
    assert client.get("/api/live/status").json()["performance"]["state"] == "stopped"
    client.post("/api/live/disconnect")


def test_start_is_refused_for_ineligible_unacknowledged_or_pending_states(client):
    """The real demo rig: BigSky CC 100 is documented continuous; Sunset CC 100 is unknown until the
    user declares it; both routes carry hardware prerequisites that must be acknowledged first."""
    rig = client.get(f"/api/rigs/{DEMO}").json()
    rig["textures"] = [
        {
            "id": "tex_real",
            "name": "Real test",
            "tempo_bpm": 80,
            "macros": [
                {
                    "id": "macro_r",
                    "name": "Swell",
                    "base": 0.5,
                    "mappings": [
                        {"id": "m_bs", "instance_id": "inst_bigsky", "cc": 100, "output_min": 0, "output_max": 127},
                        {"id": "m_ss", "instance_id": "inst_sunset", "cc": 100, "output_min": 127, "output_max": 0},
                    ],
                    "lfo": {"enabled": True, "beats_per_cycle": 4, "depth": 0.2},
                }
            ],
        }
    ]
    rig["revision"] += 1
    assert client.put(f"/api/rigs/{DEMO}", json=rig).status_code == 200
    client.post(f"/api/live/rigs/{DEMO}/bindings/suggest")
    client.post(f"/api/live/rigs/{DEMO}/connect")
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    ready = client.get(f"/api/live/rigs/{DEMO}/textures/tex_real/readiness").json()
    assert ready["can_start"] is False
    rows = {m["mapping_id"]: m for m in ready["mappings"]}
    assert rows["m_bs"]["eligibility"]["basis"] == "documented" and rows["m_bs"]["ready"] is True
    assert rows["m_ss"]["ready"] is False and "does not state" in rows["m_ss"]["problems"][0]
    r = client.post(f"/api/live/rigs/{DEMO}/textures/tex_real/start", json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.texture_not_ready"
    assert "Sunset CC 100" in r.json()["detail"]["message"]
    assert sent_count(client) == 0
    # The user declares the Sunset control, with a note: now both are eligible, and the routes'
    # prerequisites (Cross MIDI Thru, Omniport, the Strymon cable) must be acknowledged on Start.
    rig = client.get(f"/api/rigs/{DEMO}").json()
    m = rig["textures"][0]["macros"][0]["mappings"][1]
    m["user_override"], m["override_note"] = True, "swept by hand on the board"
    rig["revision"] += 1
    assert client.put(f"/api/rigs/{DEMO}", json=rig).status_code == 200
    ready = client.get(f"/api/live/rigs/{DEMO}/textures/tex_real/readiness").json()
    assert ready["can_start"] is False and ready["confirmations_required"]
    assert any("Omniport" in i for i in ready["confirmations_required"])
    r = client.post(f"/api/live/rigs/{DEMO}/textures/tex_real/start", json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.confirm_route"
    items = r.json()["detail"]["items"]
    assert items == ready["confirmations_required"] and sent_count(client) == 0
    assert client.get("/api/live/status").json()["performance"]["state"] == "idle"
    # A pending audition blocks Start (no racing streams).
    client.post(f"/api/live/rigs/{DEMO}/scenes/scene_solo/audition", json={"delay_ms": 300, "acknowledge": items})
    r = client.post(f"/api/live/rigs/{DEMO}/textures/tex_real/start", json={"acknowledge": items})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.texture_not_ready"
    assert "queued" in r.json()["detail"]["message"]
    client.post("/api/live/stop")
    r = client.post(f"/api/live/rigs/{DEMO}/textures/tex_real/start", json={"acknowledge": items})
    assert r.status_code == 200, r.text

    def sunset_got_cc100():
        sim = client.get("/api/live/events").json()["simulated"]
        return sim if sim.get("inst_sunset", {}).get("cc", {}).get("100") is not None else None

    sim = wait_until(sunset_got_cc100)
    assert "100" in sim["inst_bigsky"]["cc"] and "100" in sim["inst_sunset"]["cc"]
    client.post("/api/live/perform/stop")
    client.post("/api/live/disconnect")


def test_a_backend_restart_is_idle_and_disarmed_and_remote_clients_are_refused(db_path):
    with TestClient(create_app(db_path)) as c:
        rig_id = make_virtual_rig(c)
        c.post(f"/api/live/rigs/{rig_id}/bindings/suggest")
        c.post(f"/api/live/rigs/{rig_id}/connect")
        c.post("/api/live/arm", json={"confirm": ARM_PHRASE})
        r = c.post(f"/api/live/rigs/{rig_id}/textures/tex_undertow/start", json={})
        assert r.status_code == 200 and c.get("/api/live/status").json()["performance"]["state"] == "performing"
        # Shutdown while performing: the engine is closed before the sender.
    with TestClient(create_app(db_path)) as c2:
        st = c2.get("/api/live/status").json()
        assert st["armed"] is False and st["connected_rig_id"] is None
        assert st["performance"]["state"] == "idle" and st["performance"]["has_controller"] is False
        assert c2.app.state.live.virtual.send_count == 0
        # The texture itself persisted unchanged.
        assert c2.get(f"/api/rigs/{rig_id}").json()["textures"][0]["name"] == "Undertow"
        # Remote clients: every performance endpoint is loopback-only, even through the proxy.
        hdr = {"x-forwarded-for": "192.168.1.20"}
        for method, url in (
            ("get", f"/api/live/rigs/{rig_id}/textures/tex_undertow/readiness"),
            ("post", f"/api/live/rigs/{rig_id}/textures/tex_undertow/start"),
            ("post", "/api/live/perform/stop"),
            ("post", "/api/live/perform/heartbeat"),
            ("post", "/api/live/perform/params"),
            ("get", "/api/live/perform/status"),
        ):
            r = getattr(c2, method)(url, headers=hdr, **({"json": {"controller_id": "x"}} if method == "post" else {}))
            assert r.status_code == 403 and r.json()["detail"]["code"] == "live.remote_forbidden", url
