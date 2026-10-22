"""Post-review finding 2: two active mappings must not drive one physical control. Duplicates by
device + CC (across macros) are reported by the analysis, listed as problems by readiness, and
refuse Start; address-level duplicates (two instances on one channel behind one endpoint, same CC)
are caught at readiness; disabled duplicates are fine; nothing is chosen or re-addressed; the
authored data is kept; and no message is transmitted for an invalid configuration."""

from __future__ import annotations

import time

import pytest

from app.live.performance import Destination, FakeClock, PerformanceEngine
from app.live.sender import ARM_PHRASE, LiveRefused

from .test_performance_engine import armed, template, texture, world

DEMO = "rig_demo_signal_loom"


def with_duplicate(client, *, second_macro: bool, enabled: bool = True) -> str:
    rig = client.post("/api/rigs", json={"name": "Dup", "template": "virtual_instrument"}).json()
    dup = {
        "id": "map_dup",
        "instance_id": "inst_vpedal_a",
        "cc": 21,
        "output_min": 0,
        "output_max": 127,
        "enabled": enabled,
    }
    tex = rig["textures"][0]
    if second_macro:
        tex["macros"].append(
            {
                "id": "macro_two",
                "name": "Two",
                "base": 1.0,
                "mappings": [dup],
                "lfo": {"enabled": False, "shape": "triangle", "beats_per_cycle": 8, "depth": 0},
            }
        )
    else:
        tex["macros"][0]["mappings"].append(dup)
    rig["revision"] += 1
    assert client.put(f"/api/rigs/{rig['id']}", json=rig).status_code == 200  # authored data is kept
    return rig["id"]


@pytest.mark.parametrize("second_macro", [False, True])
def test_two_active_mappings_to_one_device_cc_are_reported_and_refuse_start(client, second_macro):
    rid = with_duplicate(client, second_macro=second_macro)
    a = client.get(f"/api/rigs/{rid}/analysis").json()
    diags = [d for d in a["diagnostics"] if d["code"] == "texture.destination_conflict"]
    assert len(diags) == 1 and "CC 21 on 'Virtual Pedal A (drive)'" in diags[0]["message"]
    assert set(diags[0]["related_ids"]) >= {"map_bloom_a", "map_dup", "inst_vpedal_a"}
    rep = a["textures"]["tex_undertow"]["mappings"]
    assert rep["map_bloom_a"]["conflict"] and rep["map_dup"]["conflict"] and rep["map_bloom_b"]["conflict"] is None
    assert rep["map_bloom_a"]["eligible"] is True  # eligibility is unchanged; the conflict is a separate fact
    client.post(f"/api/live/rigs/{rid}/bindings/suggest")
    client.post(f"/api/live/rigs/{rid}/connect")
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    ready = client.get(f"/api/live/rigs/{rid}/textures/tex_undertow/readiness").json()
    rows = {m["mapping_id"]: m for m in ready["mappings"]}
    assert (
        rows["map_bloom_a"]["ready"] is False
        and rows["map_dup"]["ready"] is False
        and rows["map_bloom_b"]["ready"] is True
    )
    assert any("addressed by 2 active destinations" in p for p in rows["map_dup"]["problems"])
    assert ready["can_start"] is False
    r = client.post(f"/api/live/rigs/{rid}/textures/tex_undertow/start", json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.texture_not_ready"
    time.sleep(0.2)
    assert client.app.state.live.virtual.send_count == 0
    assert client.get("/api/live/perform/status").json()["state"] == "idle"
    # Nothing was chosen or re-addressed: the stored texture is exactly as authored.
    stored = client.get(f"/api/rigs/{rid}").json()["textures"][0]
    assert sum(1 for m in stored["macros"] for d in m["mappings"] if d["cc"] == 21) == 2
    # Repair by disabling one: both the diagnostic and the block go away and the stream works.
    rig = client.get(f"/api/rigs/{rid}").json()
    for m in rig["textures"][0]["macros"]:
        for d in m["mappings"]:
            if d["id"] == "map_dup":
                d["enabled"] = False
    rig["revision"] += 1
    assert client.put(f"/api/rigs/{rid}", json=rig).status_code == 200
    a = client.get(f"/api/rigs/{rid}/analysis").json()
    assert not [d for d in a["diagnostics"] if d["code"] == "texture.destination_conflict"]
    ready = client.get(f"/api/live/rigs/{rid}/textures/tex_undertow/readiness").json()
    assert ready["can_start"] is True
    assert client.post(f"/api/live/rigs/{rid}/textures/tex_undertow/start", json={}).status_code == 200
    time.sleep(0.4)
    st = client.get("/api/live/perform/status").json()
    assert st["state"] == "performing" and [d["mapping_id"] for d in st["destinations"]] == [
        "map_bloom_a",
        "map_bloom_b",
    ]
    # Budget per physical destination: one per tick each, two per tick in total.
    assert all(d["handed"] <= st["counters"]["ticks"] for d in st["destinations"])
    assert st["counters"]["handed"] <= 2 * st["counters"]["ticks"]
    client.post("/api/live/perform/stop")
    client.post("/api/live/disconnect")


def test_a_disabled_duplicate_is_not_a_conflict(client):
    rid = with_duplicate(client, second_macro=True, enabled=False)
    a = client.get(f"/api/rigs/{rid}/analysis").json()
    assert not [d for d in a["diagnostics"] if d["code"] == "texture.destination_conflict"]
    assert a["textures"]["tex_undertow"]["mappings"]["map_bloom_a"]["conflict"] is None
    client.post(f"/api/live/rigs/{rid}/bindings/suggest")
    client.post(f"/api/live/rigs/{rid}/connect")
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    ready = client.get(f"/api/live/rigs/{rid}/textures/tex_undertow/readiness").json()
    assert ready["can_start"] is True and ready["distinct_devices"] == ["inst_vpedal_a", "inst_vpedal_b"]
    client.post("/api/live/disconnect")


def test_same_channel_behind_one_uplink_is_an_address_conflict_but_separate_uplinks_are_not(client):
    # Separate receiver networks: the two virtual pedals each have their own simulated USB; putting
    # both on channel 1 is not a collision for the performance (different endpoints).
    rig = client.post("/api/rigs", json={"name": "Same ch", "template": "virtual_instrument"}).json()
    rid = rig["id"]
    next(i for i in rig["instances"] if i["id"] == "inst_vpedal_b")["midi_channel"] = 1
    next(d for m in rig["textures"][0]["macros"] for d in m["mappings"] if d["id"] == "map_bloom_b")["cc"] = 22
    rig["revision"] += 1
    assert client.put(f"/api/rigs/{rid}", json=rig).status_code == 200
    client.post(f"/api/live/rigs/{rid}/bindings/suggest")
    client.post(f"/api/live/rigs/{rid}/connect")
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    ready = client.get(f"/api/live/rigs/{rid}/textures/tex_undertow/readiness").json()
    assert ready["can_start"] is True
    client.post("/api/live/disconnect")
    # One uplink (the MC8's USB) feeding BigSky and Sunset: put both on channel 2 and map CC 100 on
    # each — the same bytes reach both pedals, so both destinations are held back.
    rig = client.get(f"/api/rigs/{DEMO}").json()
    next(i for i in rig["instances"] if i["id"] == "inst_sunset")["midi_channel"] = 2
    rig["textures"] = [
        {
            "id": "tex_c",
            "name": "Collide",
            "tempo_bpm": 80,
            "macros": [
                {
                    "id": "m",
                    "name": "M",
                    "base": 0.5,
                    "mappings": [
                        {"id": "m_bs", "instance_id": "inst_bigsky", "cc": 100, "output_min": 0, "output_max": 127},
                        {
                            "id": "m_ss",
                            "instance_id": "inst_sunset",
                            "cc": 100,
                            "output_min": 127,
                            "output_max": 0,
                            "user_override": True,
                            "override_note": "tested",
                        },
                    ],
                    "lfo": {"enabled": False, "shape": "triangle", "beats_per_cycle": 4, "depth": 0},
                }
            ],
        }
    ]
    rig["revision"] += 1
    assert client.put(f"/api/rigs/{DEMO}", json=rig).status_code == 200
    # Device-level there is no duplicate (two different instances) …
    a = client.get(f"/api/rigs/{DEMO}/analysis").json()
    assert not [d for d in a["diagnostics"] if d["code"] == "texture.destination_conflict"]
    client.post(f"/api/live/rigs/{DEMO}/bindings/suggest")
    client.post(f"/api/live/rigs/{DEMO}/connect")
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    ready = client.get(f"/api/live/rigs/{DEMO}/textures/tex_c/readiness").json()
    rows = {m["mapping_id"]: m for m in ready["mappings"]}
    # … but at the address level both resolve to the MC8 uplink, channel 2, CC 100.
    assert rows["m_bs"]["route"]["endpoint_id"] == rows["m_ss"]["route"]["endpoint_id"] == "virt:inst_mc8:out"
    assert rows["m_bs"]["ready"] is False and rows["m_ss"]["ready"] is False
    assert any("more than one active destination" in p for p in rows["m_bs"]["problems"])
    assert ready["can_start"] is False
    items = ready["confirmations_required"]
    r = client.post(f"/api/live/rigs/{DEMO}/textures/tex_c/start", json={"acknowledge": items})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.texture_not_ready"
    assert client.app.state.live.virtual.send_count == 0
    # Moving the Sunset back to its own channel resolves it.
    rig = client.get(f"/api/rigs/{DEMO}").json()
    next(i for i in rig["instances"] if i["id"] == "inst_sunset")["midi_channel"] = 3
    rig["revision"] += 1
    assert client.put(f"/api/rigs/{DEMO}", json=rig).status_code == 200
    ready = client.get(f"/api/live/rigs/{DEMO}/textures/tex_c/readiness").json()
    assert all(m["ready"] for m in ready["mappings"])
    client.post("/api/live/disconnect")


def test_engine_refuses_duplicate_destinations_as_defense_in_depth():
    t, _ = world(2)
    s = armed(t)
    e = PerformanceEngine(s, FakeClock(), run_thread=False)
    tex = texture(2)
    dup_device = [
        Destination("m1", "macro_m", "inst_0", "inst_0", 20, 0, 127, template("inst_0", 1, 20)),
        Destination("m2", "macro_m", "inst_0", "inst_0", 20, 127, 0, template("inst_0", 1, 20)),
    ]
    with pytest.raises(LiveRefused) as x:
        e.start("rig", tex, dup_device)
    assert x.value.code == "live.destination_conflict"
    dup_address = [
        Destination("m1", "macro_m", "inst_0", "inst_0", 20, 0, 127, template("inst_0", 1, 20)),
        Destination("m2", "macro_m", "inst_9", "inst_9", 20, 0, 127, template("inst_9", 1, 20)),  # same endpoint/ch/cc
    ]
    with pytest.raises(LiveRefused) as x:
        e.start("rig", tex, dup_address)
    assert x.value.code == "live.destination_conflict"
    assert e.status()["state"] == "idle" and t.send_count == 0
    # Distinct destinations start as before.
    ok = [
        Destination("m1", "macro_m", "inst_0", "inst_0", 20, 0, 127, template("inst_0", 1, 20)),
        Destination("m2", "macro_m", "inst_1", "inst_1", 21, 127, 0, template("inst_1", 2, 21)),
    ]
    e.start("rig", tex, ok)
    assert e.status()["state"] == "performing"
    e.stop()
