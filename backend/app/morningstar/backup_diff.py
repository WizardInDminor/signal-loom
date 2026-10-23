"""Structural diff of two Morningstar editor backups (MC8 or ML10X).

Purpose: controlled experiments. The user exports a backup, changes exactly one thing in
the official editor, exports again, and the diff shows which fields moved. For the ML10X
this is how the undecoded routing field can eventually be understood; for the MC8 it shows
exactly which preset/message slots a change touched. Pure comparison, no interpretation
that the evidence does not support.
"""

from __future__ import annotations

import json
from typing import Any

from . import specs

MAX_BYTES = 20 * 1024 * 1024
MAX_CHANGES = 5000


def _label_path(path: list[str | int], doc: Any) -> str:
    """Human-friendly path: name ML10X presets/banks and MC8 banks/presets/message slots."""
    parts: list[str] = []
    node = doc
    for p in path:
        try:
            node_next = node[p]
        except (KeyError, IndexError, TypeError):
            node_next = None
        if isinstance(p, int) and isinstance(node, list) and isinstance(node_next, dict):
            if "presetNumber" in node_next:
                parts.append(f"preset {node_next.get('presetNumber')} '{node_next.get('presetName', '')}'")
            elif "presetNum" in node_next:
                parts.append(
                    f"preset {node_next.get('presetNum')} ({specs.MC8_POSITIONS[node_next['presetNum']] if isinstance(node_next.get('presetNum'), int) and 0 <= node_next['presetNum'] < len(specs.MC8_POSITIONS) else '?'}) '{node_next.get('shortName', '')}'"
                )
            elif "bankNumber" in node_next:
                parts.append(
                    f"bank {node_next.get('bankNumber')}"
                    + (f" '{node_next.get('bankName')}'" if node_next.get("bankName") else "")
                )
            elif "bank" in node_next and "data" in node_next:
                parts.append(f"bank {node_next.get('bank')}")
            elif "m" in node_next and "t" in node_next:
                parts.append(f"message slot {node_next.get('m')}")
            elif "id" in node_next and "name" in node_next:
                parts.append(f"connector {node_next.get('id')} '{node_next.get('name')}'")
            else:
                parts.append(f"[{p}]")
        else:
            parts.append(str(p))
        node = node_next
    return " / ".join(parts)


def _walk(a: Any, b: Any, path: list[str | int], root_a: Any, out: list[dict]) -> None:
    if len(out) >= MAX_CHANGES:
        return
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append({"path": path + [k], "change": "added", "before": None, "after": b[k]})
            elif k not in b:
                out.append({"path": path + [k], "change": "removed", "before": a[k], "after": None})
            else:
                _walk(a[k], b[k], path + [k], root_a, out)
    elif isinstance(a, list) and isinstance(b, list):
        if all(not isinstance(x, (dict, list)) for x in a + b):
            # A list of scalars (e.g. a 3-int routing matrix entry) is one value, not three.
            if a != b:
                out.append({"path": path, "change": "changed", "before": a, "after": b})
            return
        for i in range(max(len(a), len(b))):
            if i >= len(a):
                out.append({"path": path + [i], "change": "added", "before": None, "after": b[i]})
            elif i >= len(b):
                out.append({"path": path + [i], "change": "removed", "before": a[i], "after": None})
            else:
                _walk(a[i], b[i], path + [i], root_a, out)
    elif a != b:
        out.append({"path": path, "change": "changed", "before": a, "after": b})


def diff_backups(raw_a: str, raw_b: str) -> dict:
    report: dict[str, Any] = {
        "ok": False,
        "problems": [],
        "same_model": None,
        "device_model": None,
        "changes": [],
        "summary": {},
    }
    if len(raw_a) > MAX_BYTES or len(raw_b) > MAX_BYTES:
        report["problems"].append("file too large")
        return report
    docs = []
    for name, raw in (("A", raw_a), ("B", raw_b)):
        try:
            d = json.loads(raw)
        except json.JSONDecodeError as e:
            report["problems"].append(f"file {name}: not valid JSON: {e.msg}")
            continue
        if not isinstance(d, dict) or "data" not in d:
            report["problems"].append(f"file {name}: not a Morningstar editor backup (no data object)")
            continue
        docs.append(d)
    if len(docs) != 2:
        return report
    a, b = docs
    report["device_model"] = a.get("deviceModel")
    report["same_model"] = a.get("deviceModel") == b.get("deviceModel")
    if not report["same_model"]:
        report["problems"].append(
            f"deviceModel differs ({a.get('deviceModel')} vs {b.get('deviceModel')}); comparing anyway"
        )
    changes: list[dict] = []
    _walk(a.get("data"), b.get("data"), ["data"], a, changes)
    for c in changes:
        c["label"] = _label_path(c["path"], a if c["change"] != "added" else b)
        c["path"] = [str(p) for p in c["path"]]
    meta = {
        k: (a.get(k), b.get(k)) for k in ("dumpType", "downloadDate", "hash", "schemaVersion") if a.get(k) != b.get(k)
    }
    report["metadata_differences"] = {k: {"a": v[0], "b": v[1]} for k, v in meta.items()}
    report["changes"] = changes
    kinds: dict[str, int] = {}
    for c in changes:
        kinds[c["change"]] = kinds.get(c["change"], 0) + 1
    touched_presets = sorted(
        {c["label"].split(" / ")[1] for c in changes if c["label"].count(" / ") >= 1 and "preset" in c["label"]}
    )
    report["summary"] = {
        "total": len(changes),
        "by_kind": kinds,
        "truncated": len(changes) >= MAX_CHANGES,
        "touched": touched_presets[:50],
    }
    report["ok"] = True
    return report


def diff_objects(a: Any, b: Any, root: str = "bank") -> list[dict]:
    """Structural diff of two already-parsed JSON objects, labelled like ``diff_backups``.

    Used by the bridge to show exactly what a proposed modification changes against the native
    snapshot. Paths are returned as strings; ``label`` names MC8 presets, message slots and
    ML10X presets the way the file-level diff does.
    """
    changes: list[dict] = []
    _walk(a, b, [root], a, changes)
    for c in changes:
        c["label"] = _label_path(c["path"], {root: a} if c["change"] != "added" else {root: b})
        c["path"] = [str(p) for p in c["path"]]
    return changes
