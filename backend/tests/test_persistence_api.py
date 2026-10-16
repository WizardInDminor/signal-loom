import json

from fastapi.testclient import TestClient

from app.db import Database
from app.exports.project import ProjectImportError, normalize_rig, parse_project
from app.main import create_app, seed
from app.models.rig import Rig
from app.repo import RigRepository


def test_cold_start_seeds_catalog_and_demo(client):
    rigs = client.get("/api/rigs").json()
    assert len(rigs) == 1 and rigs[0]["instance_count"] == 8 and rigs[0]["scene_count"] == 3
    devices = client.get("/api/catalog/devices").json()
    assert {d["id"] for d in devices} >= {
        "morningstar-mc8",
        "morningstar-ml10x",
        "strymon-sunset",
        "strymon-bigsky-mx",
        "eqd-plumes",
    }
    plumes = next(d for d in devices if d["id"] == "eqd-plumes")
    assert "port.in.position" in plumes["unknown_attributes"]


def test_rig_survives_backend_restart_with_same_ids(db_path):
    with TestClient(create_app(db_path)) as c:
        rig = c.post("/api/rigs", json={"name": "Persist me", "from_demo": True}).json()
        rig_id = rig["id"]
        assert len(rig["instances"]) >= 5
        rig["instances"][0]["x_mm"] = 123.5
        rig["instances"][0]["rotation"] = 90
        saved = c.put(f"/api/rigs/{rig_id}", json=rig).json()
    # "Restart": brand new app on the same database file.
    with TestClient(create_app(db_path)) as c2:
        again = c2.get(f"/api/rigs/{rig_id}").json()
    assert [i["id"] for i in again["instances"]] == [i["id"] for i in saved["instances"]]
    assert again["instances"][0]["x_mm"] == 123.5 and again["instances"][0]["rotation"] == 90
    assert normalize_rig(Rig.model_validate(again)) == normalize_rig(Rig.model_validate(saved))


def test_export_import_round_trip_preserves_content(client):
    rig_id = client.get("/api/rigs").json()[0]["id"]
    exported = client.get(f"/api/rigs/{rig_id}/export").json()
    assert exported["format"] == "signal-loom-project" and exported["format_version"] == 1
    assert len(exported["profiles"]) == 8
    res = client.post("/api/rigs/import", content=json.dumps(exported)).json()
    assert res["warnings"] == []
    imported = client.get(f"/api/rigs/{res['rig']['id']}").json()
    a = normalize_rig(Rig.model_validate(exported["rig"]))
    b = normalize_rig(Rig.model_validate(imported))
    a.pop("id"), b.pop("id")
    assert a == b
    assert len(client.get("/api/rigs").json()) == 2


def test_import_rejects_untrusted_input(client):
    assert client.post("/api/rigs/import", content=b"{").status_code == 422
    assert client.post("/api/rigs/import", content=json.dumps({"format": "other"})).status_code == 422
    assert (
        client.post(
            "/api/rigs/import", content=json.dumps({"format": "signal-loom-project", "format_version": 99, "rig": {}})
        ).status_code
        == 422
    )
    bad = {
        "format": "signal-loom-project",
        "format_version": 1,
        "rig": {"name": "x", "instances": [{"profile_id": "p", "label": "l", "rotation": 45}]},
    }
    r = client.post("/api/rigs/import", content=json.dumps(bad))
    assert r.status_code == 422 and "rotation" in r.json()["detail"]
    try:
        parse_project("[]")
    except ProjectImportError as e:
        assert "object" in str(e)


def test_rig_lifecycle_rename_duplicate_delete(client):
    rig = client.post("/api/rigs", json={"name": "New rig"}).json()
    assert rig["instances"] == [] and rig["board"]["width_mm"] == 600
    assert client.patch(f"/api/rigs/{rig['id']}", json={"name": "Renamed"}).json()["name"] == "Renamed"
    dup = client.post(f"/api/rigs/{rig['id']}/duplicate").json()
    assert dup["id"] != rig["id"] and dup["name"] == "Renamed (copy)"
    assert client.delete(f"/api/rigs/{rig['id']}").status_code == 204
    assert client.get(f"/api/rigs/{rig['id']}").status_code == 404
    assert client.delete(f"/api/rigs/{rig['id']}").status_code == 404


def test_put_validates_references(client):
    rig_id = client.get("/api/rigs").json()[0]["id"]
    rig = client.get(f"/api/rigs/{rig_id}").json()
    rig["connections"][0]["source"]["instance_id"] = "ghost"
    assert client.put(f"/api/rigs/{rig_id}", json=rig).status_code == 422
    rig = client.get(f"/api/rigs/{rig_id}").json()
    rig["instances"][0]["rotation"] = 45
    assert client.put(f"/api/rigs/{rig_id}", json=rig).status_code == 422


def test_custom_port_persists_and_is_same_instance_everywhere(client):
    rig_id = client.get("/api/rigs").json()[0]["id"]
    rig = client.get(f"/api/rigs/{rig_id}").json()
    plumes = next(i for i in rig["instances"] if i["label"] == "Plumes")
    plumes["port_overrides"] = [
        {
            "id": "exp",
            "label": "Custom EXP",
            "kind": "expression",
            "direction": "in",
            "connector": "trs_1_4",
            "edge": "right",
            "position": 0.8,
            "position_evidence": "user",
        }
    ]
    rig["connections"].append(
        {
            "kind": "expression",
            "source": {"instance_id": "inst_mc8", "port_id": "omni3"},
            "target": {"instance_id": plumes["id"], "port_id": "exp"},
        }
    )
    client.put(f"/api/rigs/{rig_id}", json=rig)
    a = client.get(f"/api/rigs/{rig_id}/analysis").json()
    # The jack shows up on the board geometry of the same instance id and the cable validates.
    assert any(p["port_id"] == "exp" for p in a["instances"][plumes["id"]]["ports"])
    assert not any(d["code"] == "connection.port_missing" for d in a["diagnostics"])
    # The MC8 omniport 3 is an expression INPUT: wrong direction -> flagged, not silently accepted.
    assert any(d["code"] == "connection.direction" for d in a["diagnostics"])


def test_exports_endpoints(client):
    rig_id = client.get("/api/rigs").json()[0]["id"]
    assert "# Wiring manifest" in client.get(f"/api/rigs/{rig_id}/exports/wiring.md").text
    assert client.get(f"/api/rigs/{rig_id}/exports/wiring.csv").text.startswith("n,kind,from_device")
    assert "Compiled MIDI" in client.get(f"/api/rigs/{rig_id}/exports/scenes.md").text
    csv = client.get(f"/api/rigs/{rig_id}/exports/mc8-switch-map.csv").text
    assert "Clean" in csv and "PC" in csv
    status = client.get(f"/api/rigs/{rig_id}/exports/status").json()
    assert status["ml10x_native"]["available"] is False and status["mc8_bank_backup"]["level"] == "fixture_validated"
    bank = client.get(f"/api/rigs/{rig_id}/exports/mc8-bank/1").json()
    assert bank["self_check"]["ok"] and bank["dump"]["dumpType"] == "singleBank"
    dl = client.get(f"/api/rigs/{rig_id}/exports/mc8-bank/1?download=1")
    assert dl.headers["content-disposition"].startswith("attachment") and "\n" not in dl.text
    assert client.get(f"/api/rigs/{rig_id}/exports/mc8-bank/7").status_code == 404


def test_mc8_bank_export_refused_on_errors(client):
    rig_id = client.get("/api/rigs").json()[0]["id"]
    rig = client.get(f"/api/rigs/{rig_id}").json()
    next(i for i in rig["instances"] if i["label"] == "ML10X")["midi_channel"] = None
    client.put(f"/api/rigs/{rig_id}", json=rig)
    r = client.get(f"/api/rigs/{rig_id}/exports/mc8-bank/1")
    assert r.status_code == 409 and r.json()["detail"]["diagnostics"][0]["code"] == "midi.channel_unknown"


def test_catalog_custom_device_crud_and_pedalplayground_import(client):
    body = {
        "id": "my-fuzz",
        "manufacturer": "Me",
        "model": "Fuzz",
        "footprint": {"width": {"value_mm": 60, "evidence": "user"}, "depth": {"value_mm": 110, "evidence": "user"}},
        "ports": [
            {
                "id": "in",
                "label": "In",
                "kind": "audio",
                "direction": "in",
                "edge": "right",
                "position": 0.3,
                "position_evidence": "user",
            },
            {"id": "dc", "label": "DC", "kind": "power", "direction": "in", "edge": "top"},
        ],
    }
    assert client.post("/api/catalog/devices", json=body).status_code == 201
    assert client.post("/api/catalog/devices", json=body).status_code == 409
    got = client.get("/api/catalog/devices/my-fuzz").json()
    assert got["source"] == "custom" and {"power.voltage", "port.dc.position"} <= set(got["unknown_attributes"])
    assert client.get("/api/catalog/devices?q=fuzz").json()[0]["id"] == "my-fuzz"
    pp = [
        {"Brand": "Acme", "Name": "Boost", "Width": 2.6, "Height": 4.9, "Image": "x.png"},
        {"Brand": "", "Name": "bad"},
        5,
    ]
    rep = client.post("/api/catalog/import/pedalplayground", content=json.dumps(pp)).json()
    assert rep["imported"] == 1 and len(rep["problems"]) == 2
    acme = client.get("/api/catalog/devices/pp-acme-boost").json()
    assert acme["footprint"]["width"]["value_mm"] == 66.0 and acme["footprint"]["width"]["evidence"] == "third_party"
    assert acme["provenance"]["source"] == "pedalplayground_import" and acme["image_ref"] is None
    assert client.delete("/api/catalog/devices/my-fuzz").status_code == 204
    assert client.delete("/api/catalog/devices/morningstar-mc8").status_code == 409  # in use by the demo rig


def test_migrations_are_idempotent(tmp_path):
    db = Database(tmp_path / "m.sqlite3")
    assert db.migrate() == ["0001_initial", "0002_rig_revision"]
    assert db.migrate() == []
    seed(db)
    seed(db)
    assert len(RigRepository(db).list()) == 1
    db.close()


def test_put_rejects_stale_revision_and_accepts_newer(client):
    rig_id = client.get("/api/rigs").json()[0]["id"]
    rig = client.get(f"/api/rigs/{rig_id}").json()
    assert rig["revision"] == 0
    newer = dict(rig, revision=2, name="rev 2")
    older = dict(rig, revision=1, name="rev 1 (late)")
    assert client.put(f"/api/rigs/{rig_id}", json=newer).status_code == 200
    r = client.put(f"/api/rigs/{rig_id}", json=older)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "stale_revision"
    assert client.get(f"/api/rigs/{rig_id}").json()["name"] == "rev 2"
    # Equal revision (same client retrying) and higher revisions are accepted.
    assert client.put(f"/api/rigs/{rig_id}", json=dict(newer, name="rev 2 again")).status_code == 200
    assert client.put(f"/api/rigs/{rig_id}", json=dict(newer, revision=3, name="rev 3")).status_code == 200
    assert client.get(f"/api/rigs/{rig_id}").json()["revision"] == 3
    # Duplicates and imports start a fresh revision line.
    assert client.post(f"/api/rigs/{rig_id}/duplicate").json()["revision"] == 0


def test_revision_survives_restart(db_path):
    with TestClient(create_app(db_path)) as c:
        rig_id = c.get("/api/rigs").json()[0]["id"]
        rig = c.get(f"/api/rigs/{rig_id}").json()
        c.put(f"/api/rigs/{rig_id}", json=dict(rig, revision=7))
    with TestClient(create_app(db_path)) as c2:
        assert c2.get(f"/api/rigs/{rig_id}").json()["revision"] == 7
        assert c2.get("/api/rigs").json()[0]["revision"] == 7


def test_mc8_bank_export_refused_on_wiring_errors_even_when_bank_compiles(client):
    rig_id = client.get("/api/rigs").json()[0]["id"]
    rig = client.get(f"/api/rigs/{rig_id}").json()
    rig["connections"] = [c for c in rig["connections"] if c.get("label") != "Plumes -> Return A"]
    assert client.put(f"/api/rigs/{rig_id}", json=rig).status_code == 200
    compiled = client.get(f"/api/rigs/{rig_id}/exports/compiled.json").json()
    bank = compiled["mc8"]["banks"][0]
    # The switch plan itself still compiles without errors...
    assert not any(d["severity"] == "error" for s in bank["switches"] for d in s["diagnostics"])
    # ...but the physical rig is broken, so the native export is refused and says why.
    r = client.get(f"/api/rigs/{rig_id}/exports/mc8-bank/1")
    assert r.status_code == 409
    codes = {d["code"] for d in r.json()["detail"]["diagnostics"]}
    assert "switcher.loop_open" in codes
    # Human-readable reports stay available so the user can see what to fix.
    assert client.get(f"/api/rigs/{rig_id}/exports/scenes.md").status_code == 200
