"""ML10X editor backup files: native snapshot, interpreted configuration, opaque routing.

The ML10X editor's "Device Backup" has been seen in exactly one real file (a third-party,
GPL-licensed repository; analysed locally, never vendored). Everything below that is not marked
``third_party`` was established in Session 7 by comparing that file with the same project's
captured device messages:

- ``hash`` is Java ``String.hashCode`` over the compact JSON of ``data`` — the MC8 algorithm —
  reproduced on that one file (evidence: 1 sample).
- ``matrixArray["k"]`` is byte-for-byte the device's preset SysEx segment 48+k (3 presets compared).
- The non-zero matrix rows coincide with the connectors that have an outgoing link in the preset's
  chain, in the order Input Tip, Input Ring, A Tip, A Ring … E Ring (8 of 8 rows in 3 presets).
  This is an *observation*, offered as a hypothesis label, not a decoder.
- The one-hot column values are not a function of the target connector alone, so the routing stays
  **undecoded**: it is preserved as opaque native data and the limitation is reported.

Signal Loom authors no routing. Since the ML10X Native Integration V2 slice, ``ml10x_propose`` produces a
**candidate** backup for routing-free, whole-preset operations (rename, copy, move, swap, connector names)
with every opaque field carried verbatim and the hash recomputed; editor and hardware acceptance stay open.
"""

from __future__ import annotations

import json
from typing import Any

from . import specs
from .mc8_export import MAX_BYTES, compact_json, java_string_hash

TOP_KEYS = ("schemaVersion", "dumpType", "deviceModel", "downloadDate", "hash", "data")
DATA_KEYS = ("presetData", "controllerData")
CONTROLLER_KEYS = ("midiChannel", "connectors", "deviceId", "inputRingSwapPin", "inputSplit", "loopBypassPersistent")
CONNECTOR_KEYS = ("id", "pos", "name", "shortName", "trails", "inputName", "outputName")
BANK_KEYS = ("bank", "data")
PRESET_KEYS = ("presetNumber", "presetName", "tipT", "ringT", "matrixArray", "advancedMode", "bypass")
MATRIX_ROWS = 16
MATRIX_ROW_BYTES = 3
EXPECTED_CONNECTORS = 14
SPILLOVER_NOTHING = 127  # THIRD_PARTY: "127 = Nothing" for tipT/ringT (only value seen in the fixture)
DEFAULT_PRESET_NAME = "Empty"  # the fixture's factory name; a user may legitimately use it too

# Connector ``id`` -> Signal Loom label. ids 0-9 follow the loop order already in specs (A Tip, A Ring,
# B Tip, ...); 10-13 are the fixed endpoints. Evidence: third-party editor analysis + the fixture's own
# connector names ("guitar" at 10, "Output" at 12).
CONNECTOR_LABELS = {
    **{i: specs.ML10X_LOOP_NAMES[i + 1] for i in range(10)},
    10: "Input Tip",
    11: "Input Ring",
    12: "Output Tip",
    13: "Output Ring",
}
# Observed correspondence of matrix rows to chain *source* connectors (hypothesis, see module doc).
MATRIX_ROW_HYPOTHESIS = {
    0: "Input Tip",
    1: "Input Ring",
    2: "A Tip",
    3: "A Ring",
    4: "B Tip",
    5: "B Ring",
    6: "C Tip",
    7: "C Ring",
    8: "D Tip",
    9: "D Ring",
    10: "E Tip",
    11: "E Ring",
}
ROUTING_STATUS = (
    "undecoded: matrixArray column semantics are not established; the device's explicit connection "
    "records are not part of the backup file, so routing is preserved verbatim and not interpreted"
)


def _unknown_keys(obj: dict, known: tuple[str, ...], path: str, sink: list[dict]) -> list[str]:
    extra = [k for k in obj if k not in known]
    for k in extra:
        sink.append({"path": path, "key": k, "value_preview": json.dumps(obj[k], ensure_ascii=False)[:120]})
    return extra


def load_native(raw: str) -> dict:
    out: dict[str, Any] = {
        "ok": False,
        "problems": [],
        "warnings": [],
        "device_model": None,
        "dump_type": None,
        "schema_version": None,
        "download_date": None,
        "hash": None,
        "hash_matches": None,
        "hash_evidence": "Java String.hashCode over compact data JSON; reproduced on 1 real ML10X backup (third-party fixture)",
        "byte_exact": None,
        "size_bytes": len(raw.encode("utf-8")),
        "unknown_keys": [],
        "data": None,
    }
    if len(raw) > MAX_BYTES:
        out["problems"].append("file too large")
        return out
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError as e:
        out["problems"].append(f"not valid JSON: {e.msg} (line {e.lineno}, column {e.colno})")
        return out
    if not isinstance(doc, dict):
        out["problems"].append("top level is not an object")
        return out
    out["device_model"] = doc.get("deviceModel")
    out["dump_type"] = doc.get("dumpType")
    out["schema_version"] = doc.get("schemaVersion")
    out["download_date"] = doc.get("downloadDate")
    out["hash"] = doc.get("hash") if isinstance(doc.get("hash"), int) else None
    _unknown_keys(doc, TOP_KEYS, "$", out["unknown_keys"])
    if doc.get("deviceModel") != specs.ML10X_EXPORT_DEVICE_MODEL:
        out["problems"].append(
            f"deviceModel {doc.get('deviceModel')!r} is not the ML10X ({specs.ML10X_EXPORT_DEVICE_MODEL}); not interpreted as ML10X data"
        )
    if doc.get("schemaVersion") != 1:
        out["warnings"].append(f"schemaVersion {doc.get('schemaVersion')!r} differs from the one real sample (1)")
    if doc.get("dumpType") != "full":
        out["warnings"].append(f"dumpType {doc.get('dumpType')!r} differs from the one real sample ('full')")
    data = doc.get("data")
    if not isinstance(data, dict):
        out["problems"].append("missing data object")
        return out
    out["data"] = data
    _unknown_keys(data, DATA_KEYS, "$.data", out["unknown_keys"])
    if out["hash"] is not None:
        out["hash_matches"] = java_string_hash(compact_json(data)) == out["hash"]
        if not out["hash_matches"]:
            out["warnings"].append(
                "hash does not match the data section (edited, re-serialized, or a different algorithm)"
            )
    else:
        out["warnings"].append("no integer hash field")
    out["byte_exact"] = compact_json(doc) == raw.strip()
    if not out["byte_exact"]:
        out["warnings"].append("not byte-identical to a compact serialization (pretty-printed or edited)")
    out["ok"] = not out["problems"]
    return out


def _bit_positions(row: list) -> list[str]:
    """Which bits are set, named by byte and bit so no packing assumption is made."""
    bits: list[str] = []
    for bi, v in enumerate(row):
        if isinstance(v, int):
            for b in range(8):
                if v >> b & 1:
                    bits.append(f"byte{bi}.bit{b}")
    return bits


def uniform_unknown_items(presets: list) -> dict:
    """Per-preset keys Signal Loom has not seen that *every* preset carries with an identical value.

    Such keys are inert file-wide (a newer editor's constant), so a factory-empty slot may carry them. Any
    other unknown key is per-preset data and makes its slot occupied. One rule for the inspector grid, the
    slot map and the proposal engine, so they can never disagree.
    """
    uniform: dict | None = None
    for p in presets:
        if not isinstance(p, dict):
            continue
        extra = {k: json.dumps(v, sort_keys=True) for k, v in p.items() if k not in PRESET_KEYS}
        uniform = extra if uniform is None else {k: v for k, v in uniform.items() if extra.get(k) == v}
    if not uniform:
        return {}
    first = next(p for p in presets if isinstance(p, dict))
    return {k: first[k] for k in uniform}


def slot_occupancy(p: Any, uniform_unknown: dict | None = None) -> dict:
    """Is a preset slot confidently empty? Decided on structure, never on the name alone.

    ``empty``: the factory payload — name "Empty", spillover 127/127, Simple mode, bypass 0, all matrix rows zero
    (506 of the 509 "Empty"-named slots of the one real backup) — and, when ``uniform_unknown`` is given (the
    result of :func:`uniform_unknown_items` over the whole file), no per-preset unknown data beyond those inert
    keys. ``occupied``: anything else, with the first reason found. ``malformed``: not a preset object Signal
    Loom can read. A musician may name a configured preset "Empty"; three slots of the real backup are exactly
    that (routing data left behind), so the name is never sufficient.
    """
    if not isinstance(p, dict):
        return {"state": "malformed", "reason": "preset is not an object"}
    name = p.get("presetName")
    matrix = p.get("matrixArray")
    rows_with_data = (
        [k for k, v in matrix.items() if isinstance(v, list) and any(x for x in v if isinstance(x, int))]
        if isinstance(matrix, dict)
        else None
    )
    if rows_with_data is None:
        return {"state": "malformed", "reason": "matrixArray is not an object"}
    if rows_with_data:
        return {"state": "occupied", "reason": f"routing data in matrix row(s) {', '.join(rows_with_data)}"}
    if p.get("advancedMode") is True:
        return {"state": "occupied", "reason": "Advanced mode flag set"}
    if p.get("bypass") not in (0, None) and isinstance(p.get("bypass"), int):
        return {"state": "occupied", "reason": f"bypass bitmap {p.get('bypass')}"}
    if p.get("tipT") != SPILLOVER_NOTHING or p.get("ringT") != SPILLOVER_NOTHING:
        return {"state": "occupied", "reason": "spillover target set"}
    if name != DEFAULT_PRESET_NAME:
        return {"state": "occupied", "reason": f"named {name!r} (no routing data)"}
    if len(matrix) != MATRIX_ROWS:
        return {"state": "occupied", "reason": f"matrixArray has {len(matrix)} rows, not the factory {MATRIX_ROWS}"}
    if uniform_unknown is not None and {k: v for k, v in p.items() if k not in PRESET_KEYS} != uniform_unknown:
        return {
            "state": "occupied",
            "reason": "carries per-preset data Signal Loom cannot account for (unknown keys not shared by every preset)",
        }
    return {
        "state": "empty",
        "reason": "factory payload: name 'Empty', no routing data, Simple mode, bypass 0, spillover off",
    }


def interpret_preset(p: Any, bank: Any, idx: int, sink: list[dict], path: str) -> dict:
    if not isinstance(p, dict):
        return {"bank": bank, "number": idx, "status": "unknown", "raw": p, "anomalies": ["preset is not an object"]}
    anomalies: list[str] = []
    unknown = _unknown_keys(p, PRESET_KEYS, path, sink)
    num = p.get("presetNumber")
    if num != idx:
        anomalies.append(f"presetNumber {num!r} does not match its array position {idx}")
    name = p.get("presetName") if isinstance(p.get("presetName"), str) else ""
    if len(name) > specs.ML10X_PRESET_NAME_MAX:
        anomalies.append(f"presetName is {len(name)} characters (limit {specs.ML10X_PRESET_NAME_MAX} unverified)")
    matrix = p.get("matrixArray")
    rows: dict[str, Any] = {}
    nonzero: list[dict] = []
    if isinstance(matrix, dict):
        if len(matrix) != MATRIX_ROWS:
            anomalies.append(f"matrixArray has {len(matrix)} rows (the sample has {MATRIX_ROWS})")
        for k, v in matrix.items():
            rows[str(k)] = v
            ok_shape = isinstance(v, list) and len(v) == MATRIX_ROW_BYTES and all(isinstance(x, int) for x in v)
            if not ok_shape:
                anomalies.append(f"matrixArray row {k!r} is not a list of {MATRIX_ROW_BYTES} ints")
                continue
            if any(v):
                ki = int(k) if str(k).isdigit() else None
                nonzero.append(
                    {
                        "row": k,
                        "values": v,
                        "bits": _bit_positions(v),
                        "hypothesis": MATRIX_ROW_HYPOTHESIS.get(ki) if ki is not None else None,
                    }
                )
    elif matrix is not None:
        anomalies.append("matrixArray is not an object")
    tip_t, ring_t = p.get("tipT"), p.get("ringT")
    bypass = p.get("bypass")
    advanced = bool(p.get("advancedMode", False))
    used = bool(
        nonzero
        or advanced
        or (isinstance(bypass, int) and bypass)
        or tip_t != SPILLOVER_NOTHING
        or ring_t != SPILLOVER_NOTHING
        or (name.strip() and name.strip() != DEFAULT_PRESET_NAME)
    )
    return {
        "bank": bank,
        "number": idx,
        "global_number": (bank * specs.ML10X_PRESETS_PER_BANK + idx) if isinstance(bank, int) else None,
        "name": name,
        "advanced_mode": advanced,
        "mode_evidence": "third_party (advancedMode flag; Simple/Advanced is documented behaviour)",
        "spillover": {
            "tip": tip_t,
            "ring": ring_t,
            "tip_label": "nothing"
            if tip_t == SPILLOVER_NOTHING
            else f"code {tip_t} (connector mapping unverified in backups)",
            "ring_label": "nothing"
            if ring_t == SPILLOVER_NOTHING
            else f"code {ring_t} (connector mapping unverified in backups)",
            "evidence": "third_party",
        },
        "bypass_raw": bypass,
        "bypass_note": "per-loop bypass bitmap per third-party notes; bit layout unverified (0 in every sample preset)",
        "routing": {
            "status": ROUTING_STATUS,
            "matrix": rows,
            "nonzero_rows": nonzero,
            "row_hypothesis_note": (
                "Row labels are an observation from 3 third-party captures (rows with data = chain source "
                "connectors in the order Input Tip, Input Ring, A Tip, A Ring, ... E Ring); columns are not decoded."
            ),
        },
        "used": used,
        "unknown_keys": unknown,
        "anomalies": anomalies,
    }


def interpret(native: dict, sink: list[dict]) -> dict:
    data = native["data"]
    anomalies: list[str] = []
    cd = data.get("controllerData")
    controller: dict[str, Any] = {"fields": [], "connectors": []}
    if isinstance(cd, dict):
        _unknown_keys(cd, CONTROLLER_KEYS, "$.data.controllerData", sink)
        for key, label, ev, note in (
            ("midiChannel", "MIDI channel", "third_party", "0 = ignore MIDI (editor's Jb class); range 0-16"),
            ("deviceId", "Device ID", "third_party", "0-16; must match the MC-series ML10X message type's device id"),
            (
                "inputSplit",
                "Input Split",
                "documented",
                "Input Tip copied to Tip and Ring (firmware 1.2 release notes)",
            ),
            ("loopBypassPersistent", "Loop Bypass Persist", "documented", "firmware 1.2 release notes"),
            (
                "inputRingSwapPin",
                "inputRingSwapPin",
                "unknown",
                "present in the sample (0); no editor control found by the third party",
            ),
        ):
            if key in cd:
                controller["fields"].append(
                    {"key": key, "label": label, "value": cd[key], "evidence": ev, "note": note}
                )
        conns = cd.get("connectors")
        if isinstance(conns, list):
            if len(conns) != EXPECTED_CONNECTORS:
                anomalies.append(f"{len(conns)} connectors (an ML10X has {EXPECTED_CONNECTORS})")
            for i, c in enumerate(conns):
                if not isinstance(c, dict):
                    anomalies.append(f"connector {i} is not an object")
                    continue
                unknown = _unknown_keys(c, CONNECTOR_KEYS, f"$.data.controllerData.connectors[{i}]", sink)
                cid = c.get("id")
                controller["connectors"].append(
                    {
                        "id": cid,
                        "pos": c.get("pos"),
                        "label": CONNECTOR_LABELS.get(cid, "unknown connector")
                        if isinstance(cid, int)
                        else "unknown connector",
                        "loop": (cid + 1) if isinstance(cid, int) and 0 <= cid <= 9 else None,
                        "name": c.get("name"),
                        "short_name": c.get("shortName"),
                        "trails": c.get("trails"),
                        "input_name": c.get("inputName"),
                        "output_name": c.get("outputName"),
                        "unknown_keys": unknown,
                    }
                )
        else:
            anomalies.append("controllerData.connectors missing or not a list")
    else:
        anomalies.append("controllerData missing or not an object")
    banks: list[dict] = []
    presets_used: list[dict] = []
    names: list[dict] = []
    pd = data.get("presetData")
    if isinstance(pd, list):
        if len(pd) != specs.ML10X_BANKS:
            anomalies.append(f"{len(pd)} banks (an ML10X has {specs.ML10X_BANKS})")
        uniform = uniform_unknown_items(
            [p for b in pd if isinstance(b, dict) and isinstance(b.get("data"), list) for p in b["data"]]
        )
        for bi, b in enumerate(pd):
            if not isinstance(b, dict):
                anomalies.append(f"bank entry {bi} is not an object")
                continue
            _unknown_keys(b, BANK_KEYS, f"$.data.presetData[{bi}]", sink)
            bno = b.get("bank")
            items = b.get("data") if isinstance(b.get("data"), list) else []
            if not isinstance(b.get("data"), list):
                anomalies.append(f"bank {bno!r} has no preset list")
            if len(items) != specs.ML10X_PRESETS_PER_BANK:
                anomalies.append(f"bank {bno!r} has {len(items)} presets (expected {specs.ML10X_PRESETS_PER_BANK})")
            used = 0
            for pi, p in enumerate(items):
                ip = interpret_preset(p, bno, pi, sink, f"$.data.presetData[{bi}].data[{pi}]")
                occ = slot_occupancy(p, uniform)
                names.append(
                    {
                        "bank": bno,
                        "number": pi,
                        "name": ip.get("name", ""),
                        "used": bool(ip.get("used")),
                        "advanced": bool(ip.get("advanced_mode")),
                        "occupancy": occ["state"],
                        "occupancy_reason": occ["reason"],
                    }
                )
                if ip.get("used"):
                    used += 1
                    presets_used.append(ip)
                anomalies.extend(f"bank {bno} preset {pi}: {a}" for a in ip.get("anomalies", []))
            banks.append({"bank": bno, "preset_count": len(items), "used": used})
    else:
        anomalies.append("presetData missing or not a list")
    return {
        "controller": controller,
        "banks": banks,
        "presets": presets_used,
        "preset_names": names,
        "routing_status": ROUTING_STATUS,
        "anomalies": anomalies,
    }


def inspect(raw: str) -> dict:
    native = load_native(raw)
    sink: list[dict] = list(native["unknown_keys"])
    report: dict[str, Any] = {
        "device": "ml10x" if native["device_model"] == specs.ML10X_EXPORT_DEVICE_MODEL else None,
        "native": {k: v for k, v in native.items() if k not in ("data", "unknown_keys")},
        "interpreted": None,
        "coverage": None,
    }
    if not native["ok"]:
        report["native"]["unknown_keys"] = sink
        return report
    interp = interpret(native, sink)
    report["interpreted"] = interp
    report["native"]["unknown_keys"] = sink
    total = sum(b["preset_count"] for b in interp["banks"])
    report["coverage"] = {
        "presets_total": total,
        "presets_used": len(interp["presets"]),
        "presets_advanced": sum(1 for p in interp["presets"] if p["advanced_mode"]),
        "presets_with_matrix_data": sum(1 for p in interp["presets"] if p["routing"]["nonzero_rows"]),
        "connectors": len(interp["controller"]["connectors"]),
        "unknown_keys": len(sink),
        "anomalies": len(interp["anomalies"]),
        "presets_empty": sum(1 for n in interp["preset_names"] if n["occupancy"] == "empty"),
        "routing_decoded": False,
        "native_export_available": False,
        "proposal_available": True,
    }
    return report


def matrix_differential(raw_a: str, raw_b: str) -> dict:
    """Controlled-experiment helper: which presets' matrix rows moved between two ML10X backups.

    Reports, per changed preset, the rows whose bytes differ with their set bits before/after and the
    row hypothesis label, plus any other preset field or controller field that changed. It does not
    interpret the result; it is the raw material a future decoder needs.
    """
    out: dict[str, Any] = {"ok": False, "problems": [], "presets": [], "controller_changes": [], "summary": {}}
    natives = []
    for label, raw in (("A", raw_a), ("B", raw_b)):
        n = load_native(raw)
        if not n["ok"]:
            out["problems"].extend(f"file {label}: {p}" for p in n["problems"])
        natives.append(n)
    if out["problems"]:
        return out
    a, b = natives

    def presets_by_key(n: dict) -> dict[tuple, dict]:
        res: dict[tuple, dict] = {}
        for bank in n["data"].get("presetData") or []:
            if isinstance(bank, dict) and isinstance(bank.get("data"), list):
                for i, p in enumerate(bank["data"]):
                    if isinstance(p, dict):
                        res[(bank.get("bank"), i)] = p
        return res

    pa, pb = presets_by_key(a), presets_by_key(b)
    for key in sorted(set(pa) | set(pb), key=lambda k: (str(k[0]), k[1])):
        x, y = pa.get(key), pb.get(key)
        if x == y:
            continue
        entry: dict[str, Any] = {
            "bank": key[0],
            "number": key[1],
            "name_a": (x or {}).get("presetName"),
            "name_b": (y or {}).get("presetName"),
            "matrix_rows": [],
            "other_fields": [],
        }
        mx = (x or {}).get("matrixArray") if isinstance((x or {}).get("matrixArray"), dict) else {}
        my = (y or {}).get("matrixArray") if isinstance((y or {}).get("matrixArray"), dict) else {}
        for row in sorted(set(mx) | set(my), key=lambda r: int(r) if str(r).isdigit() else 999):
            if mx.get(row) != my.get(row):
                ri = int(row) if str(row).isdigit() else None
                entry["matrix_rows"].append(
                    {
                        "row": row,
                        "hypothesis": MATRIX_ROW_HYPOTHESIS.get(ri) if ri is not None else None,
                        "before": mx.get(row),
                        "after": my.get(row),
                        "bits_before": _bit_positions(mx.get(row) or []),
                        "bits_after": _bit_positions(my.get(row) or []),
                    }
                )
        for k in sorted(set(x or {}) | set(y or {})):
            if k == "matrixArray":
                continue
            if (x or {}).get(k) != (y or {}).get(k):
                entry["other_fields"].append({"field": k, "before": (x or {}).get(k), "after": (y or {}).get(k)})
        out["presets"].append(entry)
    ca, cb = a["data"].get("controllerData") or {}, b["data"].get("controllerData") or {}
    if isinstance(ca, dict) and isinstance(cb, dict):
        for k in sorted(set(ca) | set(cb)):
            if ca.get(k) != cb.get(k):
                out["controller_changes"].append({"field": k, "before": ca.get(k), "after": cb.get(k)})
    out["summary"] = {
        "presets_changed": len(out["presets"]),
        "matrix_rows_changed": sum(len(p["matrix_rows"]) for p in out["presets"]),
        "controller_fields_changed": len(out["controller_changes"]),
        "hash_a": a["hash"],
        "hash_b": b["hash"],
        "hint": (
            "Change exactly one loop in the official editor between two exports: the rows that move name "
            "the connectors involved; collecting many such pairs is the only evidence-based path to a decoder."
        ),
    }
    out["ok"] = True
    return out
