"""An imported rig must use its own profile definitions without overwriting local devices."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app

from .support.pdf import make_pdf

PHOTO = (Path(__file__).parent / "fixtures" / "pedal-photo.jpg").read_bytes()
MANUAL = make_pdf(["Owner-authored MIDI guide", "CC 42 continuous."])


def _clean_profile(client: TestClient, profile_id: str) -> dict:
    profile = client.get(f"/api/catalog/devices/{profile_id}").json()
    for key in ("unknown_attributes", "source", "document_files"):
        profile.pop(key, None)
    return profile


def test_owner_customizations_survive_seeded_builtin_collisions(tmp_path):
    original_images = {}
    with TestClient(create_app(tmp_path / "source.sqlite3")) as source:
        for profile_id in ("morningstar-mc8", "strymon-sunset"):
            photo = source.post("/api/assets/images", files={"file": (f"{profile_id}.jpg", PHOTO, "image/jpeg")})
            assert photo.status_code == 201, photo.text
            image_id = photo.json()["id"]
            original_images[profile_id] = image_id
            profile = _clean_profile(source, profile_id)
            profile["image"] = {"asset_id": image_id, "calibrated": True}
            profile["notes"] = "Owner-customized profile"
            profile["ports"][0]["position"] = 0.33
            if profile_id == "strymon-sunset":
                profile["midi"]["cc_map"].append(
                    {
                        "cc": 42,
                        "name": "Owner sweep",
                        "value_semantics": "0-127",
                        "continuous": True,
                        "evidence": "documented",
                    }
                )
            changed = source.put(f"/api/catalog/devices/{profile_id}", json=profile)
            assert changed.status_code == 200, changed.text

        doc = source.post(
            "/api/catalog/devices/strymon-sunset/documents",
            data={"title": "Owner MIDI manual", "kind": "midi_chart"},
            files={"file": ("midi-chart.pdf", MANUAL, "application/pdf")},
        )
        assert doc.status_code == 201, doc.text
        document_id = doc.json()["documents"][0]["document_id"]

        rig = source.post("/api/rigs", json={"name": "Collision recovery"}).json()
        rig["instances"] = [
            {
                "id": "inst_restore_mc8",
                "label": "MC8",
                "profile_id": "morningstar-mc8",
                "midi_channel": 2,
            },
            {
                "id": "inst_restore_sunset",
                "label": "Sunset",
                "profile_id": "strymon-sunset",
                "midi_channel": 12,
            },
        ]
        rig["connections"] = [
            {
                "id": "conn_restore_midi",
                "kind": "midi",
                "source": {"instance_id": "inst_restore_mc8", "port_id": "omni1"},
                "target": {"instance_id": "inst_restore_sunset", "port_id": "exp_midi"},
            }
        ]
        rig["scenes"] = [
            {
                "id": "scene_restore",
                "name": "Keep references",
                "device_states": [{"instance_id": "inst_restore_sunset", "program": {"pc": 0}}],
            }
        ]
        rig["textures"] = [
            {
                "id": "tex_restore",
                "name": "Test texture",
                "tempo_bpm": 72,
                "macros": [
                    {
                        "name": "Bloom",
                        "base": 0.5,
                        "mappings": [
                            {
                                "instance_id": "inst_restore_sunset",
                                "cc": 42,
                                "output_min": 40,
                                "output_max": 70,
                            }
                        ],
                    }
                ],
            }
        ]
        rig["revision"] += 1
        saved = source.put(f"/api/rigs/{rig['id']}", json=rig)
        assert saved.status_code == 200, saved.text
        exported = source.get(f"/api/rigs/{rig['id']}/export?include_images=1&include_documents=1&require_complete=1")
        assert exported.status_code == 200, exported.text
        backup = exported.json()
        assert len(backup["assets"]) == 2
        assert len(backup["documents"]) == 1

    with TestClient(create_app(tmp_path / "restored.sqlite3")) as restored:
        for profile_id in original_images:
            original = restored.get(f"/api/catalog/devices/{profile_id}").json()
            assert original["source"] == "builtin"
            assert original["image"] is None
        imported = restored.post("/api/rigs/import", content=json.dumps(backup))
        assert imported.status_code == 201, imported.text
        result = imported.json()
        new_rig = result["rig"]
        assert len(result["imported_profiles"]) == 2
        assert len([w for w in result["warnings"] if "restored as" in w]) == 2
        assert not any("not on this computer" in w for w in result["warnings"])

        replacements = {i["label"]: i["profile_id"] for i in new_rig["instances"]}
        for name, old_id in (("MC8", "morningstar-mc8"), ("Sunset", "strymon-sunset")):
            new_id = replacements[name]
            assert new_id != old_id
            assert new_id in result["imported_profiles"]
            p = restored.get(f"/api/catalog/devices/{new_id}").json()
            assert p["source"] == "imported"
            assert p["image"]["asset_id"] == original_images[old_id]
            assert p["notes"] == "Owner-customized profile"
            assert p["ports"][0]["position"] == 0.33
            assert restored.get(f"/api/assets/images/{original_images[old_id]}").status_code == 200
            old = restored.get(f"/api/catalog/devices/{old_id}").json()
            assert old["source"] == "builtin"
            assert old["image"] is None
            assert old["notes"] != "Owner-customized profile"

        sunset = restored.get(f"/api/catalog/devices/{replacements['Sunset']}").json()
        assert any(c["cc"] == 42 and c["continuous"] is True for c in sunset["midi"]["cc_map"])
        assert sunset["documents"][0]["document_id"] == document_id
        assert restored.get(f"/api/documents/{document_id}/file").content == MANUAL

        assert new_rig["connections"][0]["source"]["instance_id"] == "inst_restore_mc8"
        assert new_rig["connections"][0]["target"]["instance_id"] == "inst_restore_sunset"
        assert new_rig["scenes"][0]["device_states"][0]["instance_id"] == "inst_restore_sunset"
        assert new_rig["textures"][0]["macros"][0]["mappings"][0]["instance_id"] == "inst_restore_sunset"
        analysis = restored.get(f"/api/rigs/{new_rig['id']}/analysis")
        assert analysis.status_code == 200, analysis.text
        assert (
            analysis.json()["instances"]["inst_restore_mc8"]["image"]["asset_id"] == original_images["morningstar-mc8"]
        )
        assert (
            analysis.json()["instances"]["inst_restore_sunset"]["image"]["asset_id"]
            == original_images["strymon-sunset"]
        )
        repeat_export = restored.get(
            f"/api/rigs/{new_rig['id']}/export?include_images=1&include_documents=1&require_complete=1"
        )
        assert repeat_export.status_code == 200, repeat_export.text
        assert len(repeat_export.json()["profiles"]) == 2
        assert len(repeat_export.json()["assets"]) == 2
        assert len(repeat_export.json()["documents"]) == 1


def test_custom_profile_collision_preserves_destination_and_remaps_only_imported_rig(tmp_path):
    profile_id = "owner-shared-id"
    with TestClient(create_app(tmp_path / "source-custom.sqlite3")) as source:
        created = source.post(
            "/api/catalog/devices",
            json={"id": profile_id, "manufacturer": "Owner", "model": "Pedal", "notes": "source version"},
        )
        assert created.status_code == 201, created.text
        rig = source.post("/api/rigs", json={"name": "Imported copy"}).json()
        rig["instances"] = [{"id": "inst_imported_device", "label": "Owner pedal", "profile_id": profile_id}]
        rig["revision"] += 1
        assert source.put(f"/api/rigs/{rig['id']}", json=rig).status_code == 200
        exported = source.get(f"/api/rigs/{rig['id']}/export").json()

    with TestClient(create_app(tmp_path / "existing-custom.sqlite3")) as destination:
        original = destination.post(
            "/api/catalog/devices",
            json={"id": profile_id, "manufacturer": "Owner", "model": "Pedal", "notes": "destination version"},
        )
        assert original.status_code == 201, original.text
        existing_rig = destination.post("/api/rigs", json={"name": "Already here"}).json()
        existing_rig["instances"] = [{"id": "inst_existing_device", "label": "Owner pedal", "profile_id": profile_id}]
        existing_rig["revision"] += 1
        assert destination.put(f"/api/rigs/{existing_rig['id']}", json=existing_rig).status_code == 200

        imported = destination.post("/api/rigs/import", content=json.dumps(exported))
        assert imported.status_code == 201, imported.text
        result = imported.json()
        new_id = result["rig"]["instances"][0]["profile_id"]
        assert new_id != profile_id
        assert result["imported_profiles"] == [new_id]
        assert any(profile_id in w and new_id in w for w in result["warnings"])
        assert destination.get(f"/api/catalog/devices/{new_id}").json()["notes"] == "source version"
        assert destination.get(f"/api/catalog/devices/{profile_id}").json()["notes"] == "destination version"
        retained = destination.get(f"/api/rigs/{existing_rig['id']}").json()
        assert retained["instances"][0]["profile_id"] == profile_id

        # Re-importing the restored project's own export finds an equivalent profile
        # and must not create a second alias just because its source field is "imported".
        exported_again = destination.get(f"/api/rigs/{result['rig']['id']}/export").json()
        another = destination.post("/api/rigs/import", content=json.dumps(exported_again))
        assert another.status_code == 201, another.text
        assert another.json()["imported_profiles"] == []
        assert another.json()["rig"]["instances"][0]["profile_id"] == new_id


def test_equal_seed_profile_is_reused_without_duplicate(tmp_path):
    with TestClient(create_app(tmp_path / "seed-source.sqlite3")) as source:
        rig = source.post("/api/rigs", json={"name": "Unmodified builtin"}).json()
        rig["instances"].append({"id": "inst_unmodified", "label": "MC8", "profile_id": "morningstar-mc8"})
        rig["revision"] += 1
        assert source.put(f"/api/rigs/{rig['id']}", json=rig).status_code == 200
        backup = source.get(f"/api/rigs/{rig['id']}/export").json()

    with TestClient(create_app(tmp_path / "seed-destination.sqlite3")) as destination:
        imported = destination.post("/api/rigs/import", content=json.dumps(backup))
        assert imported.status_code == 201, imported.text
        result = imported.json()
        assert result["imported_profiles"] == []
        assert result["rig"]["instances"][0]["profile_id"] == "morningstar-mc8"
        assert not any("restored as" in warning for warning in result["warnings"])
