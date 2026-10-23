"""MC8 editor backup files: native snapshot, interpreted configuration, reviewable proposals.

Three layers, kept apart on purpose (Session 7 charter):

1. **Native snapshot** (`load_native`): the file as the editor wrote it. The parsed JSON is kept
   whole, byte-exactness and the integrity hash are checked, and every key or code Signal Loom
   does not know is *listed*, never dropped and never given a meaning.
2. **Interpreted configuration** (`interpret_*`): Signal Loom's reading of the fields whose
   meaning is established, each tagged with an evidence level. A message of an unsupported type
   is still shown, with its raw bytes and a third-party name where one exists.
3. **Proposed modification** (`propose`): edits to an allow-list of known fields, applied to a
   copy of the native data, with a structural diff against the original and a self-checked
   ``singleBank`` file. Unknown and unsupported content rides along verbatim.

Evidence levels used in the output:
``sample`` = reproduced from three real MC8 editor files; ``documented`` = official material (via
docs/research.md); ``third_party`` = MC8 Pro SDK / editor bundle enum read by a third party;
``named`` = the key name describes itself but semantics/units are unverified; ``unknown``.
"""

from __future__ import annotations

import copy
import json
from datetime import UTC, datetime
from typing import Any

from . import specs
from .backup_diff import diff_objects
from .mc8_export import MAX_BYTES, check_dump, compact_json, java_string_hash, suggested_filename

# ----------------------------------------------------------------------------- known shapes
# SAMPLE: every object in the three real exports has exactly these keys, in this order.
TOP_KEYS = ("schemaVersion", "dumpType", "deviceModel", "downloadDate", "hash", "data", "description")
DATA_KEYS_SINGLE = ("bank",)
DATA_KEYS_ALL = ("bankArray", "controller_settings")
BANK_KEYS = ("bankNumber", "bankName", "bankClearToggle", "bankMsgArray", "presetArray", "expPresetArray")
PRESET_KEYS = (
    "presetNum",
    "bankNum",
    "isExp",
    "shortName",
    "toggleName",
    "longName",
    "toToggle",
    "toBlink",
    "toMsgScroll",
    "toggleGroup",
    "msgArray",
)
MESSAGE_KEYS = ("d1", "d2", "d3", "d4", "m", "c", "t", "a", "tg", "mi")

# Message type enum of the Morningstar editor bundle as read by a third party (ragb/ml10x-access-rs,
# docs/sysex.md, 2026-05). THIRD_PARTY: used only to *name* codes found in files, never to emit them.
# Codes 0/1/2 are SAMPLE-confirmed on the MC8 and are the only ones Signal Loom writes.
EDITOR_MESSAGE_TYPE_ENUM = {
    0: "M_EMPTY",
    1: "M_PCMSG",
    2: "M_CCMSG",
    3: "M_NOTEON",
    4: "M_NOTEOFF",
    5: "M_REALTIME",
    6: "M_SYSEX",
    7: "M_CLOCKTAP",
    8: "M_PC_SCROLL_UP",
    9: "M_PC_SCROLL_DOWN",
    10: "M_BANK_UP",
    11: "M_BANK_DOWN",
    12: "M_BANK_CHANGE_MODE",
    13: "M_SET_BANK",
    14: "M_TOGGLE_PG",
    15: "M_SET_TOGGLE",
    16: "M_MIDI_THRU",
    17: "M_SELECT_EXP",
    18: "M_LOOPER_MODE",
    19: "M_STRYMON_BANK_UP",
    20: "M_STRYMON_BANK_DOWN",
    21: "M_AXEFX_TUNER",
    22: "M_TOGGLE_PRESET",
    23: "M_DELAY",
    24: "M_MIDI_CLOCK_TAP",
    25: "M_MIDI_SONG_POS",
    26: "M_CCMSG_WAVEFORM",
    27: "M_ENGAGE_PRESET",
    28: "M_KEMPER_TUNER",
    29: "M_MIDI_SONG_SELECT",
    30: "M_SET_DISPLAY",
    31: "M_CC_SEQUENCER",
    32: "M_CC_SCROLL",
    33: "M_PC_SCROLL",
    34: "M_PC_CHANNEL",
    35: "M_KEY_STROKES",
    36: "M_UTILITY",
    37: "M_AXEFX_INTEGRATION",
    38: "M_NRPN",
    39: "M_ML10X",
    40: "M_OMNIPORT_RELAY",
    41: "M_MIDI_MMC",
    42: "M_TRIGGER_MESSAGES",
    43: "M_FOCUS_MODE",
    44: "M_PRESET_RENAME",
    45: "M_ML5R",
    46: "M_DEVICE_ENGAGE_BYPASS",
}
SAMPLE_TYPE_CODES = {specs.MC8_MSG_TYPE_EMPTY, specs.MC8_MSG_TYPE_PC, specs.MC8_MSG_TYPE_CC}
# Action codes 0-5, 9, 10 are DOCUMENTED (MC8 CC implementation chart); 6-8 inferred from the Pro SDK.
DOCUMENTED_ACTION_CODES = {0, 1, 2, 3, 4, 5, 9, 10}

# general_configurations keys (SAMPLE: observed in the all-banks export). ``documented`` marks the
# settings Signal Loom already relies on from official material; the rest are ``named``.
GENERAL_CONFIG_EVIDENCE = {
    "midiChannel": ("documented", "The MC8's own MIDI channel (manual)."),
    "midiThru": ("documented", "MIDI In -> outputs thru (manual)."),
    "crossMidiThru": ("documented", "USB <-> DIN/Omniport cross thru (help centre article)."),
    "longPressTime": ("documented", "Long press threshold setting (manual); unit of the stored value unverified."),
    "switchSensitivity": ("documented", "Switch sensitivity setting (manual); scale of the stored value unverified."),
    "dualLock": ("named", None),
    "midiClockPersist": ("named", None),
    "lcdAlign": ("named", None),
    "ignoreMidiClock": ("named", None),
    "savePresetToggle": ("named", None),
    "bankChangeDelayTime": ("named", None),
    "bankChangeDisplayTime": ("named", None),
    "loadLastBankOnStartup": ("named", None),
    "numMidiCable": ("named", None),
    "midiSendDelay": ("named", None),
    "midiClockOutputPorts": ("named", None),
}
CONTROLLER_SECTIONS_KNOWN = (
    "omniports",
    "resistor_ladder_aux",
    "controller_settings",
    "waveform_engines",
    "sequencer_engines",
    "scroll_counters",
    "midi_channels",
    "bank_arrangement",
    "midi_events",
)

_ACTION_NAMES = {v: k for k, v in specs.MC8_ACTIONS.items()}
_TG_NAMES = {v: k for k, v in specs.MC8_TOGGLE_POSITIONS.items()}


def position_label(preset_num: Any, is_exp: bool) -> str:
    if is_exp:
        return f"Exp {preset_num + 1}" if isinstance(preset_num, int) else "Exp ?"
    if isinstance(preset_num, int) and 0 <= preset_num < len(specs.MC8_POSITIONS):
        return specs.MC8_POSITIONS[preset_num]
    return "?"


def _unknown_keys(obj: dict, known: tuple[str, ...], path: str, sink: list[dict]) -> list[str]:
    extra = [k for k in obj if k not in known]
    for k in extra:
        sink.append({"path": path, "key": k, "value_preview": json.dumps(obj[k], ensure_ascii=False)[:120]})
    return extra


# ----------------------------------------------------------------------------- native snapshot


def load_native(raw: str) -> dict:
    """Parse an MC8 editor backup without losing anything. Never raises.

    ``problems`` stop interpretation (not JSON, not an object, no data, not an MC8 file).
    ``warnings`` are discrepancies the file can live with (schema version, hash, slot counts).
    ``data`` is the parsed ``data`` object, kept whole for the proposal layer.
    """
    out: dict[str, Any] = {
        "ok": False,
        "problems": [],
        "warnings": [],
        "device_model": None,
        "dump_type": None,
        "schema_version": None,
        "download_date": None,
        "description": None,
        "hash": None,
        "hash_matches": None,
        "byte_exact": None,
        "bank_count": 0,
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
    out["description"] = doc.get("description")
    out["hash"] = doc.get("hash") if isinstance(doc.get("hash"), int) else None
    _unknown_keys(doc, TOP_KEYS, "$", out["unknown_keys"])
    if doc.get("deviceModel") != specs.MC8_EXPORT_DEVICE_MODEL:
        out["problems"].append(
            f"deviceModel {doc.get('deviceModel')!r} is not the original MC8 ({specs.MC8_EXPORT_DEVICE_MODEL}); "
            "the file is kept as an opaque snapshot and not interpreted as MC8 data"
        )
    if doc.get("schemaVersion") != specs.MC8_EXPORT_SCHEMA_VERSION:
        out["warnings"].append(
            f"schemaVersion {doc.get('schemaVersion')!r} differs from the fixture-validated {specs.MC8_EXPORT_SCHEMA_VERSION}; "
            "interpreted with schema 1 assumptions, so unknown fields may be more than usual"
        )
    data = doc.get("data")
    if not isinstance(data, dict):
        out["problems"].append("missing data object")
        return out
    out["data"] = data
    if out["hash"] is not None:
        out["hash_matches"] = java_string_hash(compact_json(data)) == out["hash"]
        if not out["hash_matches"]:
            out["warnings"].append(
                "hash does not match the data section (the file was edited by hand or written by another serializer)"
            )
    else:
        out["warnings"].append("no integer hash field; integrity cannot be checked")
    out["byte_exact"] = compact_json(doc) == raw.strip()
    if not out["byte_exact"]:
        out["warnings"].append("not byte-identical to the editor's compact serialization (re-formatted or edited)")
    dump_type = doc.get("dumpType")
    if dump_type == "singleBank":
        _unknown_keys(data, DATA_KEYS_SINGLE, "$.data", out["unknown_keys"])
        out["bank_count"] = 1 if isinstance(data.get("bank"), dict) else 0
        if not out["bank_count"]:
            out["problems"].append("singleBank file without a bank object")
    elif dump_type == "allBanks":
        _unknown_keys(data, DATA_KEYS_ALL, "$.data", out["unknown_keys"])
        banks = data.get("bankArray")
        out["bank_count"] = len([b for b in banks if isinstance(b, dict)]) if isinstance(banks, list) else 0
        if not isinstance(banks, list):
            out["problems"].append("allBanks file without a bankArray")
        elif out["bank_count"] != specs.MC8_BANKS:
            out["warnings"].append(f"{out['bank_count']} banks (an MC8 all-banks file has {specs.MC8_BANKS})")
    else:
        out["problems"].append(f"unknown dumpType {dump_type!r}")
    out["ok"] = not out["problems"]
    return out


def native_banks(native: dict) -> list[dict]:
    data = native.get("data") or {}
    if native.get("dump_type") == "singleBank" and isinstance(data.get("bank"), dict):
        return [data["bank"]]
    if native.get("dump_type") == "allBanks" and isinstance(data.get("bankArray"), list):
        return [b for b in data["bankArray"] if isinstance(b, dict)]
    return []


# ----------------------------------------------------------------------------- interpretation


def interpret_message(m: Any, slot: int, context: str, sink: list[dict], path: str) -> dict:
    """One message slot. ``context`` is "switch", "exp" or "bank" (for the empty-slot defaults)."""
    if not isinstance(m, dict):
        return {
            "slot": slot,
            "status": "unknown",
            "raw": m,
            "summary": "slot is not an object",
            "anomalies": ["message slot is not an object"],
            "unknown_keys": [],
        }
    anomalies: list[str] = []
    unknown = _unknown_keys(m, MESSAGE_KEYS, path, sink)
    t = m.get("t")
    c = m.get("c")
    a = m.get("a")
    tg = m.get("tg")
    d1, d2, d3, d4 = (m.get(k) for k in ("d1", "d2", "d3", "d4"))
    mi = m.get("mi")
    if m.get("m") != slot:
        anomalies.append(f"slot index field m={m.get('m')!r} does not match its position {slot}")
    if t == specs.MC8_MSG_TYPE_EMPTY:
        status, type_name, evidence = "empty", "Empty", "sample"
    elif t in SAMPLE_TYPE_CODES:
        status, type_name, evidence = "known", specs.MC8_MSG_TYPE_NAMES_THIRD_PARTY[t], "sample"
    elif isinstance(t, int) and t in EDITOR_MESSAGE_TYPE_ENUM:
        status = "third_party"
        type_name = specs.MC8_MSG_TYPE_NAMES_THIRD_PARTY.get(t, EDITOR_MESSAGE_TYPE_ENUM[t])
        evidence = "third_party"
    else:
        status, type_name, evidence = "unknown", f"type {t!r}", "unknown"
    out: dict[str, Any] = {
        "slot": slot,
        "status": status,
        "type_code": t,
        "type_name": type_name,
        "type_enum": EDITOR_MESSAGE_TYPE_ENUM.get(t) if isinstance(t, int) else None,
        "type_evidence": evidence,
        "channel": c,
        "action_code": a,
        "action": _ACTION_NAMES.get(a),
        "action_label": specs.MC8_ACTION_LABELS.get(_ACTION_NAMES.get(a, ""), None),
        "action_evidence": "documented"
        if a in DOCUMENTED_ACTION_CODES
        else ("third_party" if a in _ACTION_NAMES else "unknown"),
        "toggle_position_code": tg,
        "toggle_position": _TG_NAMES.get(tg),
        "data": [d1, d2, d3, d4],
        "mi": mi,
        "raw": m,
        "unknown_keys": unknown,
    }
    if status == "empty":
        if any(isinstance(x, int) and x for x in (d1, d2, d3, d4)) or (isinstance(a, int) and a):
            anomalies.append("empty slot carries data bytes or an action (kept verbatim)")
        out["summary"] = "—"
    else:
        if not (isinstance(c, int) and 1 <= c <= 16):
            anomalies.append(f"channel {c!r} outside 1-16")
        if a not in _ACTION_NAMES:
            anomalies.append(f"action code {a!r} is not a known MC8 action")
        if tg not in _TG_NAMES:
            anomalies.append(f"toggle position code {tg!r} is not 0/1/2")
        if status == "known":
            if t == specs.MC8_MSG_TYPE_PC:
                out["summary"] = f"PC {d1} on ch {c}"
            else:
                out["summary"] = f"CC#{d1} = {d2} on ch {c}"
            for k, v in (("d1", d1), ("d2", d2)):
                if not (isinstance(v, int) and 0 <= v <= 127):
                    anomalies.append(f"{k}={v!r} outside 0-127")
            if (isinstance(d3, int) and d3) or (isinstance(d4, int) and d4):
                anomalies.append("d3/d4 are non-zero on a PC/CC message (always 0 in the fixtures; purpose unknown)")
        else:
            out["summary"] = f"{type_name} (d1={d1} d2={d2} d3={d3} d4={d4}) on ch {c}"
            anomalies.append(
                "message type is not PC/CC: shown by its third-party name, bytes kept verbatim, not modelled"
                if status == "third_party"
                else "message type code is unknown to Signal Loom and to the third-party enum; bytes kept verbatim"
            )
    if isinstance(mi, str) and mi != "":
        anomalies.append('mi is non-empty (always "" in the fixtures; purpose unverified)')
    elif not isinstance(mi, str):
        anomalies.append(f"mi={mi!r} is not a string")
    out["anomalies"] = anomalies
    if status == "empty" and not anomalies and not unknown:
        # A clean empty slot carries no information; keep the report small (an all-banks file has 12,480 slots).
        return {"slot": slot, "status": "empty", "summary": "—", "anomalies": [], "unknown_keys": []}
    return out


def interpret_preset(p: Any, index: int, bank_index: int, is_exp: bool, sink: list[dict], path: str) -> dict:
    if not isinstance(p, dict):
        return {
            "index": index,
            "position": position_label(index, is_exp),
            "status": "unknown",
            "raw": p,
            "anomalies": ["preset is not an object"],
        }
    anomalies: list[str] = []
    unknown = _unknown_keys(p, PRESET_KEYS, path, sink)
    num = p.get("presetNum")
    if num != index:
        anomalies.append(f"presetNum {num!r} does not match its array position {index}")
    if p.get("bankNum") != bank_index:
        anomalies.append(f"bankNum {p.get('bankNum')!r} does not match the bank index {bank_index}")
    if bool(p.get("isExp", False)) != is_exp:
        anomalies.append(f"isExp={p.get('isExp')!r} in the {'expression' if is_exp else 'switch'} preset array")
    msgs_raw = p.get("msgArray")
    msgs: list[dict] = []
    if isinstance(msgs_raw, list):
        if len(msgs_raw) != specs.MC8_MESSAGES_PER_PRESET:
            anomalies.append(f"{len(msgs_raw)} message slots (the MC8 holds {specs.MC8_MESSAGES_PER_PRESET})")
        for i, m in enumerate(msgs_raw):
            msgs.append(interpret_message(m, i, "exp" if is_exp else "switch", sink, f"{path}.msgArray[{i}]"))
    else:
        anomalies.append("msgArray missing or not a list")
    short = p.get("shortName")
    toggle = p.get("toggleName")
    long_ = p.get("longName")
    for k, v, cap in (
        ("shortName", short, specs.MC8_SHORT_NAME_MAX),
        ("toggleName", toggle, specs.MC8_TOGGLE_NAME_MAX),
        ("longName", long_, specs.MC8_LONG_NAME_MAX),
    ):
        if v is not None and not isinstance(v, str):
            anomalies.append(f"{k} is not a string")
        elif isinstance(v, str) and len(v) > cap:
            anomalies.append(
                f"{k} is {len(v)} characters; the longest seen in real exports is {cap} (limit unverified)"
            )
    counts = {"empty": 0, "known": 0, "third_party": 0, "unknown": 0}
    for m in msgs:
        counts[m["status"]] = counts.get(m["status"], 0) + 1
    active = [m for m in msgs if m["status"] != "empty"]
    used = bool(
        (isinstance(short, str) and short) or active or p.get("toToggle") or p.get("toBlink") or p.get("toMsgScroll")
    )
    return {
        "index": index,
        "position": position_label(index, is_exp),
        "is_exp": is_exp,
        "short_name": short if isinstance(short, str) else "",
        "toggle_name": toggle if isinstance(toggle, str) else "",
        "long_name": long_ if isinstance(long_, str) else "",
        "toggle_mode": bool(p.get("toToggle", False)),
        "blink": bool(p.get("toBlink", False)),
        "message_scroll": bool(p.get("toMsgScroll", False)),
        "toggle_group": p.get("toggleGroup"),
        "used": used,
        "active_messages": len(active),
        "message_counts": counts,
        "messages": msgs,
        "unknown_keys": unknown,
        "anomalies": anomalies,
    }


def interpret_bank(b: Any, bank_index: int, sink: list[dict], path: str) -> dict:
    if not isinstance(b, dict):
        return {
            "index": bank_index,
            "number": bank_index + 1,
            "status": "unknown",
            "raw": b,
            "anomalies": ["bank is not an object"],
        }
    anomalies: list[str] = []
    unknown = _unknown_keys(b, BANK_KEYS, path, sink)
    if b.get("bankNumber") != bank_index:
        anomalies.append(f"bankNumber {b.get('bankNumber')!r} does not match its array position {bank_index}")
    name = b.get("bankName")
    if isinstance(name, str) and len(name) > specs.MC8_BANK_NAME_MAX:
        anomalies.append(
            f"bankName is {len(name)} characters; longest seen in real exports is {specs.MC8_BANK_NAME_MAX}"
        )
    bank_msgs: list[dict] = []
    bm = b.get("bankMsgArray")
    if isinstance(bm, list):
        if len(bm) != specs.MC8_BANK_MESSAGES:
            anomalies.append(f"{len(bm)} bank message slots (expected {specs.MC8_BANK_MESSAGES})")
        for i, m in enumerate(bm):
            bank_msgs.append(interpret_message(m, i, "bank", sink, f"{path}.bankMsgArray[{i}]"))
    else:
        anomalies.append("bankMsgArray missing or not a list")
    presets: list[dict] = []
    pa = b.get("presetArray")
    if isinstance(pa, list):
        if len(pa) != specs.MC8_SWITCH_PRESETS_PER_BANK:
            anomalies.append(f"{len(pa)} switch presets (expected {specs.MC8_SWITCH_PRESETS_PER_BANK})")
        for i, p in enumerate(pa):
            presets.append(interpret_preset(p, i, bank_index, False, sink, f"{path}.presetArray[{i}]"))
    else:
        anomalies.append("presetArray missing or not a list")
    exp: list[dict] = []
    ea = b.get("expPresetArray")
    if isinstance(ea, list):
        if len(ea) != specs.MC8_EXP_PRESETS_PER_BANK:
            anomalies.append(f"{len(ea)} expression presets (expected {specs.MC8_EXP_PRESETS_PER_BANK})")
        for i, p in enumerate(ea):
            exp.append(interpret_preset(p, i, bank_index, True, sink, f"{path}.expPresetArray[{i}]"))
    else:
        anomalies.append("expPresetArray missing or not a list")
    counts = {"empty": 0, "known": 0, "third_party": 0, "unknown": 0}
    for group in (bank_msgs, *[p.get("messages", []) for p in presets + exp]):
        for m in group:
            counts[m["status"]] = counts.get(m["status"], 0) + 1
    return {
        "index": bank_index,
        "number": bank_index + 1,
        "name": name if isinstance(name, str) else "",
        "clear_toggle": bool(b.get("bankClearToggle", False)),
        "used": bool(
            (isinstance(name, str) and name)
            or any(p.get("used") for p in presets + exp)
            or any(m["status"] != "empty" for m in bank_msgs)
        ),
        "bank_messages": bank_msgs,
        "bank_message_note": (
            "16 bank messages (On Enter / On Exit, documented). Which slot fires on enter or exit is not "
            "established from the fixtures (all slots empty there); shown raw."
        ),
        "presets": presets,
        "exp_presets": exp,
        "presets_used": sum(1 for p in presets if p.get("used")),
        "exp_used": sum(1 for p in exp if p.get("used")),
        "message_counts": counts,
        "unknown_keys": unknown,
        "anomalies": anomalies,
    }


def interpret_controller_settings(cs: Any, sink: list[dict]) -> dict | None:
    """The ``controller_settings`` block of an allBanks file: known names, raw everything."""
    if cs is None:
        return None
    out: dict[str, Any] = {
        "type": None,
        "general": [],
        "midi_channels": [],
        "bank_arrangement": None,
        "sections": [],
        "anomalies": [],
    }
    if not isinstance(cs, dict) or not isinstance(cs.get("data"), dict):
        out["anomalies"].append("controller_settings is not {type, data}")
        out["raw"] = cs
        return out
    out["type"] = cs.get("type")
    data = cs["data"]
    _unknown_keys(data, CONTROLLER_SECTIONS_KNOWN, "$.data.controller_settings.data", sink)
    for key, sec in data.items():
        entry: dict[str, Any] = {
            "key": key,
            "type": sec.get("type") if isinstance(sec, dict) else None,
            "interpreted": False,
        }
        body = sec.get("data") if isinstance(sec, dict) else None
        if isinstance(body, list):
            entry["count"] = len(body)
        if key == "controller_settings" and isinstance(body, dict):
            entry["interpreted"] = True
            for k, v in body.items():
                ev, note = GENERAL_CONFIG_EVIDENCE.get(k, ("unknown", "key not seen in the fixture"))
                out["general"].append({"key": k, "value": v, "evidence": ev, "note": note})
        elif key == "midi_channels" and isinstance(body, list):
            entry["interpreted"] = True
            for item in body:
                d = item.get("data") if isinstance(item, dict) else None
                if isinstance(d, dict):
                    out["midi_channels"].append(
                        {
                            "channel": d.get("channel"),
                            "name": d.get("name"),
                            "evidence": "documented",  # MIDI channel names: firmware 3.6.1+ (release notes)
                            "raw": d,
                        }
                    )
        elif key == "bank_arrangement" and isinstance(body, list):
            entry["interpreted"] = True
            out["bank_arrangement"] = {
                "is_active": sec.get("isActive"),
                "num_banks_active": sec.get("numBanksActive"),
                "banks": [
                    {"bank": it.get("data", {}).get("bankNum"), "name": it.get("data", {}).get("bankName")}
                    for it in body
                    if isinstance(it, dict) and isinstance(it.get("data"), dict)
                ],
                "evidence": "named",
            }
        entry["raw"] = sec
        out["sections"].append(entry)
    return out


def inspect(raw: str) -> dict:
    """Native snapshot + interpreted configuration + coverage summary for an MC8 backup."""
    native = load_native(raw)
    sink: list[dict] = list(native["unknown_keys"])
    report: dict[str, Any] = {
        "device": "mc8" if native["device_model"] == specs.MC8_EXPORT_DEVICE_MODEL else None,
        "native": {k: v for k, v in native.items() if k not in ("data", "unknown_keys")},
        "interpreted": None,
        "coverage": None,
    }
    if not native["ok"]:
        report["native"]["unknown_keys"] = sink
        return report
    banks = [
        interpret_bank(b, i, sink, f"$.data.{'bank' if native['dump_type'] == 'singleBank' else f'bankArray[{i}]'}")
        for i, b in enumerate(native_banks(native))
    ]
    if native["dump_type"] == "singleBank":
        # A singleBank file carries the bank's own number; the array position is meaningless there.
        b = native["data"]["bank"]
        if isinstance(b.get("bankNumber"), int):
            banks[0]["index"] = b["bankNumber"]
            banks[0]["number"] = b["bankNumber"] + 1
            banks[0]["anomalies"] = [a for a in banks[0]["anomalies"] if not a.startswith("bankNumber")]
            for p in banks[0]["presets"] + banks[0]["exp_presets"]:
                p["anomalies"] = [a for a in p["anomalies"] if not a.startswith("bankNum ")]
    controller = (
        interpret_controller_settings(native["data"].get("controller_settings"), sink)
        if native["dump_type"] == "allBanks"
        else None
    )
    counts = {"empty": 0, "known": 0, "third_party": 0, "unknown": 0}
    anomalies = 0
    for b in banks:
        for k, v in b.get("message_counts", {}).items():
            counts[k] = counts.get(k, 0) + v
        anomalies += len(b.get("anomalies", []))
        for p in b.get("presets", []) + b.get("exp_presets", []):
            anomalies += len(p.get("anomalies", []))
            anomalies += sum(len(m.get("anomalies", [])) for m in p.get("messages", []))
        anomalies += sum(len(m.get("anomalies", [])) for m in b.get("bank_messages", []))
    report["interpreted"] = {
        "banks": banks,
        "controller_settings": controller,
        "legend": {
            "known": "PC/CC messages: codes confirmed on real MC8 exports; Signal Loom models and can write them.",
            "third_party": "Message type named by the editor's enum as read by a third party; bytes preserved, never modelled.",
            "unknown": "Code or key not in any source Signal Loom has; preserved verbatim.",
        },
    }
    report["native"]["unknown_keys"] = sink
    report["coverage"] = {
        "messages": counts,
        "banks": len(banks),
        "banks_used": sum(1 for b in banks if b.get("used")),
        "presets_used": sum(b.get("presets_used", 0) for b in banks),
        "exp_presets_used": sum(b.get("exp_used", 0) for b in banks),
        "unknown_keys": len(sink),
        "anomalies": anomalies,
        "controller_settings_present": controller is not None,
        "lossless_reserialization": native["byte_exact"] and native["hash_matches"] is True,
    }
    return report


# ----------------------------------------------------------------------------- compare


def _message_tuple(m: dict) -> tuple:
    return (m.get("t"), m.get("c"), m.get("d1"), m.get("d2"), m.get("a"), m.get("tg"))


def _active(msgs: Any) -> list[dict]:
    return [m for m in msgs if isinstance(m, dict) and m.get("t")] if isinstance(msgs, list) else []


def compare_bank_to_plan(native_bank: dict, bank_plan: dict) -> dict:
    """Controller configuration (native bank object) vs Signal Loom's modeled intent (compiled plan).

    The plan is rendered through the validated ``singleBank`` writer, so both sides are compared in
    the editor's own vocabulary. Messages the rig cannot express (non PC/CC) are reported as
    "only on the controller", never as "to be removed".
    """
    from .mc8_export import build_single_bank_dump  # local import: keeps module import order simple

    modeled_dump, diags = build_single_bank_dump(bank_plan)
    out: dict[str, Any] = {
        "ok": bool(modeled_dump),
        "plan_diagnostics": [d.model_dump(mode="json") for d in diags],
        "bank": {},
        "positions": [],
        "summary": {},
    }
    if not modeled_dump:
        return out
    mb = modeled_dump["data"]["bank"]
    native_name = native_bank.get("bankName") if isinstance(native_bank.get("bankName"), str) else ""
    out["bank"] = {
        "native_name": native_name,
        "modeled_name": mb["bankName"],
        "name_same": native_name == mb["bankName"],
        "native_clear_toggle": bool(native_bank.get("bankClearToggle", False)),
        "native_bank_messages": len(_active(native_bank.get("bankMsgArray"))),
        "note": "Signal Loom does not model bank messages, expression presets, blink or message-scroll flags; they are listed as controller-only.",
    }
    native_presets = native_bank.get("presetArray") if isinstance(native_bank.get("presetArray"), list) else []
    statuses = {"same": 0, "differs": 0, "only_native": 0, "only_modeled": 0, "both_empty": 0}
    for i in range(specs.MC8_SWITCH_PRESETS_PER_BANK):
        np_ = native_presets[i] if i < len(native_presets) and isinstance(native_presets[i], dict) else {}
        mp = mb["presetArray"][i]
        n_msgs = _active(np_.get("msgArray"))
        m_msgs = _active(mp["msgArray"])
        n_supported = [m for m in n_msgs if m.get("t") in (specs.MC8_MSG_TYPE_PC, specs.MC8_MSG_TYPE_CC)]
        n_unsupported = [m for m in n_msgs if m.get("t") not in (specs.MC8_MSG_TYPE_PC, specs.MC8_MSG_TYPE_CC)]
        n_used = bool(np_.get("shortName") or n_msgs or np_.get("toToggle"))
        m_used = bool(mp["shortName"] or m_msgs)
        n_tuples = [_message_tuple(m) for m in n_supported]
        m_tuples = [_message_tuple(m) for m in m_msgs]
        differences: list[str] = []
        if n_used and m_used:
            if (np_.get("shortName") or "") != mp["shortName"]:
                differences.append("short_name")
            if (np_.get("longName") or "") != mp["longName"]:
                differences.append("long_name")
            if (np_.get("toggleName") or "") != mp["toggleName"]:
                differences.append("toggle_name")
            if bool(np_.get("toToggle", False)) != mp["toToggle"]:
                differences.append("toggle_mode")
            if n_tuples != m_tuples:
                differences.append("messages_order" if sorted(n_tuples) == sorted(m_tuples) else "messages")
            if n_unsupported:
                differences.append("unsupported_native_messages")
            status = "differs" if differences else "same"
        elif n_used:
            status = "only_native"
        elif m_used:
            status = "only_modeled"
        else:
            status = "both_empty"
        statuses[status] += 1
        out["positions"].append(
            {
                "position": specs.MC8_POSITIONS[i],
                "status": status,
                "differences": differences,
                "native": {
                    "short_name": np_.get("shortName"),
                    "long_name": np_.get("longName"),
                    "toggle_name": np_.get("toggleName"),
                    "toggle_mode": bool(np_.get("toToggle", False)),
                    "messages": [
                        {
                            "slot": m.get("m"),
                            "summary": interpret_message(
                                m, m.get("m", 0) if isinstance(m.get("m"), int) else 0, "switch", [], ""
                            )["summary"],
                            "tuple": list(_message_tuple(m)),
                            "supported": m.get("t") in (specs.MC8_MSG_TYPE_PC, specs.MC8_MSG_TYPE_CC),
                        }
                        for m in n_msgs
                    ],
                },
                "modeled": {
                    "short_name": mp["shortName"],
                    "long_name": mp["longName"],
                    "toggle_name": mp["toggleName"],
                    "toggle_mode": mp["toToggle"],
                    "scene_name": next(
                        (s.get("scene_name") for s in bank_plan["switches"] if s["position"] == specs.MC8_POSITIONS[i]),
                        None,
                    ),
                    "messages": [
                        {
                            "slot": m["m"],
                            "summary": interpret_message(m, m["m"], "switch", [], "")["summary"],
                            "tuple": list(_message_tuple(m)),
                            "supported": True,
                        }
                        for m in m_msgs
                    ],
                },
            }
        )
    out["summary"] = {
        **statuses,
        "modeled_bank_number": bank_plan["number"],
        "native_bank_number": (native_bank.get("bankNumber") + 1)
        if isinstance(native_bank.get("bankNumber"), int)
        else None,
        "identical": statuses["differs"] == 0
        and statuses["only_native"] == 0
        and statuses["only_modeled"] == 0
        and out["bank"]["name_same"],
    }
    return out


# ----------------------------------------------------------------------------- propose

# Leaf fields a proposal may change, by container, with the validator for the new value.
_EDITABLE_BANK = {"bankName": "name", "bankClearToggle": "bool"}
_EDITABLE_PRESET = {
    "shortName": "name",
    "toggleName": "name",
    "longName": "name",
    "toToggle": "bool",
    "toBlink": "bool",
    "toMsgScroll": "bool",
    "toggleGroup": "int7",
}
_EDITABLE_MESSAGE = {"d1": "int7", "d2": "int7", "c": "channel", "t": "type", "a": "action", "tg": "tg"}
_NAME_CAPS = {
    "bankName": specs.MC8_BANK_NAME_MAX,
    "shortName": specs.MC8_SHORT_NAME_MAX,
    "toggleName": specs.MC8_TOGGLE_NAME_MAX,
    "longName": specs.MC8_LONG_NAME_MAX,
}


def _validate_value(kind: str, value: Any, key: str, warnings: list[str], where: str) -> str | None:
    if kind == "name":
        if not isinstance(value, str):
            return f"{where}: {key} must be a string"
        if any(ord(ch) > 126 or ord(ch) < 32 for ch in value):
            return f"{where}: {key} must be printable ASCII (editor name fields; non-ASCII behaviour unverified)"
        if len(value) > _NAME_CAPS[key]:
            warnings.append(
                f"{where}: {key} is {len(value)} characters; the longest seen in real exports is {_NAME_CAPS[key]} (limit unverified, not truncated)"
            )
        return None
    if kind == "bool":
        return None if isinstance(value, bool) else f"{where}: {key} must be true/false"
    if kind == "int7":
        return (
            None
            if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 127
            else f"{where}: {key} must be 0-127"
        )
    if kind == "channel":
        return (
            None
            if isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 16
            else f"{where}: {key} must be 1-16"
        )
    if kind == "type":
        return (
            None
            if value in SAMPLE_TYPE_CODES
            else f"{where}: only PC (1), CC (2) or empty (0) may be written; other types are preserved, never authored"
        )
    if kind == "action":
        return None if value in _ACTION_NAMES else f"{where}: action code {value!r} is not an MC8 action (0-10)"
    if kind == "tg":
        return None if value in _TG_NAMES else f"{where}: toggle position must be 0 (Pos 1), 1 (Pos 2) or 2 (Both)"
    return f"{where}: no validator for {key}"


def _apply_edit(bank: dict, edit: Any, problems: list[str], warnings: list[str], n: int) -> None:
    where = f"edit {n}"
    if not isinstance(edit, dict) or not isinstance(edit.get("path"), list) or "value" not in edit:
        problems.append(f"{where}: must be {{path: [...], value: ...}}")
        return
    path = edit["path"]
    value = edit["value"]
    if len(path) == 1 and path[0] in _EDITABLE_BANK:
        err = _validate_value(_EDITABLE_BANK[path[0]], value, path[0], warnings, where)
        if err:
            problems.append(err)
            return
        bank[path[0]] = value
        return
    if (
        len(path) == 3
        and path[0] in ("presetArray", "expPresetArray")
        and isinstance(path[1], int)
        and path[2] in _EDITABLE_PRESET
    ):
        arr = bank.get(path[0])
        if not isinstance(arr, list) or not 0 <= path[1] < len(arr) or not isinstance(arr[path[1]], dict):
            problems.append(f"{where}: no preset at {path[0]}[{path[1]}]")
            return
        err = _validate_value(_EDITABLE_PRESET[path[2]], value, path[2], warnings, where)
        if err:
            problems.append(err)
            return
        arr[path[1]][path[2]] = value
        return
    is_bank_msg = (
        len(path) == 3 and path[0] == "bankMsgArray" and isinstance(path[1], int) and path[2] in _EDITABLE_MESSAGE
    )
    is_preset_msg = (
        len(path) == 5
        and path[0] in ("presetArray", "expPresetArray")
        and isinstance(path[1], int)
        and path[2] == "msgArray"
        and isinstance(path[3], int)
        and path[4] in _EDITABLE_MESSAGE
    )
    if is_bank_msg or is_preset_msg:
        if is_bank_msg:
            arr = bank.get("bankMsgArray")
            idx, key = path[1], path[2]
        else:
            presets = bank.get(path[0])
            if (
                not isinstance(presets, list)
                or not 0 <= path[1] < len(presets)
                or not isinstance(presets[path[1]], dict)
            ):
                problems.append(f"{where}: no preset at {path[0]}[{path[1]}]")
                return
            arr = presets[path[1]].get("msgArray")
            idx, key = path[3], path[4]
        if not isinstance(arr, list) or not 0 <= idx < len(arr) or not isinstance(arr[idx], dict):
            problems.append(f"{where}: no message slot {idx}")
            return
        msg = arr[idx]
        if msg.get("t") not in SAMPLE_TYPE_CODES:
            problems.append(
                f"{where}: slot {idx} holds a {specs.MC8_MSG_TYPE_NAMES_THIRD_PARTY.get(msg.get('t')) or EDITOR_MESSAGE_TYPE_ENUM.get(msg.get('t'), 'unknown-type')} message (type {msg.get('t')!r}); "
                "Signal Loom does not edit message types it cannot model. Clear it in the official editor instead."
            )
            return
        err = _validate_value(_EDITABLE_MESSAGE[key], value, key, warnings, where)
        if err:
            problems.append(err)
            return
        msg[key] = value
        return
    problems.append(
        f"{where}: path {path!r} is not editable (allowed: bankName, bankClearToggle, preset names/flags/toggleGroup, "
        "message d1/d2/c/t/a/tg; d3/d4/mi/m and unknown keys are preserved as-is)"
    )


def propose(raw: str, edits: list | None = None, bank_index: int | None = None, *, now: datetime | None = None) -> dict:
    """Apply allow-listed edits to one bank of a native MC8 backup and build a reviewable singleBank file.

    - Refused outright (inspection stays available) when the input's integrity hash is missing or does
      not match its data section, or when its schemaVersion is not the fixture-validated one: Signal
      Loom never re-hashes an unverifiable file and never rewrites a foreign schema version as 1.
    - Without edits on a compact ``singleBank`` input the output is byte-identical to the input;
      ``preserved.byte_identical_to_input`` is computed by comparing the output text with the input.
    - An ``allBanks`` input needs ``bank_index`` (0-29); that bank object is lifted verbatim into a
      ``singleBank`` file (the shape the validated writer produces) with a fresh hash and date.
    - Every other key, message of an unsupported type and unknown field is carried over untouched.
    """
    native = load_native(raw)
    out: dict[str, Any] = {
        "ok": False,
        "problems": list(native["problems"]),
        "warnings": list(native["warnings"]),
        "dump": None,
        "text": None,
        "filename": None,
        "diff": {"changes": [], "total": 0},
        "self_check": None,
        "preserved": None,
        "edits_applied": 0,
    }
    if out["problems"]:
        return out
    # Modified native export only from an input whose integrity is verified and whose schema is the one
    # the writer was validated against. These are warnings for inspection but blockers for a proposal.
    if native["hash"] is None:
        out["problems"].append(
            "integrity hash missing: the file cannot be verified, so no native proposal is produced (inspection still works)"
        )
    elif native["hash_matches"] is False:
        out["problems"].append(
            "integrity hash mismatch: the data section does not match the file's hash (edited by hand or written by "
            "another serializer); Signal Loom does not re-hash an unverifiable input into a native proposal "
            "(inspection still works)"
        )
    if native["schema_version"] != specs.MC8_EXPORT_SCHEMA_VERSION:
        out["problems"].append(
            f"schemaVersion {native['schema_version']!r} is not the fixture-validated "
            f"{specs.MC8_EXPORT_SCHEMA_VERSION}; Signal Loom will not rewrite it as schema "
            f"{specs.MC8_EXPORT_SCHEMA_VERSION} (inspection still works)"
        )
    if out["problems"]:
        out["warnings"] = [
            w for w in out["warnings"] if not w.startswith(("hash does not match", "no integer hash", "schemaVersion"))
        ]
        return out
    data = copy.deepcopy(native["data"])
    if native["dump_type"] == "allBanks":
        banks = data.get("bankArray") or []
        if bank_index is None or not isinstance(bank_index, int) or not 0 <= bank_index < len(banks):
            out["problems"].append(f"an allBanks file needs a bank_index between 0 and {len(banks) - 1}")
            return out
        bank = banks[bank_index]
        original_bank = native["data"]["bankArray"][bank_index]
    else:
        bank = data["bank"]
        original_bank = native["data"]["bank"]
    if not isinstance(bank, dict):
        out["problems"].append("bank is not an object")
        return out
    edits = edits or []
    for n, edit in enumerate(edits, start=1):
        _apply_edit(bank, edit, out["problems"], out["warnings"], n)
    if out["problems"]:
        return out
    out["edits_applied"] = len(edits)
    changes = diff_objects(original_bank, bank)
    out["diff"] = {"changes": changes, "total": len(changes)}
    unchanged_single = native["dump_type"] == "singleBank" and not changes
    when = now or datetime.now(UTC)
    stamp = when.strftime("%Y-%m-%dT%H:%M:%S.") + f"{when.microsecond // 1000:03d}Z"
    # Start from the original top-level object so unknown top-level keys ride along; a singleBank file
    # without changes stays byte-identical, anything else gets the singleBank shape, a fresh hash and date.
    dump = json.loads(raw)
    if not unchanged_single:
        new_data = {"bank": bank}
        dump["dumpType"] = "singleBank"  # schemaVersion is left as read: only the validated version reaches here
        dump["deviceModel"] = specs.MC8_EXPORT_DEVICE_MODEL
        dump["downloadDate"] = stamp
        dump["hash"] = java_string_hash(compact_json(new_data))
        dump["data"] = new_data
        dump["description"] = f"Signal Loom proposal from '{native['description'] or 'editor backup'}'" + (
            f" (bank {bank_index + 1} of an all-banks backup)" if native["dump_type"] == "allBanks" else ""
        )
    text = compact_json(dump)
    out["dump"] = dump
    out["text"] = text
    out["filename"] = suggested_filename(bank.get("bankName") or "Bank", when)
    out["self_check"] = check_dump(text)
    third_party = 0
    unknown_types = 0
    for p in list(bank.get("presetArray") or []) + list(bank.get("expPresetArray") or []):
        for m in (p.get("msgArray") or []) if isinstance(p, dict) else []:
            if isinstance(m, dict) and m.get("t") not in SAMPLE_TYPE_CODES:
                if isinstance(m.get("t"), int) and m["t"] in EDITOR_MESSAGE_TYPE_ENUM:
                    third_party += 1
                else:
                    unknown_types += 1
    for m in bank.get("bankMsgArray") or []:
        if isinstance(m, dict) and m.get("t") not in SAMPLE_TYPE_CODES:
            third_party += 1 if isinstance(m.get("t"), int) and m["t"] in EDITOR_MESSAGE_TYPE_ENUM else 0
            unknown_types += 0 if isinstance(m.get("t"), int) and m["t"] in EDITOR_MESSAGE_TYPE_ENUM else 1
    sink: list[dict] = []
    interpret_bank(bank, bank.get("bankNumber") if isinstance(bank.get("bankNumber"), int) else 0, sink, "$.data.bank")
    out["preserved"] = {
        "third_party_messages": third_party,
        "unknown_type_messages": unknown_types,
        "unknown_keys": len(sink),
        "byte_identical_to_input": text == raw,  # actual output text vs the input text, not "no edits"
    }
    out["warnings"].append(
        "Fixture-validated shape only: no Signal Loom file has yet been loaded into the Morningstar editor or an MC8. "
        "Restore as a single bank into an unused bank and inspect it in the editor before saving to the controller."
    )
    out["ok"] = True
    return out
