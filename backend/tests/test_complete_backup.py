"""Complete portable backups must preserve images, manuals, and profiles together.

All fixture media is synthetic. No real hardware, vendor manual, or user's rig is involved.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app

from .support.pdf import make_pdf

PHOTO = Path(__file__).parent / "fixtures" / "pedal-photo.jpg"
PDF = make_pdf(["Synthetic device documentation", "CC 12 continuous."])


def test_complete_backup_includes_and_restores_both_media(tmp_path):
    with TestClient(create_app(tmp_path / "source.sqlite3")) as client:
        pid = "complete-test-pedal"
        created = client.post(
            "/api/catalog/devices",
            json={
                "id": pid,
                "manufacturer": "Test",
                "model": "Backup pedal",
                "provenance": {"source": "user", "evidence": "user"},
                "midi": {
                    "interfaces": ["din_in"],
                    "default_channel": 1,
                    "evidence": "user",
                    "cc_map": [
                        {
                            "cc": 12,
                            "name": "Sweep",
                            "value_semantics": "0-127",
                            "continuous": True,
                            "evidence": "documented",
                        }
                    ],
                },
            },
        )
        assert created.status_code == 201, created.text
        image = client.post("/api/assets/images", files={"file": ("pedal.jpg", PHOTO.read_bytes(), "image/jpeg")})
        assert image.status_code == 201, image.text
        iid = image.json()["id"]
        profile = client.get(f"/api/catalog/devices/{pid}").json()
        for key in ("unknown_attributes", "source", "document_files"):
            profile.pop(key, None)
        profile["image"] = {"asset_id": iid, "crop": {"x": 0, "y": 0, "w": 1, "h": 1}}
        updated = client.put(f"/api/catalog/devices/{pid}", json=profile)
        assert updated.status_code == 200, updated.text
        doc = client.post(
            f"/api/catalog/devices/{pid}/documents",
            data={"title": "Synthetic manual", "kind": "midi_chart"},
            files={"file": ("manual.pdf", PDF, "application/pdf")},
        )
        assert doc.status_code == 201, doc.text
        did = doc.json()["documents"][0]["document_id"]
        rig = client.post("/api/rigs", json={"name": "Backup test"}).json()
        rig["instances"].append({"id": "inst_backup_test", "profile_id": pid, "label": "Pedal"})
        rig["revision"] += 1
        saved = client.put(f"/api/rigs/{rig['id']}", json=rig)
        assert saved.status_code == 200, saved.text

        route = f"/api/rigs/{rig['id']}/export"
        assert client.get(route + "?require_complete=1").status_code == 422
        plain = client.get(route).json()
        assert plain["format_version"] == 1 and plain["assets"] == [] and "documents" not in plain
        bundled = client.get(route + "?include_images=1&include_documents=1&require_complete=1")
        assert bundled.status_code == 200, bundled.text
        backup = bundled.json()
        assert backup["format_version"] == 3
        assert {a["id"] for a in backup["assets"]} == {iid}
        assert {d["id"] for d in backup["documents"]} == {did}
        assert base64.b64decode(backup["documents"][0]["data_base64"]) == PDF
        assert backup["profiles"][0]["midi"]["cc_map"][0]["cc"] == 12

        with TestClient(create_app(tmp_path / "restore.sqlite3")) as other:
            res = other.post("/api/rigs/import", content=json.dumps(backup))
            assert res.status_code == 201, res.text
            assert not any("not on this computer" in w for w in res.json()["warnings"])
            restored = res.json()["rig"]
            assert other.get(f"/api/assets/images/{iid}").status_code == 200
            assert other.get(f"/api/documents/{did}/file").content == PDF
            p = other.get(f"/api/catalog/devices/{pid}").json()
            assert p["midi"]["cc_map"][0]["continuous"] is True
            assert p["image"]["asset_id"] == iid
            assert restored["instances"][0]["profile_id"] == pid


def test_complete_backup_refuses_missing_photo_and_legacy_export_remains_available(tmp_path):
    with TestClient(create_app(tmp_path / "missing.sqlite3")) as client:
        rig = client.post("/api/rigs", json={"name": "Missing image"}).json()
        # Missing per-instance media must block a complete backup, while legacy
        # reference-only exports retain their tolerant behavior.
        rig["instances"].append(
            {
                "id": "inst_missing_test",
                "profile_id": "strymon-sunset",
                "label": "Sunset",
                "image": {"asset_id": "img_aaaaaaaaaaaa"},
            }
        )
        rig["revision"] += 1
        saved = client.put(f"/api/rigs/{rig['id']}", json=rig)
        assert saved.status_code == 200, saved.text
        route = f"/api/rigs/{rig['id']}/export"
        full = client.get(route + "?include_images=1&include_documents=1&require_complete=1")
        assert full.status_code == 409, full.text
        assert "img_aaaaaaaaaaaa" in full.json()["detail"]["missing_images"]
        assert client.get(route).status_code == 200
        tolerant = client.get(route + "?include_images=1&include_documents=1")
        assert tolerant.status_code == 200
