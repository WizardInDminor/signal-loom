"""Post-review finding 1: the rig's MIDI addressing and the performing texture's destinations are
locked while a performance runs. Safety-relevant saves are refused (409 live.performing_locked)
through every mutation path — rig PUT, rig DELETE, MC8 bank import, catalog profile edits — while
the musician's mid-performance edits (macro base, LFO, tempo, names, notes, scenes, other textures,
the MC8 plan, positions) still save. The engine never streams to an obsolete address."""

from __future__ import annotations

import json
import time

from app.live.guard import rig_mutation_conflicts
from app.live.sender import ARM_PHRASE
from app.models.rig import Rig

LOCKED = "live.performing_locked"


def start_undertow(client) -> str:
    rig = client.post("/api/rigs", json={"name": "Guard", "template": "virtual_instrument"}).json()
    rid = rig["id"]
    client.post(f"/api/live/rigs/{rid}/bindings/suggest")
    client.post(f"/api/live/rigs/{rid}/connect")
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    r = client.post(f"/api/live/rigs/{rid}/textures/tex_undertow/start", json={})
    assert r.status_code == 200, r.text
    return rid


def fresh(client, rid):
    rig = client.get(f"/api/rigs/{rid}").json()
    rig["revision"] += 1
    return rig


def put(client, rid, rig):
    return client.put(f"/api/rigs/{rid}", json=rig)


def channels_on_wire(client) -> set[int]:
    return {(rec.data[0] & 0x0F) + 1 for rec in client.app.state.live.virtual.sent if rec.data[0] & 0xF0 == 0xB0}


def test_channel_routing_device_and_destination_changes_are_refused_while_performing(client):
    rid = start_undertow(client)
    time.sleep(0.25)
    # 1. A targeted device's MIDI channel.
    rig = fresh(client, rid)
    next(i for i in rig["instances"] if i["id"] == "inst_vpedal_a")["midi_channel"] = 7
    r = put(client, rid, rig)
    assert r.status_code == 409 and r.json()["detail"]["code"] == LOCKED, r.text
    assert "MIDI channel 1 → 7" in r.json()["detail"]["message"]
    # 2. Physical MIDI routing: a new cable / a changed cable.
    rig = fresh(client, rid)
    rig["connections"].append(
        {
            "kind": "midi",
            "source": {"instance_id": "inst_vpedal_a", "port_id": "usb"},
            "target": {"instance_id": "inst_vpedal_b", "port_id": "usb"},
        }
    )
    assert put(client, rid, rig).json()["detail"]["code"] == LOCKED
    rig = fresh(client, rid)
    rig["connections"] = rig["connections"][1:]
    assert put(client, rid, rig).json()["detail"]["code"] == LOCKED
    # 3. Removing a device referenced by the active texture (and adding one).
    rig = fresh(client, rid)
    rig["instances"] = [i for i in rig["instances"] if i["id"] != "inst_vpedal_b"]
    rig["connections"] = [
        c for c in rig["connections"] if "inst_vpedal_b" not in (c["source"]["instance_id"], c["target"]["instance_id"])
    ]
    r = put(client, rid, rig)
    assert r.status_code == 409 and "removed" in r.json()["detail"]["message"]
    rig = fresh(client, rid)
    rig["instances"].append({**rig["instances"][0], "id": "inst_new", "label": "New pedal", "x_mm": 300})
    assert put(client, rid, rig).json()["detail"]["code"] == LOCKED
    # 4. The device's profile or jacks on the instance.
    rig = fresh(client, rid)
    next(i for i in rig["instances"] if i["id"] == "inst_vpedal_a")["profile_id"] = "signal-loom-virtual-pedal-b"
    assert put(client, rid, rig).json()["detail"]["code"] == LOCKED
    rig = fresh(client, rid)
    next(i for i in rig["instances"] if i["id"] == "inst_vpedal_a")["removed_port_ids"] = ["usb"]
    assert put(client, rid, rig).json()["detail"]["code"] == LOCKED
    # 5. The active texture's destinations: range, CC, enabled, override, a removed macro, the texture itself.
    for mutate in (
        lambda t: t["macros"][0]["mappings"][0].__setitem__("output_max", 60),
        lambda t: t["macros"][0]["mappings"][1].__setitem__("cc", 23),
        lambda t: t["macros"][0]["mappings"][1].__setitem__("enabled", False),
        lambda t: t["macros"][0]["mappings"].append(
            {"id": "map_x", "instance_id": "inst_vpedal_b", "cc": 23, "output_min": 0, "output_max": 127}
        ),
        lambda t: t["macros"].clear(),
    ):
        rig = fresh(client, rid)
        mutate(rig["textures"][0])
        r = put(client, rid, rig)
        assert r.status_code == 409 and r.json()["detail"]["code"] == LOCKED, r.text
    rig = fresh(client, rid)
    rig["textures"] = []
    assert "removed" in put(client, rid, rig).json()["detail"]["message"]
    # 6. Deleting the performing rig.
    r = client.delete(f"/api/rigs/{rid}")
    assert r.status_code == 409 and r.json()["detail"]["code"] == LOCKED
    # Throughout: still performing, still on the resolved channels 1 and 2 only, stored rig unchanged.
    st = client.get("/api/live/perform/status").json()
    assert st["state"] == "performing" and [d["channel"] for d in st["destinations"]] == [1, 2]
    stored = client.get(f"/api/rigs/{rid}").json()
    assert next(i for i in stored["instances"] if i["id"] == "inst_vpedal_a")["midi_channel"] == 1
    assert len(stored["instances"]) == 4 and len(stored["textures"][0]["macros"][0]["mappings"]) == 2
    time.sleep(0.3)
    assert channels_on_wire(client) == {1, 2}
    # After Stop every one of those saves is allowed again, and a new Start uses the new address.
    client.post("/api/live/perform/stop")
    rig = fresh(client, rid)
    next(i for i in rig["instances"] if i["id"] == "inst_vpedal_a")["midi_channel"] = 7
    assert put(client, rid, rig).status_code == 200
    client.app.state.live.virtual.sent.clear()
    r = client.post(f"/api/live/rigs/{rid}/textures/tex_undertow/start", json={})
    assert r.status_code == 200, r.text
    assert [d["channel"] for d in client.get("/api/live/perform/status").json()["destinations"]] == [7, 2]
    time.sleep(0.3)
    assert channels_on_wire(client) <= {7, 2} and 7 in channels_on_wire(client)
    client.post("/api/live/perform/stop")
    assert client.delete(f"/api/rigs/{rid}").status_code == 204
    client.post("/api/live/disconnect")


def test_permitted_edits_still_save_while_performing(client):
    rid = start_undertow(client)
    # Macro base, LFO, tempo, names, notes, starting scene, function roles — the gesture and its words.
    rig = fresh(client, rid)
    t = rig["textures"][0]
    t["macros"][0]["base"] = 0.9
    t["macros"][0]["lfo"] = {"enabled": False, "shape": "triangle", "beats_per_cycle": 2, "depth": 0.6}
    t["macros"][0]["name"] = "Swell"
    t["tempo_bpm"] = 110
    t["name"], t["intent"], t["notes"] = "Undertow (live)", "deeper", "worked tonight"
    t["base_scene_id"] = None
    t["function_roles"] = {"inst_vpedal_a": "other"}
    assert put(client, rid, rig).status_code == 200
    # Another texture, scenes, the MC8 plan, board, positions, labels, rig name/notes.
    rig = fresh(client, rid)
    rig["textures"].append({**json.loads(json.dumps(rig["textures"][0])), "id": "tex_other", "name": "Other"})
    rig["scenes"][0]["name"] = "renamed scene"
    rig["scenes"][0]["device_states"][0]["program"]["pc"] = 3
    rig["controllers"]["mc8"]["banks"] = [{"number": 1, "name": "B", "presets": []}]
    rig["board"]["width_mm"] = 500
    rig["instances"][0]["x_mm"] = 99
    rig["instances"][0]["label"] = "Pedal A renamed"
    rig["name"], rig["notes"] = "Guard renamed", "note"
    assert put(client, rid, rig).status_code == 200
    assert client.patch(f"/api/rigs/{rid}", json={"name": "Guard again"}).status_code == 200
    # Profile edits that do not touch the performing rig's devices pass; edits to its devices do not.
    plumes = client.get("/api/catalog/devices/eqd-plumes").json()
    plumes["notes"] = "edited during a performance of another rig"
    assert client.put("/api/catalog/devices/eqd-plumes", json=plumes).status_code == 200
    pa = client.get("/api/catalog/devices/signal-loom-virtual-pedal-a").json()
    pa["midi"]["cc_map"][0]["continuous"] = False
    r = client.put("/api/catalog/devices/signal-loom-virtual-pedal-a", json=pa)
    assert r.status_code == 409 and r.json()["detail"]["code"] == LOCKED
    r = client.put("/api/catalog/devices/signal-loom-virtual-pedal-a/commands", json={"commands": []})
    assert r.status_code == 409 and r.json()["detail"]["code"] == LOCKED
    r = client.post("/api/catalog/devices/signal-loom-virtual-pedal-a/commands/from-map")
    assert r.status_code == 409
    r = client.post("/api/catalog/devices/signal-loom-virtual-pedal-b/midi-capability", json={"interfaces": ["din_in"]})
    assert r.status_code == 409
    r = client.put(
        "/api/catalog/devices/signal-loom-virtual-pedal-a/ports", json={"ports": pa["ports"][:2], "force": True}
    )
    assert r.status_code == 409
    assert client.delete("/api/catalog/devices/signal-loom-virtual-pedal-a").status_code == 409
    assert (
        client.get("/api/catalog/devices/signal-loom-virtual-pedal-a").json()["midi"]["cc_map"][0]["continuous"] is True
    )
    # The stream kept running through all of it, on its resolved channels; the live params API still works.
    st = client.get("/api/live/perform/status").json()
    assert st["state"] == "performing"
    assert [d["channel"] for d in st["destinations"]] == [1, 2]
    # Bindings changes still disarm → stop (unchanged Session 4 rule), and after Stop the profile edit passes.
    client.post("/api/live/perform/stop")
    assert (
        client.put("/api/catalog/devices/signal-loom-virtual-pedal-a/commands", json={"commands": []}).status_code
        == 200
    )
    client.post("/api/live/disconnect")


def test_mc8_bank_import_passes_while_performing_and_rename_too(client):
    rid = start_undertow(client)
    bank = {
        "dumpType": "singleBank",
        "deviceModel": 1,
        "data": {"bankName": "X", "bankMsgArray": [], "presetArray": []},
    }
    r = client.post(f"/api/rigs/{rid}/import/mc8-bank", content=json.dumps(bank))
    # Whatever the importer thinks of this minimal file, it is never refused for the performance's sake.
    assert r.status_code != 409 or r.json()["detail"].get("code") != LOCKED
    client.post("/api/live/perform/stop")
    client.post("/api/live/disconnect")


def test_rig_mutation_conflicts_is_precise():
    from app.catalog.demo import virtual_instrument_rig

    old = virtual_instrument_rig()
    new = Rig.model_validate(old.model_dump(mode="json"))
    assert rig_mutation_conflicts(old, new, "tex_undertow") == []
    new.textures[0].macros[0].base = 1.0
    new.textures[0].macros[0].lfo.depth = 1.0
    new.textures[0].tempo_bpm = 200
    new.textures[0].name = "x"
    new.instances[0].x_mm = 5
    assert rig_mutation_conflicts(old, new, "tex_undertow") == []
    new.instances[0].midi_channel = 9
    new.textures[0].macros[0].mappings[0].output_min = 1
    reasons = rig_mutation_conflicts(old, new, "tex_undertow")
    assert any("MIDI channel 1 → 9" in r for r in reasons) and any("destinations" in r for r in reasons)
    # Changes to a texture that is not performing are not conflicts.
    other = Rig.model_validate(old.model_dump(mode="json"))
    other.textures.append(old.textures[0].model_copy(update={"id": "tex_b", "name": "b"}))
    base = Rig.model_validate(other.model_dump(mode="json"))
    other.textures[1].macros[0].mappings[0].cc = 99
    assert rig_mutation_conflicts(base, other, "tex_undertow") == []


def test_the_guard_shares_the_service_lock_with_start(client):
    """The check and the save hold the live service lock — the same lock Start's resolution holds —
    so a save cannot interleave with Start. A no-op save while performing passes through it."""
    svc = client.app.state.live
    assert svc.mutation_guard() is svc._lock
    rid = start_undertow(client)
    assert put(client, rid, fresh(client, rid)).status_code == 200  # unchanged document: not a conflict
    assert client.get("/api/live/perform/status").json()["state"] == "performing"
    client.post("/api/live/perform/stop")
    client.post("/api/live/disconnect")
