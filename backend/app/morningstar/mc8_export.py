"""MC8 editor "Bank Backup" file writer/reader.

Evidence level: FIXTURE-VALIDATED (see docs/research.md §MC8 export). The shape, key order,
code values and the integrity hash were reproduced from three real MC8 editor export files
published in a third-party repository (bwanab/MC8_setups). It is NOT editor-validated and NOT
hardware-validated: nobody has yet loaded a Signal Loom-generated file into the Morningstar
editor. The README and the UI say so.

Design choices:
- Only ``singleBank`` dumps are produced. Restoring a bank file replaces one bank; an
  ``allBanks`` file would overwrite the whole controller including global settings, which is
  outside the non-destructive posture of Session 1.
- Only PC and CC messages (type codes 1 and 2, SAMPLE-confirmed) are emitted. Other message
  types are refused rather than guessed.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from ..models.common import Diagnostic, Severity
from . import specs

EMPTY_MSG_TG_SWITCH = 2  # "Both" — observed default in switch presets of real exports
EMPTY_MSG_TG_OTHER = 0  # observed in expression presets and bank messages


def java_string_hash(s: str) -> int:
    """Java ``String.hashCode`` (signed 32-bit). Reproduces the ``hash`` field of real exports."""
    h = 0
    for ch in s:
        h = (31 * h + ord(ch)) & 0xFFFFFFFF
    return h - 0x100000000 if h >= 0x80000000 else h


def compact_json(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def _msg(d1: int = 0, d2: int = 0, m: int = 0, c: int = 1, t: int = 0, a: int = 0, tg: int = 0) -> dict:
    return {"d1": d1, "d2": d2, "d3": 0, "d4": 0, "m": m, "c": c, "t": t, "a": a, "tg": tg, "mi": ""}


def _empty_preset(num: int, bank_num: int, is_exp: bool) -> dict:
    tg = EMPTY_MSG_TG_OTHER if is_exp else EMPTY_MSG_TG_SWITCH
    return {
        "presetNum": num,
        "bankNum": bank_num,
        "isExp": is_exp,
        "shortName": "",
        "toggleName": "",
        "longName": "",
        "toToggle": False,
        "toBlink": False,
        "toMsgScroll": False,
        "toggleGroup": 0,
        "msgArray": [_msg(m=i, tg=tg) for i in range(specs.MC8_MESSAGES_PER_PRESET)],
    }


def build_single_bank_dump(
    bank_plan: dict, *, downloaded_at: datetime | None = None, description: str = ""
) -> tuple[dict, list[Diagnostic]]:
    """Build a ``singleBank`` dump from a compiled MC8 bank plan (see compiler.compile_rig).

    Returns (dump, diagnostics). If any ERROR diagnostic is present the dump must not be
    offered as importable; the caller decides.
    """
    diags: list[Diagnostic] = []
    bank_number = int(bank_plan["number"])
    if bank_number < 1 or bank_number > specs.MC8_BANKS:
        diags.append(
            Diagnostic(
                code="mc8.bank_out_of_range",
                severity=Severity.ERROR,
                message=f"Bank {bank_number} outside 1-{specs.MC8_BANKS}.",
            )
        )
        return {}, diags
    bank_idx = bank_number - 1
    name = str(bank_plan.get("name") or "")[: specs.MC8_BANK_NAME_MAX]
    presets = [_empty_preset(i, bank_idx, False) for i in range(specs.MC8_SWITCH_PRESETS_PER_BANK)]
    for sw in bank_plan["switches"]:
        pos = sw["position"]
        if pos not in specs.MC8_POSITIONS:
            diags.append(
                Diagnostic(
                    code="mc8.position_invalid",
                    severity=Severity.ERROR,
                    message=f"Position {pos} invalid.",
                    subject_type="switch",
                    subject_id=f"{bank_number}:{pos}",
                )
            )
            continue
        idx = specs.MC8_POSITIONS.index(pos)
        preset = presets[idx]
        short = str(sw.get("short_name") or "")
        preset["shortName"] = short[: specs.MC8_SHORT_NAME_MAX]
        preset["toggleName"] = preset["shortName"][: specs.MC8_TOGGLE_NAME_MAX]
        preset["longName"] = (sw.get("scene_name") or short)[: specs.MC8_LONG_NAME_MAX]
        action_code = specs.MC8_ACTIONS.get(sw.get("action", "press"))
        if action_code is None:
            diags.append(
                Diagnostic(
                    code="mc8.action_invalid",
                    severity=Severity.ERROR,
                    message=f"Unknown action {sw.get('action')}.",
                    subject_type="switch",
                    subject_id=f"{bank_number}:{pos}",
                )
            )
            continue
        msgs: list[dict] = []
        for cm in sw["messages"]:
            ch = int(cm["channel"])
            if not 1 <= ch <= 16:
                diags.append(
                    Diagnostic(
                        code="midi.channel_invalid",
                        severity=Severity.ERROR,
                        message=f"Channel {ch} invalid.",
                        subject_type="switch",
                        subject_id=f"{bank_number}:{pos}",
                    )
                )
                continue
            if cm["type"] == "pc":
                msgs.append(
                    _msg(d1=int(cm["number"]), c=ch, t=specs.MC8_MSG_TYPE_PC, a=action_code, tg=EMPTY_MSG_TG_SWITCH)
                )
            elif cm["type"] == "cc":
                msgs.append(
                    _msg(
                        d1=int(cm["number"]),
                        d2=int(cm["value"] or 0),
                        c=ch,
                        t=specs.MC8_MSG_TYPE_CC,
                        a=action_code,
                        tg=EMPTY_MSG_TG_SWITCH,
                    )
                )
            else:
                diags.append(
                    Diagnostic(
                        code="mc8.message_type_unsupported",
                        severity=Severity.ERROR,
                        message=f"Message type {cm['type']} cannot be exported.",
                        subject_type="switch",
                        subject_id=f"{bank_number}:{pos}",
                    )
                )
        for em in sw.get("extra_messages", []):
            ch = em.get("channel")
            if ch is None or not 1 <= int(ch) <= 16:
                diags.append(
                    Diagnostic(
                        code="midi.channel_invalid",
                        severity=Severity.ERROR,
                        message="Extra message has no valid channel.",
                        subject_type="switch",
                        subject_id=f"{bank_number}:{pos}",
                    )
                )
                continue
            tg = specs.MC8_TOGGLE_POSITIONS.get(em.get("toggle_position", "both"), EMPTY_MSG_TG_SWITCH)
            a = specs.MC8_ACTIONS.get(em.get("action", "press"), action_code)
            if em.get("type") == "pc":
                msgs.append(_msg(d1=int(em.get("number") or 0), c=int(ch), t=specs.MC8_MSG_TYPE_PC, a=a, tg=tg))
            elif em.get("type") == "cc":
                msgs.append(
                    _msg(
                        d1=int(em.get("number") or 0),
                        d2=int(em.get("value") or 0),
                        c=int(ch),
                        t=specs.MC8_MSG_TYPE_CC,
                        a=a,
                        tg=tg,
                    )
                )
            else:
                diags.append(
                    Diagnostic(
                        code="mc8.message_type_unsupported",
                        severity=Severity.ERROR,
                        message=f"Extra message type {em.get('type')} cannot be exported.",
                        subject_type="switch",
                        subject_id=f"{bank_number}:{pos}",
                    )
                )
        if len(msgs) > specs.MC8_MESSAGES_PER_PRESET:
            diags.append(
                Diagnostic(
                    code="mc8.message_limit",
                    severity=Severity.ERROR,
                    message=f"Switch {pos} has {len(msgs)} messages; the MC8 holds {specs.MC8_MESSAGES_PER_PRESET}. Nothing was truncated; fix the scene.",
                    subject_type="switch",
                    subject_id=f"{bank_number}:{pos}",
                )
            )
            continue
        for i, mm in enumerate(msgs):
            mm["m"] = i
            preset["msgArray"][i] = mm
    bank = {
        "bankNumber": bank_idx,
        "bankName": name,
        "bankClearToggle": False,
        "bankMsgArray": [_msg(m=i, tg=EMPTY_MSG_TG_OTHER) for i in range(specs.MC8_BANK_MESSAGES)],
        "presetArray": presets,
        "expPresetArray": [_empty_preset(i, bank_idx, True) for i in range(specs.MC8_EXP_PRESETS_PER_BANK)],
    }
    data = {"bank": bank}
    ts = (downloaded_at or datetime.now(UTC)).strftime(
        "%Y-%m-%dT%H:%M:%S."
    ) + f"{(downloaded_at or datetime.now(UTC)).microsecond // 1000:03d}Z"
    dump = {
        "schemaVersion": specs.MC8_EXPORT_SCHEMA_VERSION,
        "dumpType": "singleBank",
        "deviceModel": specs.MC8_EXPORT_DEVICE_MODEL,
        "downloadDate": ts,
        "hash": java_string_hash(compact_json(data)),
        "data": data,
        "description": description,
    }
    return dump, diags


def suggested_filename(bank_name: str, when: datetime | None = None) -> str:
    when = when or datetime.now(UTC)
    safe = "".join(ch if ch.isalnum() or ch in " -_" else "_" for ch in bank_name).strip() or "Bank"
    return f"Morningstar_MC8_Bank_Backup_{safe}_{when.strftime('%Y%m%d_%H%M%S')}.json"


def serialize(dump: dict) -> str:
    """Single-line compact JSON, exactly like the editor writes it."""
    return compact_json(dump)


# --------------------------------------------------------------------------- reader / checker

MAX_BYTES = 20 * 1024 * 1024


def check_dump(raw: str) -> dict:
    """Defensively inspect an MC8 editor export. Returns a structured report; never raises."""
    report: dict[str, Any] = {
        "ok": False,
        "problems": [],
        "dump_type": None,
        "device_model": None,
        "hash_matches": None,
        "banks": [],
    }
    if len(raw) > MAX_BYTES:
        report["problems"].append("file too large")
        return report
    try:
        d = json.loads(raw)
    except json.JSONDecodeError as e:
        report["problems"].append(f"not valid JSON: {e.msg}")
        return report
    if not isinstance(d, dict):
        report["problems"].append("top level is not an object")
        return report
    report["dump_type"] = d.get("dumpType")
    report["device_model"] = d.get("deviceModel")
    if d.get("schemaVersion") != 1:
        report["problems"].append(f"unexpected schemaVersion {d.get('schemaVersion')!r}")
    if d.get("deviceModel") != specs.MC8_EXPORT_DEVICE_MODEL:
        report["problems"].append(
            f"deviceModel {d.get('deviceModel')!r} is not the MC8 ({specs.MC8_EXPORT_DEVICE_MODEL}); refusing to treat as MC8 data"
        )
    data = d.get("data")
    if not isinstance(data, dict):
        report["problems"].append("missing data object")
        return report
    if isinstance(d.get("hash"), int):
        report["hash_matches"] = java_string_hash(compact_json(data)) == d["hash"]
        if not report["hash_matches"]:
            report["problems"].append("hash does not match the data section (file edited or different serializer)")
    banks = []
    if d.get("dumpType") == "singleBank" and isinstance(data.get("bank"), dict):
        banks = [data["bank"]]
    elif d.get("dumpType") == "allBanks" and isinstance(data.get("bankArray"), list):
        banks = [b for b in data["bankArray"] if isinstance(b, dict)]
    else:
        report["problems"].append(f"unknown dumpType {d.get('dumpType')!r}")
    for b in banks:
        presets = b.get("presetArray") if isinstance(b.get("presetArray"), list) else []
        exp = b.get("expPresetArray") if isinstance(b.get("expPresetArray"), list) else []
        if len(presets) != specs.MC8_SWITCH_PRESETS_PER_BANK:
            report["problems"].append(
                f"bank {b.get('bankNumber')}: {len(presets)} presets (expected {specs.MC8_SWITCH_PRESETS_PER_BANK})"
            )
        if len(exp) != specs.MC8_EXP_PRESETS_PER_BANK:
            report["problems"].append(
                f"bank {b.get('bankNumber')}: {len(exp)} expression presets (expected {specs.MC8_EXP_PRESETS_PER_BANK})"
            )
        used = []
        for p in presets:
            if not isinstance(p, dict):
                continue
            msgs = p.get("msgArray") if isinstance(p.get("msgArray"), list) else []
            if len(msgs) != specs.MC8_MESSAGES_PER_PRESET:
                report["problems"].append(
                    f"preset {p.get('presetNum')}: {len(msgs)} message slots (expected {specs.MC8_MESSAGES_PER_PRESET})"
                )
            active = [m for m in msgs if isinstance(m, dict) and m.get("t")]
            if p.get("shortName") or active:
                n = p.get("presetNum", 0)
                pos = specs.MC8_POSITIONS[n] if isinstance(n, int) and 0 <= n < len(specs.MC8_POSITIONS) else "?"
                used.append(
                    {
                        "position": pos,
                        "short_name": p.get("shortName"),
                        "message_count": len(active),
                        "types": sorted(
                            {specs.MC8_MSG_TYPE_NAMES_THIRD_PARTY.get(m.get("t"), f"type {m.get('t')}") for m in active}
                        ),
                    }
                )
        banks_entry = {
            "bank_number": (b.get("bankNumber", 0) + 1) if isinstance(b.get("bankNumber"), int) else None,
            "bank_name": b.get("bankName"),
            "used_presets": used,
        }
        report["banks"].append(banks_entry)
    report["ok"] = not report["problems"]
    return report


# --------------------------------------------------------------------------- import to a plan


def bank_dump_to_plan(raw: str) -> dict:
    """Turn an MC8 editor bank backup into a Signal Loom MC8 bank plan (PC/CC messages only).

    Returns {"ok", "problems", "bank": {number, name, presets: [...]}, "skipped": [...]} where each
    preset carries its PC/CC messages as ``extra_messages``. Message types other than PC/CC
    (SAMPLE-confirmed codes 1 and 2) are reported in ``skipped`` with their third-party type
    name, never guessed into something else. Toggle-mode presets are imported with their
    position codes preserved.
    """
    report = check_dump(raw)
    out: dict[str, Any] = {"ok": False, "problems": list(report["problems"]), "bank": None, "skipped": []}
    if report["dump_type"] != "singleBank":
        out["problems"].append(
            f"expected a singleBank export, got {report['dump_type']!r} (use 'Current Bank' in the editor)"
        )
    if out["problems"]:
        return out
    bank = json.loads(raw)["data"]["bank"]
    action_names = {v: k for k, v in specs.MC8_ACTIONS.items()}
    tg_names = {v: k for k, v in specs.MC8_TOGGLE_POSITIONS.items()}
    presets = []
    for p in bank.get("presetArray", []):
        n = p.get("presetNum")
        if not isinstance(n, int) or not 0 <= n < specs.MC8_SWITCH_PRESETS_PER_BANK:
            continue
        msgs = []
        for m in p.get("msgArray", []):
            t = m.get("t", 0)
            if t == specs.MC8_MSG_TYPE_EMPTY:
                continue
            if t not in (specs.MC8_MSG_TYPE_PC, specs.MC8_MSG_TYPE_CC):
                out["skipped"].append(
                    {
                        "position": specs.MC8_POSITIONS[n],
                        "slot": m.get("m"),
                        "type_code": t,
                        "type_name": specs.MC8_MSG_TYPE_NAMES_THIRD_PARTY.get(t, f"type {t}"),
                    }
                )
                continue
            msgs.append(
                {
                    "type": "pc" if t == specs.MC8_MSG_TYPE_PC else "cc",
                    "channel": int(m.get("c", 1)),
                    "number": int(m.get("d1", 0)),
                    "value": int(m.get("d2", 0)) if t == specs.MC8_MSG_TYPE_CC else None,
                    "action": action_names.get(m.get("a", 1), "press"),
                    "toggle_position": tg_names.get(m.get("tg", 2), "both"),
                    "label": None,
                }
            )
        if not (p.get("shortName") or msgs):
            continue
        presets.append(
            {
                "position": specs.MC8_POSITIONS[n],
                "short_name": str(p.get("shortName", ""))[: specs.MC8_SHORT_NAME_MAX],
                "long_name": str(p.get("longName") or "") or None,
                "toggle_name": str(p.get("toggleName") or "") or None,
                "toggle_mode": bool(p.get("toToggle", False)),
                "scene_id": None,
                "action": "press",
                "extra_messages": msgs,
            }
        )
    out["bank"] = {
        "number": int(bank.get("bankNumber", 0)) + 1,
        "name": str(bank.get("bankName", "")),
        "presets": presets,
    }
    out["ok"] = True
    return out
