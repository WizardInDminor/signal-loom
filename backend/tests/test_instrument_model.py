"""Charter §4/§9 data model: legacy rigs load with zero textures and lose nothing; a texture round
trips through save/reload/duplicate/export/import with its ids; exports without textures stay
format 1 without the key; dangling references are warnings, never repairs."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.db import Database
from app.exports.project import normalize_rig
from app.main import create_app, seed
from app.models.rig import Rig
from app.repo import RigRepository

TEX = {
    "id": "tex_test",
    "name": "Fracture",
    "intent": "pitch deepens while space contracts",
    "base_scene_id": "scene_clean",
    "tempo_bpm": 96,
    "macros": [
        {
            "id": "macro_m",
            "name": "Weight",
            "base": 0.2,
            "mappings": [
                {"id": "map_1", "instance_id": "inst_bigsky", "cc": 100, "output_min": 20, "output_max": 110},
                {
                    "id": "map_2",
                    "instance_id": "inst_sunset",
                    "cc": 100,
                    "output_min": 127,
                    "output_max": 0,
                    "user_override": True,
                    "override_note": "swept by hand on 2026-10-21",
                },
            ],
            "lfo": {"enabled": True, "shape": "triangle", "beats_per_cycle": 4, "depth": 0.5},
        }
    ],
    "function_roles": {"inst_bigsky": "space", "inst_sunset": "drive"},
}


def test_legacy_database_loads_with_zero_textures_and_nothing_else_changes(tmp_path):
    """A database left by an installation that predates textures (no ``textures`` table, migration
    0006 not recorded) is migrated on the next start: every scene, device, cable and controller plan
    is intact and every rig simply has zero textures."""
    path = tmp_path / "legacy.sqlite3"
    db = Database(path)
    db.migrate()
    seed(db)
    before = {r.id: RigRepository(db).get(r.id) for r in RigRepository(db).list()}
    with db.tx() as c:  # make the file look exactly like a Session 4 database
        c.execute("DROP TABLE textures")
        c.execute("DELETE FROM schema_migrations WHERE version = 6")
    assert max(db.applied_versions()) == 5
    db.close()
    assert before and all("textures" not in _raw_rig_row(path, rid) for rid in before)
    with TestClient(create_app(path)) as c:
        for rid, old in before.items():
            now = c.get(f"/api/rigs/{rid}").json()
            assert now["textures"] == []
            a = normalize_rig(old)
            b = normalize_rig(Rig.model_validate(now))
            assert a == b  # not a scene, device, cable or controller plan changed
        assert c.get("/api/health").status_code == 200
    db2 = Database(path)
    assert max(db2.applied_versions()) == 6
    db2.close()


def _raw_rig_row(path, rig_id) -> str:
    """Everything stored for a rig outside the textures table, as raw JSON text."""
    import sqlite3

    con = sqlite3.connect(path)
    try:
        parts = [con.execute("SELECT board || controllers FROM rigs WHERE id = ?", (rig_id,)).fetchone()[0]]
        for table in ("device_instances", "connections", "scenes"):
            parts += [r[0] for r in con.execute(f"SELECT data FROM {table} WHERE rig_id = ?", (rig_id,))]
        return "".join(parts)
    finally:
        con.close()


def test_texture_round_trip_save_reload_duplicate_export_import_keeps_ids(client):
    rig = client.get("/api/rigs/rig_demo_signal_loom").json()
    assert rig["textures"] == []
    rig["textures"] = [TEX]
    rig["revision"] += 1
    r = client.put("/api/rigs/rig_demo_signal_loom", json=rig)
    assert r.status_code == 200, r.text
    saved = r.json()["textures"][0]
    assert saved["id"] == "tex_test" and saved["macros"][0]["mappings"][1]["output_min"] == 127
    assert saved["macros"][0]["lfo"] == {"enabled": True, "shape": "triangle", "beats_per_cycle": 4.0, "depth": 0.5}
    # Reload from the database (a fresh GET), then across a backend restart.
    again = client.get("/api/rigs/rig_demo_signal_loom").json()["textures"]
    assert again == r.json()["textures"]
    # Duplicate: same texture, same ids, pointing at the same copied devices and scene.
    dup = client.post("/api/rigs/rig_demo_signal_loom/duplicate").json()
    assert dup["textures"][0]["id"] == "tex_test" and dup["textures"][0]["base_scene_id"] == "scene_clean"
    assert {m["instance_id"] for m in dup["textures"][0]["macros"][0]["mappings"]} <= {
        i["id"] for i in dup["instances"]
    }
    # Export carries the texture inside the rig (format 1, no new section) and import restores it.
    exported = client.get("/api/rigs/rig_demo_signal_loom/export").json()
    assert exported["format_version"] == 1 and exported["rig"]["textures"][0]["id"] == "tex_test"
    res = client.post("/api/rigs/import", content=json.dumps(exported)).json()
    assert res["warnings"] == []
    imported = client.get(f"/api/rigs/{res['rig']['id']}").json()
    a = normalize_rig(Rig.model_validate(exported["rig"]))
    b = normalize_rig(Rig.model_validate(imported))
    a.pop("id"), b.pop("id")
    a.pop("revision"), b.pop("revision")  # import starts a fresh revision count, as it always has
    assert a == b and imported["textures"][0]["macros"][0]["mappings"][0]["id"] == "map_1"
    # Scenes are untouched by all of this.
    assert [s["id"] for s in imported["scenes"]] == ["scene_clean", "scene_heavy", "scene_solo"]


def test_export_of_a_rig_without_textures_omits_the_key_for_older_readers(client):
    exported = client.get("/api/rigs/rig_demo_stereo/export").json()
    assert "textures" not in exported["rig"] and exported["format_version"] == 1
    # And such a file still imports (an older export never had the key either).
    assert client.post("/api/rigs/import", content=json.dumps(exported)).status_code == 201


def test_texture_survives_a_backend_restart(db_path):
    with TestClient(create_app(db_path)) as c:
        rig = c.get("/api/rigs/rig_demo_signal_loom").json()
        rig["textures"] = [TEX]
        rig["revision"] += 1
        assert c.put("/api/rigs/rig_demo_signal_loom", json=rig).status_code == 200
    with TestClient(create_app(db_path)) as c2:
        assert (
            c2.get("/api/rigs/rig_demo_signal_loom").json()["textures"][0]["macros"][0]["mappings"][1]["override_note"]
            == "swept by hand on 2026-10-21"
        )


def test_validation_unique_ids_and_bounds_and_dangling_references_are_warnings_not_repairs(client):
    rig = client.get("/api/rigs/rig_demo_signal_loom").json()
    rig["textures"] = [TEX, {**TEX}]
    rig["revision"] += 1
    assert client.put("/api/rigs/rig_demo_signal_loom", json=rig).status_code == 422  # duplicate texture id
    rig = client.get("/api/rigs/rig_demo_signal_loom").json()
    bad = json.loads(json.dumps(TEX))
    bad["tempo_bpm"] = 400
    rig["textures"] = [bad]
    rig["revision"] += 1
    assert client.put("/api/rigs/rig_demo_signal_loom", json=rig).status_code == 422
    bad = json.loads(json.dumps(TEX))
    bad["macros"][0]["mappings"][0]["output_max"] = 128
    rig["textures"] = [bad]
    assert client.put("/api/rigs/rig_demo_signal_loom", json=rig).status_code == 422
    bad = json.loads(json.dumps(TEX))
    bad["function_roles"] = {"inst_bigsky": "wizardry"}
    rig["textures"] = [bad]
    assert client.put("/api/rigs/rig_demo_signal_loom", json=rig).status_code == 422
    # Dangling references: accepted, reported, kept verbatim.
    dangling = json.loads(json.dumps(TEX))
    dangling["base_scene_id"] = "scene_gone"
    dangling["macros"][0]["mappings"][0]["instance_id"] = "inst_gone"
    rig["textures"] = [dangling]
    r = client.put("/api/rigs/rig_demo_signal_loom", json=rig)
    assert r.status_code == 200, r.text
    assert r.json()["textures"][0]["macros"][0]["mappings"][0]["instance_id"] == "inst_gone"
    a = client.get("/api/rigs/rig_demo_signal_loom/analysis").json()
    codes = [d["code"] for d in a["diagnostics"] if d["code"].startswith("texture.")]
    assert "texture.scene_missing" in codes and "texture.instance_missing" in codes
    assert "texture.mapping_user_declared" in codes  # the Sunset override is reported as the user's claim
    rep = a["textures"]["tex_test"]
    assert rep["base_scene_missing"] is True
    assert (
        rep["mappings"]["map_1"]["eligible"] is False and "no longer on the rig" in rep["mappings"]["map_1"]["reason"]
    )
    assert rep["mappings"]["map_2"] == {
        **rep["mappings"]["map_2"],
        "eligible": True,
        "basis": "user_declared",
        "at_0": 127,
        "at_half": 64,
        "at_1": 0,
        "inverted": True,
    }
    # Removing the device through an ordinary edit does not silently retarget the mapping either.
    rig = client.get("/api/rigs/rig_demo_signal_loom").json()
    rig["instances"] = [i for i in rig["instances"] if i["id"] != "inst_sunset"]
    rig["connections"] = [
        c for c in rig["connections"] if "inst_sunset" not in (c["source"]["instance_id"], c["target"]["instance_id"])
    ]
    rig["revision"] += 1
    assert client.put("/api/rigs/rig_demo_signal_loom", json=rig).status_code == 200
    a = client.get("/api/rigs/rig_demo_signal_loom/analysis").json()
    assert a["textures"]["tex_test"]["mappings"]["map_2"]["eligible"] is False
    assert sum(1 for d in a["diagnostics"] if d["code"] == "texture.instance_missing") == 2


def test_virtual_instrument_template_is_on_demand_and_labelled_synthetic(client):
    assert [r["id"] for r in client.get("/api/rigs").json()] == ["rig_demo_signal_loom", "rig_demo_stereo"]
    r = client.post("/api/rigs", json={"name": "My Undertow", "template": "virtual_instrument"})
    assert r.status_code == 201, r.text
    rig = r.json()
    assert rig["name"] == "My Undertow" and rig["id"].startswith("rig_") and rig["id"] != "rig_demo_virtual_instrument"
    tex = rig["textures"][0]
    assert tex["name"] == "Undertow" and tex["origin"] == "virtual_fixture"
    maps = tex["macros"][0]["mappings"]
    assert [(m["instance_id"], m["cc"], m["output_min"], m["output_max"]) for m in maps] == [
        ("inst_vpedal_a", 21, 100, 30),
        ("inst_vpedal_b", 22, 15, 110),
    ]
    profs = {p["id"]: p for p in client.get("/api/catalog/devices").json()}
    for pid in ("signal-loom-virtual-pedal-a", "signal-loom-virtual-pedal-b"):
        assert profs[pid]["provenance"]["source"] == "synthetic_fixture" and "synthetic" in profs[pid]["tags"]
        sweep = next(c for c in profs[pid]["midi"]["cc_map"] if c["continuous"] is True)
        assert "Synthetic" in sweep["name"]
    a = client.get(f"/api/rigs/{rig['id']}/analysis").json()
    assert a["textures"]["tex_undertow"]["eligible_devices"] == ["inst_vpedal_a", "inst_vpedal_b"]
    assert all(m["synthetic"] for m in a["textures"]["tex_undertow"]["mappings"].values())
    # The real demo rig has one documented continuous control (BigSky expression) and no synthetic ones.
    a = client.get("/api/rigs/rig_demo_signal_loom/analysis").json()
    assert a["textures"] == {}
    bs = next(c for c in profs["strymon-bigsky-mx"]["midi"]["cc_map"] if c["cc"] == 100)
    assert bs["continuous"] is True
    assert all(c.get("continuous") is None for c in profs["strymon-sunset"]["midi"]["cc_map"])
