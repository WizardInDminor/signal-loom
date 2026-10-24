"""ML10X Native Integration V2 — offline preset proposals on editor Device Backups.

Every test builds a synthetic backup with the shape of the one real file (4 × 128 presets, 14 connectors,
Java hash over compact ``data``) and then proves preservation: whatever an operation does, every opaque
field (``matrixArray``, ``advancedMode``, ``bypass``, ``tipT``, ``ringT``, unknown keys) travels verbatim,
untouched slots and controller settings are identical, the hash is recomputed, and a refused transaction
produces no file. The real third-party backup (GPL-licensed, never vendored) is used when present.
"""

from __future__ import annotations

import copy
import json
from datetime import UTC, datetime

import pytest

from app.morningstar import ml10x_native, ml10x_propose, specs
from app.morningstar.mc8_export import compact_json, java_string_hash
from tests.conftest import external_fixture
from tests.test_morningstar_bridge import _ml10x_backup

NOW = datetime(2026, 10, 24, 12, 0, 0, 123000, tzinfo=UTC)


def _rehash(doc: dict) -> dict:
    doc["hash"] = java_string_hash(compact_json(doc["data"]))
    return doc


def _preset(doc: dict, bank: int, n: int) -> dict:
    return doc["data"]["presetData"][bank]["data"][n]


def _backup() -> dict:
    """The shared synthetic backup plus an Advanced preset with routing data and a 'used then reverted' slot."""
    doc = _ml10x_backup()
    adv = _preset(doc, 1, 5)  # "Split", advancedMode already True
    adv["matrixArray"]["0"] = [0, 0, 5]
    adv["matrixArray"]["3"] = [7, 0, 0]
    adv["bypass"] = 3
    adv["tipT"] = 1
    reverted = _preset(doc, 0, 2)  # named "Empty" but carrying matrix data (as 3 slots of the real file do)
    reverted["matrixArray"]["15"] = [1, 0, 0]
    return _rehash(doc)


def _ops_result(doc: dict, ops: list, **kw) -> dict:
    return ml10x_propose.propose(compact_json(doc), ops, now=NOW, **kw)


def _slot(bank: int, preset: int) -> dict:
    return {"bank": bank, "preset": preset}


def _assert_refused(result: dict, *needles: str) -> None:
    assert result["ok"] is False and result["text"] is None and result["filename"] is None
    joined = " ".join(result["problems"])
    for needle in needles:
        assert needle in joined, (needle, result["problems"])


# ----------------------------------------------------------------------------- input gate


def test_noop_round_trip_is_byte_identical_and_keeps_metadata():
    doc = _backup()
    raw = compact_json(doc)
    r = _ops_result(doc, [])
    assert r["ok"] and r["text"] == raw and r["preserved"]["byte_identical_to_input"] is True
    assert r["preserved"]["structurally_identical_to_input"] is True and r["diff"]["total"] == 0
    assert r["identity"]["hash"] == doc["hash"] and r["identity"]["download_date"] == doc["downloadDate"]
    assert r["diff"]["metadata"]["hash"] == {"before": doc["hash"], "after": doc["hash"]}
    assert any("byte for byte" in w for w in r["warnings"])


def test_pretty_printed_input_round_trips_verbatim_without_edits_and_compacts_with_edits():
    doc = _backup()
    pretty = json.dumps(doc, indent=2) + "\n"
    r = ml10x_propose.propose(pretty, [], now=NOW)
    assert r["ok"] and r["text"] == pretty and r["preserved"]["byte_identical_to_input"] is True
    r2 = ml10x_propose.propose(pretty, [{"op": "rename", "slot": _slot(0, 1), "name": "Lead 2"}], now=NOW)
    assert r2["ok"] and r2["preserved"]["byte_identical_to_input"] is False
    assert r2["preserved"]["structurally_identical_to_input"] is False
    assert r2["text"] == compact_json(json.loads(r2["text"]))  # compact, like the editor writes


def test_matching_hash_accepted_missing_and_wrong_hash_refused_but_inspection_still_works():
    doc = _backup()
    ok = _ops_result(doc, [{"op": "rename", "slot": _slot(0, 1), "name": "Lead 2"}])
    assert ok["ok"]
    missing = copy.deepcopy(doc)
    del missing["hash"]
    _assert_refused(_ops_result(missing, []), "integrity hash missing")
    assert ml10x_native.inspect(compact_json(missing))["interpreted"] is not None
    wrong = copy.deepcopy(doc)
    wrong["hash"] = wrong["hash"] + 1
    _assert_refused(_ops_result(wrong, []), "integrity hash mismatch")
    assert ml10x_native.inspect(compact_json(wrong))["native"]["hash_matches"] is False
    # Never silently repaired: the refused result carries no text at all.
    assert _ops_result(wrong, [])["text"] is None


@pytest.mark.parametrize(
    "mutate, needle",
    [
        (lambda d: d.__setitem__("schemaVersion", 2), "schemaVersion 2"),
        (lambda d: d.__setitem__("dumpType", "bank"), "dumpType 'bank'"),
        (lambda d: d.__setitem__("deviceModel", 4), "deviceModel 4"),
        (lambda d: d["data"]["presetData"].pop(), "list of 4 banks"),
        (lambda d: d["data"]["presetData"][2]["data"].pop(), "bank 2 has 127 presets"),
        (lambda d: d["data"]["presetData"][1].__setitem__("bank", 7), "bank entry 1 carries bank 7"),
        (lambda d: _preset(d, 3, 9).__setitem__("presetNumber", 10), "presetNumber 10 does not match"),
        (lambda d: _preset(d, 3, 9)["matrixArray"].__setitem__("4", "x"), "row '4' is not a list"),
        (lambda d: _preset(d, 3, 9).pop("bypass"), "lacks the native key 'bypass'"),
        (lambda d: _preset(d, 3, 9).__setitem__("advancedMode", 1), "advancedMode is not a boolean"),
        (lambda d: d["data"].pop("controllerData"), "controllerData missing"),
    ],
)
def test_unsupported_or_malformed_structure_is_refused(mutate, needle):
    doc = _backup()
    mutate(doc)
    _rehash(doc)
    _assert_refused(_ops_result(doc, []), needle)


@pytest.mark.parametrize("raw", ["", "not json", "[1,2]", '{"deviceModel": 7}'])
def test_broken_input_is_refused_without_raising(raw):
    r = ml10x_propose.propose(raw, [])
    assert r["ok"] is False and r["text"] is None and r["problems"]


def test_original_input_is_never_mutated_and_proposals_are_deterministic():
    doc = _backup()
    raw = compact_json(doc)
    ops = [
        {"op": "copy", "source": _slot(0, 1), "destination": _slot(2, 3)},
        {"op": "swap", "a": _slot(0, 0), "b": _slot(1, 5)},
    ]
    a = ml10x_propose.propose(raw, ops, now=NOW)
    b = ml10x_propose.propose(raw, ops, now=NOW)
    assert a["ok"] and a["text"] == b["text"] and json.loads(raw) == doc


# ----------------------------------------------------------------------------- rename


def test_rename_changes_only_the_name_recomputes_hash_and_reparses():
    doc = _backup()
    r = _ops_result(doc, [{"op": "rename", "slot": _slot(0, 1), "name": "Lead 2"}])
    assert r["ok"] and r["operations_applied"] == 1 and r["diff"]["total"] == 1
    change = r["diff"]["changes"][0]
    assert change["label"] == "data / presetData / bank 0 / data / preset 1 'Lead' / presetName"
    assert change["before"] == "Lead" and change["after"] == "Lead 2"
    out = json.loads(r["text"])
    assert out["hash"] == java_string_hash(compact_json(out["data"])) and out["hash"] != doc["hash"]
    assert out["downloadDate"] == "2026-10-24T12:00:00.123Z" and out["deviceModel"] == 7 and out["dumpType"] == "full"
    assert r["diff"]["metadata"]["download_date"]["before"] == doc["downloadDate"]
    p = _preset(out, 0, 1)
    assert (
        p["presetName"] == "Lead 2"
        and p["futureField"] == "?"
        and p["matrixArray"] == _preset(doc, 0, 1)["matrixArray"]
    )
    assert r["self_check"]["ok"] and r["self_check"]["hash_matches"] is True
    assert all(c["ok"] for c in r["preservation"])
    assert r["slots"] == [
        {
            "bank": 0,
            "preset": 1,
            "before": {
                "name": "Lead",
                "occupancy": "occupied",
                "reason": "routing data in matrix row(s) 0, 2, 15",
                "advanced": False,
                "matrix_rows_with_data": 3,
                "bypass": 0,
                "spillover": [127, 127],
                "unknown_keys": ["futureField"],
            },
            "after": {
                "name": "Lead 2",
                "occupancy": "occupied",
                "reason": "routing data in matrix row(s) 0, 2, 15",
                "advanced": False,
                "matrix_rows_with_data": 3,
                "bypass": 0,
                "spillover": [127, 127],
                "unknown_keys": ["futureField"],
            },
            "fields_changed": ["presetName"],
        }
    ]
    inspected = ml10x_native.inspect(r["text"])
    assert (
        inspected["native"]["ok"] and inspected["native"]["byte_exact"] and inspected["coverage"]["presets_used"] == 3
    )


@pytest.mark.parametrize(
    "name, needle",
    [
        ("", "must not be empty"),
        ("   ", "must not be empty"),
        ("Seventeen chars!!", "at most 16"),
        ("Thirteen char", "13-16 characters is unverified"),
        ("Café", "printable ASCII (4 characters, 5 UTF-8 bytes)"),
        ("Tab\there", "printable ASCII"),
        (42, "must be a string"),
    ],
)
def test_rename_rejects_invalid_names_without_truncating(name, needle):
    _assert_refused(_ops_result(_backup(), [{"op": "rename", "slot": _slot(0, 1), "name": name}]), needle)


def test_rename_accepts_13_to_16_characters_only_with_explicit_consent_and_warns():
    r = _ops_result(
        _backup(), [{"op": "rename", "slot": _slot(0, 1), "name": "Thirteen char", "accept_unverified_length": True}]
    )
    assert r["ok"] and _preset(json.loads(r["text"]), 0, 1)["presetName"] == "Thirteen char"
    assert any("13 characters" in w and "12 bytes" in w for w in r["warnings"])
    trailing = _ops_result(_backup(), [{"op": "rename", "slot": _slot(0, 1), "name": "Lead  "}])
    assert trailing["ok"] and any("ends with spaces" in w for w in trailing["warnings"])
    assert _preset(json.loads(trailing["text"]), 0, 1)["presetName"] == "Lead  "  # kept as typed


def test_rename_to_factory_name_keeps_slot_occupied_and_warns():
    r = _ops_result(_backup(), [{"op": "rename", "slot": _slot(0, 1), "name": "Empty"}])
    assert r["ok"] and any("still treat it as occupied" in w for w in r["warnings"])
    assert r["slots"][0]["after"]["occupancy"] == "occupied"


# ----------------------------------------------------------------------------- copy


@pytest.mark.parametrize("dest", [(0, 40), (3, 127)])
def test_copy_within_and_across_banks_preserves_the_whole_payload(dest):
    doc = _backup()
    src = _preset(doc, 0, 1)
    r = _ops_result(doc, [{"op": "copy", "source": _slot(0, 1), "destination": _slot(*dest)}])
    assert r["ok"] and r["effects"][0]["overwrote"] is None
    out = json.loads(r["text"])
    copied = _preset(out, *dest)
    assert copied["presetNumber"] == dest[1]
    assert {k: v for k, v in copied.items() if k != "presetNumber"} == {
        k: v for k, v in src.items() if k != "presetNumber"
    }
    assert list(copied) == list(src)  # key order travels too
    assert _preset(out, 0, 1) == src  # source untouched
    assert r["preserved"]["untouched_presets"] == 511 and r["preserved"]["unknown_keys_after"] == 3
    assert r["effects"][0]["verified"] == {"payload_identical": True}


def test_copy_of_an_advanced_preset_keeps_its_encoded_routing_bypass_and_spillover():
    doc = _backup()
    adv = _preset(doc, 1, 5)
    r = _ops_result(doc, [{"op": "copy", "source": _slot(1, 5), "destination": _slot(2, 0)}])
    out = json.loads(r["text"])
    c = _preset(out, 2, 0)
    assert c["advancedMode"] is True and c["bypass"] == 3 and c["tipT"] == 1 and c["ringT"] == 127
    assert c["matrixArray"] == adv["matrixArray"] and c["matrixArray"]["3"] == [7, 0, 0]
    assert r["slots"][0]["after"]["reason"] == "routing data in matrix row(s) 0, 3"


def test_copy_onto_an_occupied_slot_needs_explicit_overwrite():
    doc = _backup()
    refused = _ops_result(doc, [{"op": "copy", "source": _slot(0, 1), "destination": _slot(1, 5)}])
    _assert_refused(
        refused, "bank 2 preset 5 is occupied ('Split': routing data in matrix row(s) 0, 3)", "Set overwrite"
    )
    accepted = _ops_result(doc, [{"op": "copy", "source": _slot(0, 1), "destination": _slot(1, 5), "overwrite": True}])
    assert accepted["ok"] and accepted["effects"][0]["overwrote"]["name"] == "Split"
    assert _preset(json.loads(accepted["text"]), 1, 5)["presetName"] == "Lead"


def test_a_slot_named_empty_with_routing_data_counts_as_occupied():
    doc = _backup()  # bank 0 preset 2 is "Empty" with row 15 set
    r = _ops_result(doc, [{"op": "copy", "source": _slot(0, 1), "destination": _slot(0, 2)}])
    _assert_refused(r, "bank 1 preset 2 is occupied ('Empty': routing data in matrix row(s) 15)")
    assert ml10x_native.slot_occupancy(_preset(doc, 0, 2))["state"] == "occupied"
    assert ml10x_native.slot_occupancy(_preset(doc, 0, 3))["state"] == "empty"


def test_copy_refuses_same_slot_and_out_of_range_coordinates():
    _assert_refused(
        _ops_result(_backup(), [{"op": "copy", "source": _slot(0, 1), "destination": _slot(0, 1)}]), "same slot"
    )
    _assert_refused(
        _ops_result(_backup(), [{"op": "copy", "source": _slot(0, 1), "destination": _slot(4, 0)}]), "bank must be 0-3"
    )
    _assert_refused(
        _ops_result(_backup(), [{"op": "copy", "source": _slot(0, 128), "destination": _slot(0, 0)}]),
        "preset must be 0-127",
    )
    _assert_refused(
        _ops_result(_backup(), [{"op": "copy", "source": "0/1", "destination": _slot(0, 0)}]), "expected {bank, preset}"
    )


# ----------------------------------------------------------------------------- move


def test_move_to_an_empty_slot_clears_the_source_with_the_files_own_factory_payload():
    doc = _backup()
    src = copy.deepcopy(_preset(doc, 1, 5))
    r = _ops_result(doc, [{"op": "move", "source": _slot(1, 5), "destination": _slot(3, 10)}])
    assert r["ok"]
    out = json.loads(r["text"])
    moved = _preset(out, 3, 10)
    assert {k: v for k, v in moved.items() if k != "presetNumber"} == {
        k: v for k, v in src.items() if k != "presetNumber"
    }
    cleared = _preset(out, 1, 5)
    assert cleared == {
        "presetNumber": 5,
        "presetName": "Empty",
        "tipT": 127,
        "ringT": 127,
        "matrixArray": {str(k): [0, 0, 0] for k in range(16)},
        "advancedMode": False,
        "bypass": 0,
    }
    assert cleared == _preset(doc, 3, 11) | {"presetNumber": 5}  # identical to a factory slot of the same file
    e = r["effects"][0]
    assert e["op"] == "move" and e["verified"] == {"payload_identical": True, "source_cleared_with_file_template": True}
    assert (
        "506" not in e["cleared_with"] and "factory-empty slot(s) in this file share one payload" in e["cleared_with"]
    )
    assert r["preserved"]["touched_presets"] == 2


def test_move_onto_an_occupied_slot_needs_an_explicit_choice():
    doc = _backup()
    _assert_refused(
        _ops_result(doc, [{"op": "move", "source": _slot(0, 1), "destination": _slot(1, 5)}]),
        "bank 2 preset 5 is occupied",
        "'swap'",
        "'overwrite'",
    )
    _assert_refused(
        _ops_result(doc, [{"op": "move", "source": _slot(0, 1), "destination": _slot(1, 5), "on_occupied": "maybe"}]),
        "on_occupied must be one of",
    )
    swapped = _ops_result(
        doc, [{"op": "move", "source": _slot(0, 1), "destination": _slot(1, 5), "on_occupied": "swap"}]
    )
    out = json.loads(swapped["text"])
    assert swapped["effects"][0]["op"] == "swap" and swapped["effects"][0]["via"] == "move"
    assert _preset(out, 1, 5)["presetName"] == "Lead" and _preset(out, 0, 1)["presetName"] == "Split"
    assert (
        _preset(out, 0, 1)["advancedMode"] is True
        and _preset(out, 0, 1)["matrixArray"] == _preset(doc, 1, 5)["matrixArray"]
    )
    replaced = _ops_result(
        doc, [{"op": "move", "source": _slot(0, 1), "destination": _slot(1, 5), "on_occupied": "overwrite"}]
    )
    out = json.loads(replaced["text"])
    assert replaced["effects"][0]["overwrote"]["name"] == "Split"
    assert _preset(out, 1, 5)["presetName"] == "Lead" and _preset(out, 0, 1)["presetName"] == "Empty"
    assert ml10x_native.slot_occupancy(_preset(out, 0, 1))["state"] == "empty"


def test_move_from_an_empty_slot_is_refused():
    _assert_refused(
        _ops_result(_backup(), [{"op": "move", "source": _slot(2, 2), "destination": _slot(2, 3)}]), "nothing to move"
    )


def test_move_is_refused_when_the_file_establishes_no_empty_slot_representation():
    doc = _backup()
    for b in doc["data"]["presetData"]:
        for p in b["data"]:
            p["presetName"] = f"P{b['bank']}-{p['presetNumber']}"
    _rehash(doc)
    r = _ops_result(
        doc, [{"op": "move", "source": _slot(0, 1), "destination": _slot(2, 3), "on_occupied": "overwrite"}]
    )
    _assert_refused(r, "cannot clear bank 1 preset 1", "no factory-empty slot in this file", "Use copy")
    # Copy and swap still work on such a file.
    assert _ops_result(doc, [{"op": "swap", "a": _slot(0, 1), "b": _slot(2, 3)}])["ok"]
    assert _ops_result(doc, [{"op": "copy", "source": _slot(0, 1), "destination": _slot(2, 3), "overwrite": True}])[
        "ok"
    ]
    assert ml10x_propose.slot_map(compact_json(doc))["empty_rule"]["template_available"] is False


# ----------------------------------------------------------------------------- swap


@pytest.mark.parametrize("b", [(0, 3), (1, 5), (3, 127)])
def test_swap_within_and_across_banks_keeps_both_payloads(b):
    doc = _backup()
    pa, pb = copy.deepcopy(_preset(doc, 0, 1)), copy.deepcopy(_preset(doc, *b))
    r = _ops_result(doc, [{"op": "swap", "a": _slot(0, 1), "b": _slot(*b)}])
    assert r["ok"]
    out = json.loads(r["text"])
    na, nb = _preset(out, 0, 1), _preset(out, *b)
    assert {k: v for k, v in na.items() if k != "presetNumber"} == {k: v for k, v in pb.items() if k != "presetNumber"}
    assert {k: v for k, v in nb.items() if k != "presetNumber"} == {k: v for k, v in pa.items() if k != "presetNumber"}
    assert na["presetNumber"] == 1 and nb["presetNumber"] == b[1]
    assert r["effects"][0]["verified"] == {"a_holds_former_b": True, "b_holds_former_a": True}
    assert all(c["ok"] for c in r["preservation"]) and r["preserved"]["untouched_presets"] == 510


def test_swap_refuses_the_same_slot_and_warns_when_both_are_empty():
    _assert_refused(_ops_result(_backup(), [{"op": "swap", "a": _slot(1, 1), "b": _slot(1, 1)}]), "two different slots")
    r = _ops_result(_backup(), [{"op": "swap", "a": _slot(2, 1), "b": _slot(2, 2)}])
    assert r["ok"] and any("changes nothing" in w for w in r["warnings"]) and r["diff"]["total"] == 0
    assert r["preserved"]["byte_identical_to_input"] is True


# ----------------------------------------------------------------------------- transactions and preservation


def test_a_transaction_fails_as_a_whole_and_nothing_is_applied():
    doc = _backup()
    r = _ops_result(
        doc,
        [
            {"op": "rename", "slot": _slot(0, 1), "name": "Fine"},
            {"op": "copy", "source": _slot(0, 1), "destination": _slot(2, 2)},
            {"op": "copy", "source": _slot(0, 1), "destination": _slot(1, 5)},  # occupied, no overwrite
            {"op": "rename", "slot": _slot(0, 1), "name": ""},
        ],
    )
    _assert_refused(r, "operation 3", "operation 4", "nothing was applied and no file is produced")
    assert r["operations_applied"] == 0 and r["effects"] == [] and r["diff"]["total"] == 0


def test_chained_operations_are_judged_against_the_state_they_acted_on():
    doc = _backup()
    r = _ops_result(
        doc,
        [
            {"op": "copy", "source": _slot(0, 1), "destination": _slot(2, 7)},
            {"op": "rename", "slot": _slot(2, 7), "name": "Lead copy"},
            {"op": "move", "source": _slot(2, 7), "destination": _slot(3, 0)},
            {"op": "swap", "a": _slot(3, 0), "b": _slot(0, 0)},
        ],
    )
    assert r["ok"], r["problems"]
    out = json.loads(r["text"])
    assert (
        _preset(out, 0, 0)["presetName"] == "Lead copy"
        and _preset(out, 0, 0)["matrixArray"] == _preset(doc, 0, 1)["matrixArray"]
    )
    assert _preset(out, 3, 0)["presetName"] == "Empty" and _preset(out, 2, 7)["presetName"] == "Empty"
    assert _preset(out, 0, 1) == _preset(doc, 0, 1)
    assert all(c["ok"] for c in r["preservation"]), [c for c in r["preservation"] if not c["ok"]]


@pytest.mark.parametrize("op", [{"op": "delete", "slot": _slot(0, 1)}, {"op": "set_matrix"}, {"nope": 1}, "rename"])
def test_unsupported_operations_are_refused(op):
    _assert_refused(_ops_result(_backup(), [op]), "op must be one of rename, copy, move, swap, rename_connector")


def test_no_operation_ever_touches_routing_bypass_mode_spillover_unknown_keys_or_controller_data():
    doc = _backup()
    doc["editorBuild"] = "2026.10"  # unknown top-level key
    doc["data"]["deviceNotes"] = {"x": 1}  # unknown data-level key
    doc["data"]["presetData"][2]["label"] = "Live"  # unknown bank-level key
    _rehash(doc)
    ops = [
        {"op": "rename", "slot": _slot(0, 1), "name": "Lead 2"},
        {"op": "copy", "source": _slot(1, 5), "destination": _slot(2, 9)},
        {"op": "move", "source": _slot(0, 1), "destination": _slot(3, 3)},
        {"op": "swap", "a": _slot(2, 9), "b": _slot(0, 0)},
        {"op": "rename_connector", "connector": 3, "field": "shortName", "value": "DL"},
    ]
    r = _ops_result(doc, ops)
    assert r["ok"], r["problems"]
    out = json.loads(r["text"])
    assert out["editorBuild"] == "2026.10" and out["data"]["deviceNotes"] == {"x": 1}
    assert out["data"]["presetData"][2]["label"] == "Live" and list(out) == list(doc)
    ctrl_before, ctrl_after = doc["data"]["controllerData"], out["data"]["controllerData"]
    assert {k: v for k, v in ctrl_before.items() if k != "connectors"} == {
        k: v for k, v in ctrl_after.items() if k != "connectors"
    }
    assert ctrl_after["firmwareHint"] == "1.2.0"
    assert ctrl_after["connectors"][3] == ctrl_before["connectors"][3] | {"shortName": "DL"}
    assert (
        ctrl_after["connectors"][:3] + ctrl_after["connectors"][4:]
        == ctrl_before["connectors"][:3] + ctrl_before["connectors"][4:]
    )
    # Every payload in the output existed in the input (modulo number and the one rename) or is the factory payload.
    before = {
        compact_json({k: v for k, v in p.items() if k not in ("presetNumber", "presetName")})
        for b in doc["data"]["presetData"]
        for p in b["data"]
    }
    for b in out["data"]["presetData"]:
        for p in b["data"]:
            assert compact_json({k: v for k, v in p.items() if k not in ("presetNumber", "presetName")}) in before
    touched = {(s["bank"], s["preset"]) for s in r["slots"]}
    assert touched == {(0, 1), (2, 9), (3, 3), (0, 0)}
    for b in out["data"]["presetData"]:
        for p in b["data"]:
            if (b["bank"], p["presetNumber"]) not in touched:
                assert p == _preset(doc, b["bank"], p["presetNumber"])
    assert r["preserved"]["unknown_keys_before"] == r["preserved"]["unknown_keys_after"] == 5
    assert r["preserved"]["routing_fields_authored"] == 0


def test_unknown_per_preset_keys_that_vary_make_slots_occupied_but_uniform_ones_stay_inert():
    doc = _backup()
    for b in doc["data"]["presetData"]:
        for p in b["data"]:
            p["hasLoadedOnce"] = False
    _rehash(doc)
    sm = ml10x_propose.slot_map(compact_json(doc))
    assert sm["ok"] and sm["empty_rule"]["template_available"] is True
    assert next(s for s in sm["slots"] if (s["bank"], s["preset"]) == (2, 2))["occupancy"] == "empty"
    r = _ops_result(doc, [{"op": "move", "source": _slot(1, 5), "destination": _slot(2, 2)}])
    assert r["ok"] and _preset(json.loads(r["text"]), 1, 5)["hasLoadedOnce"] is False
    _preset(doc, 2, 2)["hasLoadedOnce"] = True  # now the unknown data varies between presets
    _rehash(doc)
    sm = ml10x_propose.slot_map(compact_json(doc))
    s = next(s for s in sm["slots"] if (s["bank"], s["preset"]) == (2, 2))
    assert s["occupancy"] == "occupied" and "cannot account for" in s["reason"]
    assert next(s for s in sm["slots"] if (s["bank"], s["preset"]) == (2, 3))["occupancy"] == "occupied"
    assert sm["empty_rule"]["template_available"] is False  # the key is no longer uniform, so nothing is "free"
    _assert_refused(
        _ops_result(doc, [{"op": "copy", "source": _slot(0, 1), "destination": _slot(2, 2)}]), "is occupied"
    )


# ----------------------------------------------------------------------------- connector names


def test_connector_names_are_editable_within_wire_widths_and_everything_else_is_read_only():
    doc = _backup()
    r = _ops_result(
        doc,
        [
            {"op": "rename_connector", "connector": 0, "field": "name", "value": "Sixteen chars!!!"},
            {"op": "rename_connector", "connector": 13, "field": "outputName", "value": "Out aux"},
        ],
    )
    assert r["ok"] and r["diff"]["total"] == 2
    out = json.loads(r["text"])
    assert out["data"]["controllerData"]["connectors"][0]["name"] == "Sixteen chars!!!"
    assert out["data"]["controllerData"]["connectors"][13]["outputName"] == "Out aux"
    assert r["diff"]["changes"][0]["label"] == "data / controllerData / connectors / connector 0 'Pedal 0' / name"
    for op, needle in [
        ({"op": "rename_connector", "connector": 0, "field": "name", "value": "Seventeen chars!!"}, "device stores 16"),
        ({"op": "rename_connector", "connector": 0, "field": "shortName", "value": "ABCDE"}, "device stores 4"),
        ({"op": "rename_connector", "connector": 0, "field": "trails", "value": True}, "read-only in this version"),
        ({"op": "rename_connector", "connector": 0, "field": "name", "value": "Naïve"}, "printable ASCII"),
        ({"op": "rename_connector", "connector": 14, "field": "name", "value": "x"}, "connector must be 0-13"),
    ]:
        _assert_refused(_ops_result(doc, [op]), needle)
    doc["data"]["controllerData"]["connectors"][2]["id"] = 9
    _rehash(doc)
    _assert_refused(
        _ops_result(doc, [{"op": "rename_connector", "connector": 2, "field": "name", "value": "x"}]), "carries id 9"
    )


# ----------------------------------------------------------------------------- inspect report integration


def test_inspect_report_exposes_structural_occupancy():
    rep = ml10x_native.inspect(compact_json(_backup()))
    names = {(n["bank"], n["number"]): n for n in rep["interpreted"]["preset_names"]}
    assert names[(0, 1)]["occupancy"] == "occupied" and names[(0, 2)]["occupancy"] == "occupied"
    assert names[(0, 3)]["occupancy"] == "empty" and "factory payload" in names[(0, 3)]["occupancy_reason"]
    assert rep["coverage"]["presets_empty"] == 509 and rep["coverage"]["proposal_available"] is True
    assert rep["coverage"]["native_export_available"] is False and rep["coverage"]["routing_decoded"] is False


def test_real_backup_round_trips_and_moves_a_preset_without_touching_anything_else():
    path = external_fixture("ml10x-editor-device-backup.json")
    if path is None:
        pytest.skip("external ML10X fixture not available (GPL-licensed third-party file; copy manually)")
    raw = path.read_text(encoding="utf-8")
    assert ml10x_propose.propose(raw, [])["text"] == raw
    sm = ml10x_propose.slot_map(raw)
    assert sm["ok"] and sum(1 for s in sm["slots"] if s["occupancy"] == "empty") == 506
    r = ml10x_propose.propose(raw, [{"op": "move", "source": _slot(0, 21), "destination": _slot(3, 127)}], now=NOW)
    assert r["ok"] and all(c["ok"] for c in r["preservation"])
    out, src = json.loads(r["text"]), json.loads(raw)
    assert {k: v for k, v in _preset(out, 3, 127).items() if k != "presetNumber"} == {
        k: v for k, v in _preset(src, 0, 21).items() if k != "presetNumber"
    }
    assert ml10x_native.inspect(r["text"])["native"]["hash_matches"] is True


# ----------------------------------------------------------------------------- API


def test_api_successful_proposal_and_slots(client):
    doc = _backup()
    raw = compact_json(doc)
    body = {"file": raw, "operations": [{"op": "copy", "source": _slot(0, 1), "destination": _slot(1, 2)}]}
    res = client.post("/api/morningstar/ml10x/propose", json=body)
    assert res.status_code == 200, res.text
    r = res.json()
    assert (
        r["ok"]
        and r["filename"].startswith("Morningstar_ML10X_Backup_File_")
        and r["filename"].endswith("_signal-loom-candidate.json")
    )
    assert r["evidence"]["editor_validated"] is False and r["evidence"]["hardware_validated"] is False
    assert r["diff"]["total"] == 5  # presetName, futureField (added), matrix rows 0, 2 and 15
    out = json.loads(r["text"])
    assert _preset(out, 1, 2)["presetName"] == "Lead" and out["hash"] == java_string_hash(compact_json(out["data"]))
    slots = client.post("/api/morningstar/ml10x/slots", content=raw).json()
    assert slots["ok"] and len(slots["slots"]) == 512 and slots["empty_rule"]["template_available"] is True
    assert client.post("/api/morningstar/ml10x/slots", content="nope").status_code == 422
    status = client.get("/api/morningstar/status").json()
    assert status["ml10x_propose"]["available"] is True and status["ml10x_native_export"]["available"] is False


def test_structural_diff_names_each_changed_value():
    doc = _backup()
    r = ml10x_propose.propose(
        compact_json(doc), [{"op": "copy", "source": _slot(0, 1), "destination": _slot(1, 2)}], now=NOW
    )
    labels = sorted(c["label"] for c in r["diff"]["changes"])
    assert (
        labels
        == [
            "data / presetData / bank 1 / data / preset 2 'Empty' / matrixArray / 0",
            "data / presetData / bank 1 / data / preset 2 'Empty' / matrixArray / 15",
            "data / presetData / bank 1 / data / preset 2 'Empty' / matrixArray / 2",
            "data / presetData / bank 1 / data / preset 2 'Empty' / presetName",
            "data / presetData / bank 1 / data / preset 2 'Lead' / futureField",  # an added key is labelled with the new name
        ]
    )
    kinds = {c["label"].rsplit(" / ", 1)[1]: c["change"] for c in r["diff"]["changes"]}
    assert kinds["futureField"] == "added" and kinds["presetName"] == "changed"


@pytest.mark.parametrize(
    "body, status, needle",
    [
        ({"file": "garbage", "operations": []}, 422, "not valid JSON"),
        (
            {
                "file": compact_json(
                    {"schemaVersion": 1, "dumpType": "singleBank", "deviceModel": 4, "hash": 1, "data": {}}
                ),
                "operations": [],
            },
            422,
            "deviceModel 4",
        ),
        ({"operations": []}, 422, "file"),
        ({"file": "{}", "operations": [{"op": "explode"}]}, 422, "op"),
        (
            {
                "file": "{}",
                "operations": [
                    {"op": "copy", "source": {"bank": 4, "preset": 0}, "destination": {"bank": 0, "preset": 0}}
                ],
            },
            422,
            "bank",
        ),
        (
            {
                "file": "{}",
                "operations": [
                    {"op": "move", "source": _slot(0, 0), "destination": _slot(0, 1), "on_occupied": "maybe"}
                ],
            },
            422,
            "on_occupied",
        ),
    ],
)
def test_api_refuses_invalid_requests_corrupt_files_and_other_device_models_without_a_file(
    client, body, status, needle
):
    res = client.post("/api/morningstar/ml10x/propose", json=body)
    assert res.status_code == status
    text = json.dumps(res.json())
    assert needle in text and '"text"' not in text


def test_api_refused_transaction_returns_diagnostics_and_no_file(client):
    doc = _backup()
    res = client.post(
        "/api/morningstar/ml10x/propose",
        json={
            "file": compact_json(doc),
            "operations": [{"op": "copy", "source": _slot(0, 1), "destination": _slot(1, 5)}],
        },
    )
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["message"] == "Proposal refused." and detail["ok"] is False
    assert any("is occupied" in p for p in detail["problems"]) and "text" not in detail
    assert detail["evidence"]["restore_scope"].startswith("dumpType 'full'")


def test_mc8_proposal_endpoint_still_refuses_ml10x_files_and_vice_versa(client):
    ml = compact_json(_backup())
    res = client.post("/api/morningstar/mc8/propose", json={"file": ml, "edits": []})
    assert res.status_code == 422 and "deviceModel 7" in res.text
    from tests.test_morningstar_bridge import _damaged_single_bank

    mc8 = compact_json(_damaged_single_bank())
    res = client.post("/api/morningstar/ml10x/propose", json={"file": mc8, "operations": []})
    assert res.status_code == 422 and "deviceModel 4" in res.text


def test_specs_unchanged_for_ml10x_limits():
    assert specs.ML10X_BANKS == 4 and specs.ML10X_PRESETS_PER_BANK == 128 and specs.ML10X_PRESET_NAME_MAX == 16
    assert ml10x_propose.PRESET_NAME_WIRE_BYTES == 12 and ml10x_propose.CONNECTOR_FIELD_WIRE_BYTES["shortName"] == 4
