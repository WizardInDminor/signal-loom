"""Defensive reader for ML10X editor backup files. NO WRITER — native export is blocked.

The shape below was observed in one real rev-B / firmware 1.2 export published in a
third-party GPL-licensed repository (not vendored here). The routing ``matrixArray`` field is
undecoded by every public source, and the ``hash`` algorithm for this file type is
unverified, so Signal Loom refuses to *produce* ML10X files. Reading loop/preset names and
the MIDI channel from a user-supplied backup is useful and safe.
"""

from __future__ import annotations

import json
from typing import Any

from . import specs

MAX_BYTES = 20 * 1024 * 1024


def read_backup(raw: str) -> dict:
    report: dict[str, Any] = {
        "ok": False,
        "problems": [],
        "midi_channel": None,
        "device_id": None,
        "connectors": [],
        "presets": [],
        "settings": {},
        "evidence": "third_party_shape",
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
    if d.get("deviceModel") != specs.ML10X_EXPORT_DEVICE_MODEL:
        report["problems"].append(
            f"deviceModel {d.get('deviceModel')!r} is not the ML10X ({specs.ML10X_EXPORT_DEVICE_MODEL})"
        )
    data = d.get("data")
    if not isinstance(data, dict):
        report["problems"].append("missing data object")
        return report
    cd = data.get("controllerData")
    if isinstance(cd, dict):
        if isinstance(cd.get("midiChannel"), int):
            report["midi_channel"] = cd["midiChannel"]  # 0 = ignore MIDI
        if isinstance(cd.get("deviceId"), int):
            report["device_id"] = cd["deviceId"]
        for k in ("inputSplit", "loopBypassPersistent", "inputRingSwapPin"):
            if k in cd:
                report["settings"][k] = cd[k]
        conns = cd.get("connectors")
        if isinstance(conns, list):
            for c in conns:
                if isinstance(c, dict) and isinstance(c.get("id"), int):
                    report["connectors"].append(
                        {
                            "id": c["id"],
                            "name": str(c.get("name", ""))[:32],
                            "short_name": str(c.get("shortName", ""))[:8],
                            "trails": bool(c.get("trails", False)),
                        }
                    )
    pd = data.get("presetData")
    if isinstance(pd, list):
        for bank in pd:
            if not isinstance(bank, dict) or not isinstance(bank.get("data"), list):
                continue
            bno = bank.get("bank")
            for p in bank["data"]:
                if not isinstance(p, dict):
                    continue
                name = str(p.get("presetName", ""))
                num = p.get("presetNumber")
                if name.strip() and isinstance(num, int) and isinstance(bno, int):
                    report["presets"].append(
                        {
                            "bank": bno,
                            "number": num,
                            "global_number": bno * specs.ML10X_PRESETS_PER_BANK + num,
                            "name": name[:32],
                            "advanced_mode": bool(p.get("advancedMode", False)),
                            "bypass_bitmap": p.get("bypass") if isinstance(p.get("bypass"), int) else None,
                            "routing": "undecoded (matrixArray semantics unknown)",
                        }
                    )
    report["ok"] = not report["problems"]
    return report
