import json

import pytest

from app.morningstar.backup_diff import diff_backups
from app.morningstar.mc8_export import (
    bank_dump_to_plan,
    build_single_bank_dump,
    check_dump,
    compact_json,
    java_string_hash,
    serialize,
)
from tests.conftest import external_fixture


def _bank_dump_with(messages, number=3):
    plan = {
        "number": number,
        "name": "Round",
        "diagnostics": [],
        "switches": [
            {
                "position": "A",
                "short_name": "One",
                "scene_name": "One",
                "action": "press",
                "messages": messages,
                "extra_messages": [],
                "manual_steps": [],
                "diagnostics": [],
            },
        ],
    }
    dump, diags = build_single_bank_dump(plan)
    assert not diags
    return dump


def test_bank_dump_to_plan_round_trips_pc_cc(client):
    msgs = [
        {"type": "cc", "channel": 10, "number": 0, "value": 0},
        {"type": "pc", "channel": 10, "number": 5, "value": None},
        {"type": "cc", "channel": 3, "number": 10, "value": 127},
    ]
    dump = _bank_dump_with(msgs)
    plan = bank_dump_to_plan(serialize(dump))
    assert plan["ok"] and plan["bank"]["number"] == 3 and plan["bank"]["name"] == "Round"
    preset = plan["bank"]["presets"][0]
    assert preset["position"] == "A" and preset["short_name"] == "One"
    assert [(m["type"], m["channel"], m["number"], m["value"]) for m in preset["extra_messages"]] == [
        ("cc", 10, 0, 0),
        ("pc", 10, 5, None),
        ("cc", 3, 10, 127),
    ]
    # Import into a rig, export again: identical message bytes.
    rig_id = client.get("/api/rigs").json()[0]["id"]
    res = client.post(f"/api/rigs/{rig_id}/import/mc8-bank", content=serialize(dump)).json()
    assert res["bank_number"] == 3 and res["imported_presets"] == 1 and res["skipped"] == []
    again = client.get(f"/api/rigs/{rig_id}/exports/mc8-bank/3").json()["dump"]
    assert again["data"]["bank"]["presetArray"][0]["msgArray"] == dump["data"]["bank"]["presetArray"][0]["msgArray"]
    assert again["data"]["bank"]["bankName"] == "Round"


def test_import_refuses_all_banks_and_garbage(client):
    rig_id = client.get("/api/rigs").json()[0]["id"]
    assert client.post(f"/api/rigs/{rig_id}/import/mc8-bank", content=b"nope").status_code == 422
    dump = _bank_dump_with([])
    dump["dumpType"] = "allBanks"
    r = client.post(f"/api/rigs/{rig_id}/import/mc8-bank", content=serialize(dump))
    assert r.status_code == 422 and "singleBank" in json.dumps(r.json())


def test_import_collides_on_bank_number_unless_replace(client):
    rig_id = client.get("/api/rigs").json()[0]["id"]
    dump = _bank_dump_with([{"type": "pc", "channel": 1, "number": 1, "value": None}], number=1)  # bank 1 exists
    first = client.post(f"/api/rigs/{rig_id}/import/mc8-bank", content=serialize(dump)).json()
    assert first["bank_number"] == 2
    second = client.post(f"/api/rigs/{rig_id}/import/mc8-bank?replace=1", content=serialize(dump)).json()
    assert second["bank_number"] == 1
    rig = client.get(f"/api/rigs/{rig_id}").json()
    assert sorted(b["number"] for b in rig["controllers"]["mc8"]["banks"]) == [1, 2]
    assert next(b for b in rig["controllers"]["mc8"]["banks"] if b["number"] == 1)["name"] == "Round"


def test_unsupported_message_types_are_skipped_not_guessed():
    dump = _bank_dump_with([{"type": "pc", "channel": 1, "number": 1, "value": None}])
    dump["data"]["bank"]["presetArray"][0]["msgArray"][1] = {
        "d1": 3,
        "d2": 0,
        "d3": 0,
        "d4": 0,
        "m": 1,
        "c": 1,
        "t": 13,
        "a": 1,
        "tg": 2,
        "mi": "",
    }
    dump["hash"] = java_string_hash(compact_json(dump["data"]))  # keep the file internally consistent
    plan = bank_dump_to_plan(serialize(dump))
    assert plan["ok"] and len(plan["bank"]["presets"][0]["extra_messages"]) == 1
    assert plan["skipped"] == [{"position": "A", "slot": 1, "type_code": 13, "type_name": "Bank Jump"}]


def test_real_mc8_bank_round_trip():
    path = external_fixture("Morningstar_MC8_Bank_Backup_Mainstage_FX_20250202_112517.json")
    if path is None:
        pytest.skip("external MC8 fixture not downloaded")
    raw = path.read_text(encoding="utf-8")
    original = json.loads(raw)
    plan = bank_dump_to_plan(raw)
    assert plan["ok"] and plan["bank"]["name"] == "Mainstage FX"
    # Re-export from the imported plan and compare every PC/CC message slot with the original.
    switches = [
        {
            "position": p["position"],
            "short_name": p["short_name"],
            "scene_name": p["long_name"] or p["short_name"],
            "action": "press",
            "messages": [],
            "extra_messages": p["extra_messages"],
            "manual_steps": [],
            "diagnostics": [],
        }
        for p in plan["bank"]["presets"]
    ]
    dump, diags = build_single_bank_dump(
        {"number": plan["bank"]["number"], "name": plan["bank"]["name"], "diagnostics": [], "switches": switches}
    )
    assert not diags
    for orig_p, new_p in zip(original["data"]["bank"]["presetArray"], dump["data"]["bank"]["presetArray"], strict=True):
        orig_msgs = [m for m in orig_p["msgArray"] if m["t"] in (1, 2)]
        new_msgs = [m for m in new_p["msgArray"] if m["t"] in (1, 2)]
        assert [(m["t"], m["c"], m["d1"], m["d2"], m["a"], m["tg"]) for m in orig_msgs] == [
            (m["t"], m["c"], m["d1"], m["d2"], m["a"], m["tg"]) for m in new_msgs
        ]
        assert orig_p["shortName"] == new_p["shortName"]
    assert check_dump(serialize(dump))["ok"]


def test_backup_diff_reports_changed_fields():
    a = {
        "schemaVersion": 1,
        "dumpType": "full",
        "deviceModel": 7,
        "hash": 1,
        "data": {
            "presetData": [
                {
                    "bank": 0,
                    "data": [
                        {
                            "presetNumber": 0,
                            "presetName": "Base",
                            "matrixArray": {"0": [4, 0, 0], "1": [0, 0, 0]},
                            "advancedMode": False,
                            "bypass": 0,
                        }
                    ],
                }
            ],
            "controllerData": {"midiChannel": 9, "connectors": [{"id": 0, "name": "Ego 76"}]},
        },
    }
    b = json.loads(json.dumps(a))
    b["hash"] = 2
    b["data"]["presetData"][0]["data"][0]["matrixArray"]["1"] = [2, 0, 0]
    b["data"]["presetData"][0]["data"][0]["advancedMode"] = True
    b["data"]["controllerData"]["connectors"][0]["name"] = "Ego 77"
    rep = diff_backups(json.dumps(a), json.dumps(b))
    assert rep["ok"] and rep["summary"]["total"] == 3
    labels = {c["label"]: (c["before"], c["after"]) for c in rep["changes"]}
    assert labels["data / presetData / bank 0 / data / preset 0 'Base' / matrixArray / 1"] == ([0, 0, 0], [2, 0, 0])
    assert labels["data / presetData / bank 0 / data / preset 0 'Base' / advancedMode"] == (False, True)
    assert labels["data / controllerData / connectors / connector 0 'Ego 76' / name"] == ("Ego 76", "Ego 77")
    assert rep["metadata_differences"]["hash"] == {"a": 1, "b": 2}
    assert not diff_backups("x", json.dumps(a))["ok"]


def test_backup_diff_endpoint(client):
    a = json.dumps({"deviceModel": 4, "data": {"bank": {"bankName": "x"}}})
    b = json.dumps({"deviceModel": 4, "data": {"bank": {"bankName": "y"}}})
    rep = client.post("/api/rigs/inspect/backup-diff", json={"a": a, "b": b}).json()
    assert rep["ok"] and rep["changes"][0]["label"] == "data / bank / bankName"
    assert client.post("/api/rigs/inspect/backup-diff", json={"a": a}).status_code == 422
