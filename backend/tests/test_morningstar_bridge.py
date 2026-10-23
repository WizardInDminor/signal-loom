"""Session 7 — Morningstar Bridge: native snapshot, interpretation, comparison, proposals, ML10X.

Synthetic fixtures are built with the validated writer and then deliberately damaged (unknown keys,
foreign message types, bad codes) so the tests prove preservation rather than pretty output. The real
editor files (not vendored) are used when present and skipped otherwise.
"""

from __future__ import annotations

import copy
import json

import pytest

from app.morningstar import mc8_native, ml10x_native, specs
from app.morningstar.mc8_export import build_single_bank_dump, compact_json, java_string_hash, serialize
from tests.conftest import external_fixture

# ----------------------------------------------------------------------------- helpers


def _plan(messages, number=3, name="Round", position="A", short="One"):
    return {
        "number": number,
        "name": name,
        "diagnostics": [],
        "switches": [
            {
                "position": position,
                "short_name": short,
                "scene_name": short,
                "action": "press",
                "messages": messages,
                "extra_messages": [],
                "manual_steps": [],
                "diagnostics": [],
            }
        ],
    }


def _single_bank(messages=None, **kw) -> dict:
    msgs = (
        messages
        if messages is not None
        else [
            {"type": "cc", "channel": 10, "number": 0, "value": 0},
            {"type": "pc", "channel": 10, "number": 5, "value": None},
        ]
    )
    dump, diags = build_single_bank_dump(_plan(msgs, **kw))
    assert not diags
    return dump


def _rehash(dump: dict) -> dict:
    dump["hash"] = java_string_hash(compact_json(dump["data"]))
    return dump


def _msg(**kw) -> dict:
    m = {"d1": 0, "d2": 0, "d3": 0, "d4": 0, "m": 0, "c": 1, "t": 0, "a": 0, "tg": 2, "mi": ""}
    m.update(kw)
    return m


def _damaged_single_bank() -> dict:
    """A plausible-looking file with everything Signal Loom must preserve but cannot interpret."""
    dump = _single_bank()
    bank = dump["data"]["bank"]
    bank["presetArray"][0]["msgArray"][2] = _msg(m=2, t=13, d1=3, c=1, a=1, tg=2)  # Bank Jump (third-party name)
    bank["presetArray"][0]["msgArray"][3] = _msg(m=3, t=99, d1=1, d2=2, d3=3, d4=4, c=1, a=1, tg=2)  # unknown code
    bank["presetArray"][1]["msgArray"][0] = _msg(m=0, t=2, d1=20, d2=127, d3=9, c=4, a=1, tg=0, mi="x")  # CC with d3/mi
    bank["presetArray"][1]["shortName"] = "Odd"
    bank["presetArray"][1]["futureFlag"] = True  # unknown preset key
    bank["presetArray"][0]["msgArray"][0]["extra"] = {"k": 1}  # unknown message key
    bank["bankMsgArray"][0] = _msg(m=0, t=1, d1=4, c=2, a=1, tg=0)  # a bank message (PC)
    bank["newBankSetting"] = 7  # unknown bank key
    dump["editorVersion"] = "9.9.9"  # unknown top-level key
    return _rehash(dump)


def _all_banks(n_banks: int = specs.MC8_BANKS) -> dict:
    banks = []
    for i in range(n_banks):
        d = _single_bank(number=i + 1, name=f"Bank {i + 1}" if i < 2 else "")
        banks.append(d["data"]["bank"])
    data = {
        "bankArray": banks,
        "controller_settings": {
            "type": "controller_settings_all",
            "data": {
                "controller_settings": {
                    "type": "general_configurations",
                    "data": {
                        "midiChannel": 15,
                        "crossMidiThru": True,
                        "midiThru": True,
                        "lcdAlign": True,
                        "brandNewKey": 1,
                    },
                },
                "midi_channels": {
                    "type": "midi_channels",
                    "data": [
                        {
                            "type": "midi_channel",
                            "data": {"name": "Strymon", "channel": 1, "sendToPort": 2047, "remap": 0},
                        }
                    ],
                },
                "bank_arrangement": {
                    "type": "bank_arrangement",
                    "isActive": False,
                    "numBanksActive": 0,
                    "data": [{"type": "bank_arrangement", "data": {"bankNum": 0, "bankName": "Bank 1"}}],
                },
                "omniports": {
                    "type": "omniport_all",
                    "data": [{"type": "omniport_input", "data": {"portNum": 0, "type": 4}}],
                },
                "mystery_section": {"type": "mystery", "data": [1, 2, 3]},
            },
        },
    }
    return {
        "schemaVersion": 1,
        "dumpType": "allBanks",
        "deviceModel": 4,
        "downloadDate": "2026-01-01T00:00:00.000Z",
        "hash": java_string_hash(compact_json(data)),
        "data": data,
        "description": "synthetic",
    }


def _ml10x_backup() -> dict:
    presets = []
    for bank in range(specs.ML10X_BANKS):
        items = []
        for n in range(specs.ML10X_PRESETS_PER_BANK):
            items.append(
                {
                    "presetNumber": n,
                    "presetName": "Empty",
                    "tipT": 127,
                    "ringT": 127,
                    "matrixArray": {str(k): [0, 0, 0] for k in range(16)},
                    "advancedMode": False,
                    "bypass": 0,
                }
            )
        presets.append({"bank": bank, "data": items})
    p = presets[0]["data"][1]
    p["presetName"] = "Lead"
    p["matrixArray"]["0"] = [0, 64, 0]
    p["matrixArray"]["2"] = [4, 0, 0]
    p["matrixArray"]["15"] = [1, 0, 0]
    p["futureField"] = "?"
    presets[1]["data"][5]["advancedMode"] = True
    presets[1]["data"][5]["presetName"] = "Split"
    connectors = [
        {
            "id": i,
            "pos": i,
            "name": f"Pedal {i}",
            "shortName": f"P{i}",
            "trails": i == 3,
            "inputName": "Input",
            "outputName": "Output",
        }
        for i in range(14)
    ]
    data = {
        "presetData": presets,
        "controllerData": {
            "midiChannel": 9,
            "connectors": connectors,
            "deviceId": 6,
            "inputRingSwapPin": 0,
            "inputSplit": True,
            "loopBypassPersistent": False,
            "firmwareHint": "1.2.0",
        },
    }
    return {
        "schemaVersion": 1,
        "dumpType": "full",
        "deviceModel": 7,
        "downloadDate": "2026-05-25T20:10:02.734Z",
        "hash": java_string_hash(compact_json(data)),
        "data": data,
    }


# ----------------------------------------------------------------------------- MC8 native + interpretation


def test_native_snapshot_lists_unknown_keys_and_keeps_data():
    dump = _damaged_single_bank()
    raw = compact_json(dump)
    native = mc8_native.load_native(raw)
    assert native["ok"] and native["hash_matches"] is True and native["byte_exact"] is True
    assert native["data"] is dump["data"] or native["data"] == dump["data"]
    report = mc8_native.inspect(raw)
    keys = {(u["path"], u["key"]) for u in report["native"]["unknown_keys"]}
    assert ("$", "editorVersion") in keys
    assert ("$.data.bank", "newBankSetting") in keys
    assert ("$.data.bank.presetArray[1]", "futureFlag") in keys
    assert ("$.data.bank.presetArray[0].msgArray[0]", "extra") in keys
    assert report["coverage"]["unknown_keys"] == 4


def test_interpretation_classifies_messages_without_inventing_meaning():
    report = mc8_native.inspect(compact_json(_damaged_single_bank()))
    bank = report["interpreted"]["banks"][0]
    a = bank["presets"][0]
    by_slot = {m["slot"]: m for m in a["messages"]}
    assert by_slot[0]["status"] == "known" and by_slot[0]["summary"] == "CC#0 = 0 on ch 10"
    assert by_slot[1]["status"] == "known" and by_slot[1]["summary"] == "PC 5 on ch 10"
    assert (
        by_slot[2]["status"] == "third_party"
        and by_slot[2]["type_name"] == "Bank Jump"
        and by_slot[2]["type_enum"] == "M_SET_BANK"
    )
    assert by_slot[2]["raw"] == {"d1": 3, "d2": 0, "d3": 0, "d4": 0, "m": 2, "c": 1, "t": 13, "a": 1, "tg": 2, "mi": ""}
    assert by_slot[3]["status"] == "unknown" and by_slot[3]["data"] == [1, 2, 3, 4]
    assert any("unknown" in x for x in by_slot[3]["anomalies"])
    b = bank["presets"][1]
    odd = b["messages"][0]
    assert odd["status"] == "known" and odd["toggle_position"] == "pos1" and odd["action"] == "press"
    assert any("d3/d4" in x for x in odd["anomalies"]) and any("mi is non-empty" in x for x in odd["anomalies"])
    assert bank["bank_messages"][0]["status"] == "known" and bank["bank_messages"][0]["summary"] == "PC 4 on ch 2"
    assert report["coverage"]["messages"] == {"empty": 16 * 26 + 16 - 6, "known": 4, "third_party": 1, "unknown": 1}
    assert bank["presets_used"] == 2 and bank["exp_used"] == 0 and report["coverage"]["banks_used"] == 1
    assert report["interpreted"]["controller_settings"] is None


def test_all_banks_interpretation_covers_controller_settings():
    raw = compact_json(_all_banks())
    report = mc8_native.inspect(raw)
    assert report["native"]["ok"] and report["native"]["dump_type"] == "allBanks" and report["coverage"]["banks"] == 30
    cs = report["interpreted"]["controller_settings"]
    general = {g["key"]: g for g in cs["general"]}
    assert general["midiChannel"]["evidence"] == "documented" and general["midiChannel"]["value"] == 15
    assert general["lcdAlign"]["evidence"] == "named"
    assert general["brandNewKey"]["evidence"] == "unknown"
    assert cs["midi_channels"][0]["name"] == "Strymon"
    assert cs["bank_arrangement"]["banks"][0]["name"] == "Bank 1"
    sections = {s["key"]: s for s in cs["sections"]}
    assert sections["mystery_section"]["interpreted"] is False and sections["mystery_section"]["raw"]["data"] == [
        1,
        2,
        3,
    ]
    assert any(u["key"] == "mystery_section" for u in report["native"]["unknown_keys"])


@pytest.mark.parametrize(
    "raw, needle",
    [
        ("nope", "not valid JSON"),
        ("[1,2]", "not an object"),
        (
            json.dumps({"schemaVersion": 1, "dumpType": "singleBank", "deviceModel": 8, "data": {"bank": {}}}),
            "deviceModel 8",
        ),
        (json.dumps({"schemaVersion": 1, "dumpType": "singleBank", "deviceModel": 4}), "missing data"),
        (json.dumps({"schemaVersion": 1, "dumpType": "weird", "deviceModel": 4, "data": {}}), "unknown dumpType"),
        (json.dumps({"schemaVersion": 1, "dumpType": "singleBank", "deviceModel": 4, "data": {}}), "without a bank"),
    ],
)
def test_parse_failures_are_reported_not_raised(raw, needle):
    native = mc8_native.load_native(raw)
    assert not native["ok"] and any(needle in p for p in native["problems"])
    report = mc8_native.inspect(raw)
    assert report["interpreted"] is None and report["coverage"] is None


def test_version_and_shape_discrepancies_warn_but_still_interpret():
    dump = _single_bank()
    dump["schemaVersion"] = 2
    dump["data"]["bank"]["presetArray"] = dump["data"]["bank"]["presetArray"][:5]  # truncated
    dump["data"]["bank"]["presetArray"][0]["msgArray"] = dump["data"]["bank"]["presetArray"][0]["msgArray"][:4]
    dump["hash"] = 12345  # stale
    raw = json.dumps(dump, indent=1)  # pretty-printed: not byte exact
    report = mc8_native.inspect(raw)
    n = report["native"]
    assert n["ok"] and n["hash_matches"] is False and n["byte_exact"] is False
    assert any("schemaVersion 2" in w for w in n["warnings"]) and any("hash does not match" in w for w in n["warnings"])
    bank = report["interpreted"]["banks"][0]
    assert any("5 switch presets" in a for a in bank["anomalies"])
    assert any("4 message slots" in a for a in bank["presets"][0]["anomalies"])
    assert bank["presets"][0]["short_name"] == "One" and report["coverage"]["lossless_reserialization"] is False


# ----------------------------------------------------------------------------- proposals


def test_propose_without_edits_is_byte_identical_and_preserves_everything():
    raw = compact_json(_damaged_single_bank())
    res = mc8_native.propose(raw)
    assert res["ok"] and res["text"] == raw and res["diff"]["total"] == 0
    assert res["preserved"] == {
        "third_party_messages": 1,
        "unknown_type_messages": 1,
        "unknown_keys": 3,
        "byte_identical_to_input": True,
    }
    assert res["self_check"]["hash_matches"] is True


def test_propose_applies_allowlisted_edits_with_exact_diff_and_fresh_hash():
    raw = compact_json(_damaged_single_bank())
    edits = [
        {"path": ["bankName"], "value": "Set 2"},
        {"path": ["presetArray", 0, "shortName"], "value": "Lead"},
        {"path": ["presetArray", 0, "toToggle"], "value": True},
        {"path": ["presetArray", 0, "msgArray", 1, "d1"], "value": 9},
        {"path": ["presetArray", 0, "msgArray", 5, "t"], "value": 2},
        {"path": ["presetArray", 0, "msgArray", 5, "d1"], "value": 80},
        {"path": ["presetArray", 0, "msgArray", 5, "c"], "value": 3},
        {"path": ["presetArray", 0, "msgArray", 5, "a"], "value": 1},
        {"path": ["expPresetArray", 0, "msgArray", 0, "t"], "value": 2},
        {"path": ["bankMsgArray", 0, "d1"], "value": 5},
    ]
    res = mc8_native.propose(raw, edits)
    assert res["ok"], res["problems"]
    assert res["edits_applied"] == 10 and res["diff"]["total"] == 10
    labels = {c["label"]: (c["before"], c["after"]) for c in res["diff"]["changes"]}
    assert labels["bank / bankName"] == ("Round", "Set 2")
    assert labels["bank / presetArray / preset 0 (A) 'One' / msgArray / message slot 1 / d1"] == (5, 9)
    out = json.loads(res["text"])
    assert out["dumpType"] == "singleBank" and out["hash"] == java_string_hash(compact_json(out["data"]))
    assert (
        out["editorVersion"] == "9.9.9" or "editorVersion" not in out
    )  # top-level unknown keys are not promised on an edited file
    bank = out["data"]["bank"]
    assert (
        bank["newBankSetting"] == 7 and bank["presetArray"][1]["futureFlag"] is True
    )  # bank/preset unknowns preserved
    assert (
        bank["presetArray"][0]["msgArray"][2]["t"] == 13 and bank["presetArray"][0]["msgArray"][3]["t"] == 99
    )  # foreign slots untouched
    assert bank["presetArray"][0]["msgArray"][0]["extra"] == {"k": 1}
    assert res["self_check"]["ok"] and res["self_check"]["hash_matches"] is True
    assert res["filename"].startswith("Morningstar_MC8_Bank_Backup_Set 2_")
    # Nothing silently truncated: a long name is a warning, not an edit of the user's value.
    res2 = mc8_native.propose(raw, [{"path": ["presetArray", 0, "shortName"], "value": "A much longer name"}])
    assert (
        res2["ok"] and json.loads(res2["text"])["data"]["bank"]["presetArray"][0]["shortName"] == "A much longer name"
    )
    assert any("longest seen" in w for w in res2["warnings"])


@pytest.mark.parametrize(
    "edit, needle",
    [
        ({"path": ["presetArray", 0, "msgArray", 0, "d3"], "value": 1}, "not editable"),
        ({"path": ["presetArray", 0, "msgArray", 0, "mi"], "value": "x"}, "not editable"),
        ({"path": ["newBankSetting"], "value": 8}, "not editable"),
        ({"path": ["presetArray", 0, "msgArray", 0, "t"], "value": 13}, "only PC (1), CC (2) or empty (0)"),
        ({"path": ["presetArray", 0, "msgArray", 2, "d1"], "value": 1}, "Bank Jump"),  # a third-party slot
        ({"path": ["presetArray", 0, "msgArray", 3, "d1"], "value": 1}, "unknown"),  # an unknown-type slot
        ({"path": ["presetArray", 0, "msgArray", 0, "c"], "value": 17}, "1-16"),
        ({"path": ["presetArray", 0, "msgArray", 0, "d1"], "value": 128}, "0-127"),
        ({"path": ["presetArray", 0, "msgArray", 0, "a"], "value": 11}, "not an MC8 action"),
        ({"path": ["presetArray", 0, "msgArray", 0, "tg"], "value": 3}, "toggle position"),
        ({"path": ["presetArray", 0, "shortName"], "value": "Ünïcode"}, "printable ASCII"),
        ({"path": ["presetArray", 0, "toToggle"], "value": 1}, "true/false"),
        ({"path": ["presetArray", 40, "shortName"], "value": "x"}, "no preset"),
        ({"nope": 1}, "must be"),
    ],
)
def test_propose_refuses_edits_it_cannot_justify(edit, needle):
    res = mc8_native.propose(compact_json(_damaged_single_bank()), [edit])
    assert not res["ok"] and res["dump"] is None
    assert any(needle in p for p in res["problems"]), res["problems"]


def test_propose_lifts_one_bank_of_an_all_banks_file_verbatim():
    all_banks = _all_banks()
    raw = compact_json(all_banks)
    assert not mc8_native.propose(raw)["ok"]  # bank_index required
    res = mc8_native.propose(raw, bank_index=1)
    assert res["ok"] and res["diff"]["total"] == 0 and res["preserved"]["byte_identical_to_input"] is False
    out = json.loads(res["text"])
    assert out["dumpType"] == "singleBank" and out["data"]["bank"] == all_banks["data"]["bankArray"][1]
    assert out["hash"] == java_string_hash(compact_json(out["data"])) and res["self_check"]["ok"]
    assert "bank 2 of an all-banks backup" in out["description"]


def test_propose_refuses_broken_files():
    assert not mc8_native.propose("nope")["ok"]
    bad = _single_bank()
    bad["deviceModel"] = 8
    assert any("deviceModel" in p for p in mc8_native.propose(compact_json(bad))["problems"])


# ----------------------------------------------------------------------------- compare


def test_compare_native_bank_against_modeled_plan():
    plan = _plan(
        [
            {"type": "cc", "channel": 10, "number": 0, "value": 0},
            {"type": "pc", "channel": 10, "number": 5, "value": None},
        ]
    )
    dump, _ = build_single_bank_dump(plan)
    same = mc8_native.compare_bank_to_plan(dump["data"]["bank"], plan)
    assert (
        same["ok"]
        and same["summary"]["identical"]
        and same["summary"]["same"] == 1
        and same["summary"]["both_empty"] == 21
    )
    native = copy.deepcopy(dump["data"]["bank"])
    native["presetArray"][0]["msgArray"][1]["d1"] = 6  # PC 6 instead of 5
    native["presetArray"][0]["msgArray"][2] = _msg(m=2, t=23, d1=10, c=1, a=1, tg=2)  # Delay: not modelled
    native["presetArray"][3]["shortName"] = "Ctrl"  # only on the controller
    native["bankMsgArray"][0] = _msg(m=0, t=2, d1=1, c=1, a=1, tg=0)
    rep = mc8_native.compare_bank_to_plan(native, plan)
    pos = {p["position"]: p for p in rep["positions"]}
    assert pos["A"]["status"] == "differs" and set(pos["A"]["differences"]) == {
        "messages",
        "unsupported_native_messages",
    }
    assert [m["supported"] for m in pos["A"]["native"]["messages"]] == [True, True, False]
    assert pos["D"]["status"] == "only_native" and pos["D"]["native"]["short_name"] == "Ctrl"
    assert rep["bank"]["native_bank_messages"] == 1 and not rep["summary"]["identical"]
    # Same messages in another order are reported as an order difference, not as different content.
    reordered = copy.deepcopy(dump["data"]["bank"])
    a, b = reordered["presetArray"][0]["msgArray"][0], reordered["presetArray"][0]["msgArray"][1]
    reordered["presetArray"][0]["msgArray"][0], reordered["presetArray"][0]["msgArray"][1] = b, a
    rep2 = mc8_native.compare_bank_to_plan(reordered, plan)
    assert rep2["positions"][0]["differences"] == ["messages_order"]


# ----------------------------------------------------------------------------- real fixtures (not vendored)


def test_real_mc8_files_are_lossless_and_fully_known():
    single = external_fixture("Morningstar_MC8_Bank_Backup_Mainstage_FX_20250202_112517.json")
    all_banks = external_fixture("Morningstar_MC8_All_Banks_Backup_20250202_112454.json")
    if single is None or all_banks is None:
        pytest.skip("external MC8 fixtures not downloaded (run scripts/fetch-fixtures.sh)")
    raw = single.read_text(encoding="utf-8")
    report = mc8_native.inspect(raw)
    cov = report["coverage"]
    assert cov["lossless_reserialization"] and cov["unknown_keys"] == 0 and cov["anomalies"] == 0
    assert cov["messages"]["third_party"] == 0 and cov["messages"]["unknown"] == 0 and cov["messages"]["known"] > 0
    assert mc8_native.propose(raw)["text"] == raw
    raw_all = all_banks.read_text(encoding="utf-8")
    rep_all = mc8_native.inspect(raw_all)
    assert (
        rep_all["coverage"]["banks"] == specs.MC8_BANKS
        and rep_all["coverage"]["unknown_keys"] == 0
        and rep_all["coverage"]["anomalies"] == 0
    )
    cs = rep_all["interpreted"]["controller_settings"]
    assert {s["key"] for s in cs["sections"]} == set(mc8_native.CONTROLLER_SECTIONS_KNOWN)
    lifted = mc8_native.propose(raw_all, bank_index=0)
    assert lifted["ok"] and lifted["self_check"]["ok"]
    assert lifted["dump"]["data"]["bank"] == json.loads(raw_all)["data"]["bankArray"][0]


def test_real_ml10x_backup_hash_and_shape():
    path = external_fixture("ml10x-editor-device-backup.json")
    if path is None:
        pytest.skip("external ML10X fixture not available (GPL-licensed third-party file; copy manually)")
    report = ml10x_native.inspect(path.read_text(encoding="utf-8"))
    assert report["device"] == "ml10x" and report["native"]["hash_matches"] is True  # the Session 7 finding
    assert report["coverage"]["presets_total"] == 512 and report["coverage"]["connectors"] == 14
    assert report["coverage"]["unknown_keys"] == 0 and report["coverage"]["anomalies"] == 0
    assert report["coverage"]["routing_decoded"] is False


# ----------------------------------------------------------------------------- ML10X synthetic


def test_ml10x_native_and_interpretation_keep_routing_opaque():
    doc = _ml10x_backup()
    raw = compact_json(doc)
    report = ml10x_native.inspect(raw)
    n = report["native"]
    assert report["device"] == "ml10x" and n["ok"] and n["hash_matches"] is True and n["byte_exact"] is True
    keys = {(u["path"], u["key"]) for u in n["unknown_keys"]}
    assert ("$.data.controllerData", "firmwareHint") in keys and ("$.data.presetData[0].data[1]", "futureField") in keys
    interp = report["interpreted"]
    fields = {f["key"]: f for f in interp["controller"]["fields"]}
    assert fields["midiChannel"]["value"] == 9 and fields["inputSplit"]["evidence"] == "documented"
    assert fields["inputRingSwapPin"]["evidence"] == "unknown"
    conns = interp["controller"]["connectors"]
    assert conns[0]["label"] == "A Tip" and conns[0]["loop"] == 1 and conns[3]["trails"] is True
    assert conns[10]["label"] == "Input Tip" and conns[13]["label"] == "Output Ring" and conns[10]["loop"] is None
    used = {(p["bank"], p["number"]): p for p in interp["presets"]}
    assert set(used) == {(0, 1), (1, 5)}
    lead = used[(0, 1)]
    assert lead["routing"]["status"].startswith("undecoded")
    assert lead["routing"]["matrix"]["0"] == [0, 64, 0]  # verbatim
    rows = {r["row"]: r for r in lead["routing"]["nonzero_rows"]}
    assert rows["0"]["hypothesis"] == "Input Tip" and rows["0"]["bits"] == ["byte1.bit6"]
    assert rows["2"]["hypothesis"] == "A Tip" and rows["15"]["hypothesis"] is None
    assert used[(1, 5)]["advanced_mode"] is True and used[(1, 5)]["routing"]["nonzero_rows"] == []
    assert report["coverage"] == {
        "presets_total": 512,
        "presets_used": 2,
        "presets_advanced": 1,
        "presets_with_matrix_data": 1,
        "connectors": 14,
        "unknown_keys": 2,
        "anomalies": 0,
        "routing_decoded": False,
        "native_export_available": False,
    }
    assert len(interp["preset_names"]) == 512


def test_ml10x_rejects_other_models_and_warns_on_shape():
    assert not ml10x_native.load_native(json.dumps({"deviceModel": 4, "data": {}}))["ok"]
    doc = _ml10x_backup()
    doc["data"]["controllerData"]["connectors"] = doc["data"]["controllerData"]["connectors"][:3]
    doc["data"]["presetData"] = doc["data"]["presetData"][:2]
    doc["data"]["presetData"][0]["data"][1]["matrixArray"]["0"] = "bad"
    doc["dumpType"] = "partial"
    report = ml10x_native.inspect(json.dumps(doc))  # stale hash + pretty => warnings, not problems
    assert report["native"]["ok"] and report["native"]["hash_matches"] is False
    assert any("dumpType 'partial'" in w for w in report["native"]["warnings"])
    anomalies = report["interpreted"]["anomalies"]
    assert any("3 connectors" in a for a in anomalies) and any("2 banks" in a for a in anomalies)
    assert any("matrixArray row '0' is not a list" in a for a in anomalies)


def test_ml10x_matrix_differential_isolates_changed_rows():
    a = _ml10x_backup()
    b = copy.deepcopy(a)
    b["data"]["presetData"][0]["data"][1]["matrixArray"]["2"] = [0, 0, 0]
    b["data"]["presetData"][0]["data"][1]["matrixArray"]["3"] = [2, 0, 0]
    b["data"]["presetData"][0]["data"][1]["bypass"] = 4
    b["data"]["controllerData"]["midiChannel"] = 10
    rep = ml10x_native.matrix_differential(compact_json(a), compact_json(b))
    assert rep["ok"] and rep["summary"]["presets_changed"] == 1 and rep["summary"]["matrix_rows_changed"] == 2
    p = rep["presets"][0]
    assert p["bank"] == 0 and p["number"] == 1 and p["name_a"] == "Lead"
    rows = {r["row"]: r for r in p["matrix_rows"]}
    assert rows["2"] == {
        "row": "2",
        "hypothesis": "A Tip",
        "before": [4, 0, 0],
        "after": [0, 0, 0],
        "bits_before": ["byte0.bit2"],
        "bits_after": [],
    }
    assert rows["3"]["hypothesis"] == "A Ring" and rows["3"]["bits_after"] == ["byte0.bit1"]
    assert p["other_fields"] == [{"field": "bypass", "before": 0, "after": 4}]
    assert rep["controller_changes"] == [{"field": "midiChannel", "before": 9, "after": 10}]
    assert not ml10x_native.matrix_differential("x", compact_json(a))["ok"]


# ----------------------------------------------------------------------------- API


def test_api_status_and_inspect_autodetect(client):
    status = client.get("/api/morningstar/status").json()
    assert status["ml10x_native_export"]["available"] is False and status["mc8_propose"]["level"] == "fixture_validated"
    mc8 = client.post("/api/morningstar/inspect", content=compact_json(_damaged_single_bank())).json()
    assert mc8["device"] == "mc8" and mc8["coverage"]["messages"]["third_party"] == 1
    ml = client.post("/api/morningstar/inspect", content=compact_json(_ml10x_backup())).json()
    assert ml["device"] == "ml10x" and ml["coverage"]["presets_used"] == 2
    other = client.post(
        "/api/morningstar/inspect",
        content=json.dumps({"schemaVersion": 1, "dumpType": "allBanks", "deviceModel": 8, "data": {"bankArray": []}}),
    ).json()
    assert other["device"] is None and any("deviceModel 8" in p for p in other["native"]["problems"])
    garbage = client.post("/api/morningstar/inspect", content=b"\xff\xfe not json").json()
    assert garbage["device"] is None and garbage["native"]["ok"] is False


def test_api_compare_with_demo_rig(client):
    rig_id = client.get("/api/rigs").json()[0]["id"]
    export = client.get(f"/api/rigs/{rig_id}/exports/mc8-bank/1").json()
    file_text = serialize(export["dump"])
    rep = client.post("/api/morningstar/mc8/compare", json={"file": file_text, "rig_id": rig_id}).json()
    assert (
        rep["summary"]["identical"] is True
        and rep["rig"]["bank_number"] == 1
        and rep["rig"]["bank_name"] == "Demo song"
    )
    changed = json.loads(file_text)
    changed["data"]["bank"]["presetArray"][0]["msgArray"][0]["d2"] = 64
    changed["data"]["bank"]["presetArray"][0]["shortName"] = "Clean2"
    rep2 = client.post(
        "/api/morningstar/mc8/compare", json={"file": serialize(changed), "rig_id": rig_id, "bank_number": 1}
    ).json()
    a = rep2["positions"][0]
    assert a["status"] == "differs" and set(a["differences"]) >= {"short_name", "messages"}
    assert a["native"]["short_name"] == "Clean2" and a["modeled"]["short_name"] == "Clean"
    missing = client.post("/api/morningstar/mc8/compare", json={"file": file_text, "rig_id": rig_id, "bank_number": 7})
    assert missing.status_code == 404 and missing.json()["detail"]["available_banks"] == [1]
    assert client.post("/api/morningstar/mc8/compare", json={"file": "nope", "rig_id": rig_id}).status_code == 422
    assert (
        client.post("/api/morningstar/mc8/compare", json={"file": file_text, "rig_id": "rig_missing"}).status_code
        == 404
    )
    all_banks = client.post("/api/morningstar/mc8/compare", json={"file": compact_json(_all_banks()), "rig_id": rig_id})
    assert all_banks.status_code == 422 and "bank_index" in json.dumps(all_banks.json())


def test_api_propose_and_matrix_diff(client):
    raw = compact_json(_damaged_single_bank())
    ok = client.post(
        "/api/morningstar/mc8/propose", json={"file": raw, "edits": [{"path": ["bankName"], "value": "Live"}]}
    ).json()
    assert ok["ok"] and ok["diff"]["total"] == 1 and ok["self_check"]["ok"]
    refused = client.post(
        "/api/morningstar/mc8/propose",
        json={"file": raw, "edits": [{"path": ["presetArray", 0, "msgArray", 0, "d3"], "value": 1}]},
    )
    assert refused.status_code == 422 and "not editable" in json.dumps(refused.json())
    a = compact_json(_ml10x_backup())
    b = json.loads(a)
    b["data"]["presetData"][0]["data"][1]["matrixArray"]["0"] = [0, 0, 0]
    rep = client.post("/api/morningstar/ml10x/matrix-diff", json={"a": a, "b": compact_json(b)}).json()
    assert rep["summary"]["matrix_rows_changed"] == 1 and rep["structural"]["total"] == 1
    assert client.post("/api/morningstar/ml10x/matrix-diff", json={"a": "x", "b": a}).status_code == 422
