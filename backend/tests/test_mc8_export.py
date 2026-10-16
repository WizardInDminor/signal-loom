import json

import pytest

from app.analysis import analyze
from app.morningstar import specs
from app.morningstar.mc8_export import build_single_bank_dump, check_dump, compact_json, java_string_hash, serialize
from app.morningstar.ml10x_backup import read_backup
from tests.conftest import external_fixture


def test_java_hash_matches_known_values():
    assert java_string_hash("") == 0
    assert java_string_hash("a") == 97
    assert java_string_hash("hello") == 99162322
    assert java_string_hash("polygenelubricants") == -2147483648  # classic Integer.MIN_VALUE case


def test_generated_bank_dump_has_editor_shape(demo, profiles):
    a = analyze(demo, profiles)
    dump, diags = build_single_bank_dump(a["compiled"]["mc8"]["banks"][0])
    assert not diags
    assert list(dump.keys()) == [
        "schemaVersion",
        "dumpType",
        "deviceModel",
        "downloadDate",
        "hash",
        "data",
        "description",
    ]
    bank = dump["data"]["bank"]
    assert list(bank.keys()) == [
        "bankNumber",
        "bankName",
        "bankClearToggle",
        "bankMsgArray",
        "presetArray",
        "expPresetArray",
    ]
    assert bank["bankNumber"] == 0 and bank["bankName"] == "Demo song"
    assert len(bank["presetArray"]) == specs.MC8_SWITCH_PRESETS_PER_BANK
    assert len(bank["expPresetArray"]) == specs.MC8_EXP_PRESETS_PER_BANK
    assert len(bank["bankMsgArray"]) == specs.MC8_BANK_MESSAGES
    for i, p in enumerate(bank["presetArray"]):
        assert p["presetNum"] == i and len(p["msgArray"]) == specs.MC8_MESSAGES_PER_PRESET
        assert list(p["msgArray"][0].keys()) == ["d1", "d2", "d3", "d4", "m", "c", "t", "a", "tg", "mi"]
    a_preset = bank["presetArray"][0]
    assert a_preset["shortName"] == "Clean"
    active = [m for m in a_preset["msgArray"] if m["t"]]
    assert [m["t"] for m in active][:2] == [specs.MC8_MSG_TYPE_CC, specs.MC8_MSG_TYPE_PC]
    assert active[0] == {"d1": 0, "d2": 0, "d3": 0, "d4": 0, "m": 0, "c": 10, "t": 2, "a": 1, "tg": 2, "mi": ""}
    assert dump["hash"] == java_string_hash(compact_json(dump["data"]))
    report = check_dump(serialize(dump))
    assert report["ok"] and report["hash_matches"] and report["banks"][0]["used_presets"][0]["position"] == "A"


def test_dump_refuses_over_limit_and_unknown_types(demo, profiles):
    a = analyze(demo, profiles)
    bank = json.loads(json.dumps(a["compiled"]["mc8"]["banks"][0]))
    bank["switches"][0]["messages"] = bank["switches"][0]["messages"] * 3  # 21 messages
    bank["switches"][1]["extra_messages"] = [
        {"type": "sysex", "channel": 1, "number": 0, "value": 0, "action": "press", "toggle_position": "both"}
    ]
    dump, diags = build_single_bank_dump(bank)
    codes = {d.code for d in diags}
    assert {"mc8.message_limit", "mc8.message_type_unsupported"} <= codes
    # The over-limit preset is left empty rather than truncated.
    assert all(m["t"] == 0 for m in dump["data"]["bank"]["presetArray"][0]["msgArray"])


def test_check_dump_rejects_garbage():
    assert not check_dump("not json")["ok"]
    assert (
        "deviceModel"
        in check_dump(json.dumps({"schemaVersion": 1, "dumpType": "singleBank", "deviceModel": 8, "data": {}}))[
            "problems"
        ][0]
    )


@pytest.mark.parametrize(
    "name",
    [
        "Morningstar_MC8_Bank_Backup_Mainstage_FX_20250202_112517.json",
        "Morningstar_MC8_All_Banks_Backup_20250202_112454.json",
    ],
)
def test_real_editor_exports_round_trip(name):
    """Fixture validation against real MC8 editor files (not vendored; see scripts/fetch-fixtures.sh)."""
    path = external_fixture(name)
    if path is None:
        pytest.skip("external MC8 fixture not downloaded (run scripts/fetch-fixtures.sh)")
    raw = path.read_text(encoding="utf-8")
    report = check_dump(raw)
    assert report["ok"], report["problems"]
    assert report["hash_matches"] is True
    assert report["device_model"] == specs.MC8_EXPORT_DEVICE_MODEL
    # Our serializer reproduces the editor's bytes exactly.
    assert compact_json(json.loads(raw)) == raw
    if report["dump_type"] == "allBanks":
        assert len(report["banks"]) == specs.MC8_BANKS


def test_real_ml10x_backup_reads_defensively():
    path = external_fixture("ml10x-editor-device-backup.json")
    if path is None:
        pytest.skip("external ML10X fixture not available (GPL-licensed third-party file; copy manually)")
    r = read_backup(path.read_text(encoding="utf-8"))
    assert r["ok"] and len(r["connectors"]) == 14 and len(r["presets"]) >= 1


def test_ml10x_reader_rejects_other_models():
    r = read_backup(json.dumps({"deviceModel": 4, "data": {}}))
    assert not r["ok"]
