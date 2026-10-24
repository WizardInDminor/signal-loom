"""ML10X editor backup proposals: routing-free, whole-preset edits with every native byte preserved.

The third layer of the Morningstar Bridge for ML10X *Device Backup* files (``deviceModel`` 7,
``dumpType`` "full"): a musician loads a real backup, proposes a transaction of typed operations, and
receives a **candidate** backup to review and download. The operations never author routing:

- ``rename``            change ``presetName`` of one slot.
- ``copy``              duplicate a whole preset object into another slot (same or other bank).
- ``move``              put a whole preset into another slot and clear the source with the file's own
                        factory-empty representation; an occupied destination needs an explicit choice.
- ``swap``              exchange two whole preset objects (any banks).
- ``rename_connector``  change a connector's ``name`` / ``shortName`` / ``inputName`` / ``outputName``.

Every preset travels as its complete native object — ``matrixArray``, ``advancedMode``, ``bypass``,
``tipT``, ``ringT`` and any key Signal Loom has not seen — and the only identity field rewritten is
``presetNumber`` (equal to the array position in all 512 presets of the one real backup).

Evidence base (see docs/research/ml10x-integration-2026-10-23.md):

- Integrity hash: Java ``String.hashCode`` over the compact JSON of ``data``; reproduced on one real
  backup; a forum user reports the editor rejects a hand-edited file whose hash no longer matches.
- Factory-empty preset payload: ``presetName`` "Empty", ``tipT``/``ringT`` 127, ``advancedMode``
  false, ``bypass`` 0, all 16 matrix rows ``[0,0,0]`` — 506 of 509 "Empty"-named slots in the real file;
  the other 3 carry matrix data (used and reverted), which is why a name alone never counts as empty.
- Preset name: ≤16 characters in the editor schema, 12 bytes on the wire (READ pads, WRITE trims);
  13–16 characters are accepted only when the caller explicitly accepts that uncertainty.
- Connector names: fixed-width wire fields (16 / 4 / 16 / 16 ASCII bytes).

**Nothing here is editor- or hardware-validated.** The output is labelled a candidate; the Morningstar
editor remains the only tool that programs the device, and a restore of a "full" backup may replace all
512 presets and the controller settings.
"""

from __future__ import annotations

import copy
import json
from datetime import UTC, datetime
from typing import Any

from . import specs
from .backup_diff import diff_objects
from .mc8_export import compact_json, java_string_hash
from .ml10x_native import (
    CONNECTOR_KEYS,
    DEFAULT_PRESET_NAME,
    MATRIX_ROW_BYTES,
    MATRIX_ROWS,
    PRESET_KEYS,
    SPILLOVER_NOTHING,
    load_native,
    slot_occupancy,
)

SUPPORTED_SCHEMA_VERSION = 1
SUPPORTED_DUMP_TYPE = "full"
PRESET_NAME_EDITOR_MAX = specs.ML10X_PRESET_NAME_MAX  # 16 — THIRD_PARTY (editor schema)
PRESET_NAME_WIRE_BYTES = 12  # THIRD_PARTY (READ pads to 12, WRITE trims; encoder truncates to 12)
CONNECTOR_FIELD_WIRE_BYTES = {"name": 16, "shortName": 4, "inputName": 16, "outputName": 16}  # THIRD_PARTY
MAX_OPERATIONS = 512
OPS = ("rename", "copy", "move", "swap", "rename_connector")
ON_OCCUPIED = ("refuse", "swap", "overwrite")

EVIDENCE: dict[str, Any] = {
    "level": "third_party_shape",
    "editor_validated": False,
    "hardware_validated": False,
    "hash_algorithm": "Java String.hashCode over compact data JSON; reproduced on 1 real ML10X backup; "
    "a forum user reports the editor rejects a hand-edited file whose hash no longer matches",
    "preset_identity": "presetNumber == array position in all 512 presets of the real backup; it is the only "
    "identity field rewritten by copy/move/swap",
    "empty_slot_rule": "factory payload (name 'Empty', tipT/ringT 127, Simple mode, bypass 0, all matrix rows zero) "
    "and no per-preset data Signal Loom cannot account for; 506 of 509 'Empty'-named slots in the real backup "
    "match it, 3 do not (they carry matrix data)",
    "name_limits": f"preset name ≤{PRESET_NAME_EDITOR_MAX} characters (editor schema), {PRESET_NAME_WIRE_BYTES} bytes "
    "on the wire; printable ASCII only (non-ASCII behaviour unverified); never truncated",
    "connector_name_limits": "fixed-width wire fields: name 16, shortName 4, inputName 16, outputName 16 ASCII bytes",
    "restore_scope": "dumpType 'full': a restore in the official editor may replace all 512 presets and the "
    "controller settings; a spare bank does not isolate it",
    "routing": "matrixArray / bypass / tipT / ringT / advancedMode are carried verbatim and never authored",
}


# ----------------------------------------------------------------------------- structure gate


def _preset_shape_problem(p: Any, where: str) -> str | None:
    """Structural check of one preset object; any violation makes editing unreliable."""
    if not isinstance(p, dict):
        return f"{where}: preset is not an object"
    for k in PRESET_KEYS:
        if k not in p:
            return f"{where}: preset lacks the native key {k!r}"
    if not isinstance(p["presetNumber"], int) or isinstance(p["presetNumber"], bool):
        return f"{where}: presetNumber is not an integer"
    if not isinstance(p["presetName"], str):
        return f"{where}: presetName is not a string"
    for k in ("tipT", "ringT", "bypass"):
        if not isinstance(p[k], int) or isinstance(p[k], bool):
            return f"{where}: {k} is not an integer"
    if not isinstance(p["advancedMode"], bool):
        return f"{where}: advancedMode is not a boolean"
    m = p["matrixArray"]
    if not isinstance(m, dict):
        return f"{where}: matrixArray is not an object"
    for row, v in m.items():
        if not (isinstance(v, list) and len(v) == MATRIX_ROW_BYTES and all(isinstance(x, int) for x in v)):
            return f"{where}: matrixArray row {row!r} is not a list of {MATRIX_ROW_BYTES} integers"
    return None


def structure_problems(data: Any) -> list[str]:
    """Why a parsed ``data`` object cannot be edited reliably (empty list = editable)."""
    problems: list[str] = []
    if not isinstance(data, dict):
        return ["data is not an object"]
    pd = data.get("presetData")
    if not isinstance(pd, list) or len(pd) != specs.ML10X_BANKS:
        problems.append(
            f"presetData must be a list of {specs.ML10X_BANKS} banks "
            f"(found {len(pd) if isinstance(pd, list) else type(pd).__name__})"
        )
        return problems
    for bi, b in enumerate(pd):
        if not isinstance(b, dict) or not isinstance(b.get("data"), list):
            problems.append(f"bank entry {bi} is not an object with a preset list")
            continue
        if b.get("bank") != bi:
            problems.append(
                f"bank entry {bi} carries bank {b.get('bank')!r}; the real backup numbers banks by position"
            )
        if len(b["data"]) != specs.ML10X_PRESETS_PER_BANK:
            problems.append(f"bank {bi} has {len(b['data'])} presets (expected {specs.ML10X_PRESETS_PER_BANK})")
            continue
        for pi, p in enumerate(b["data"]):
            err = _preset_shape_problem(p, f"bank {bi} preset {pi}")
            if err:
                problems.append(err)
                continue
            if p["presetNumber"] != pi:
                problems.append(
                    f"bank {bi} preset {pi}: presetNumber {p['presetNumber']!r} does not match its position; "
                    "slot identity cannot be established"
                )
        if len(problems) > 20:
            problems.append("… further structural problems omitted")
            return problems
    cd = data.get("controllerData")
    if not isinstance(cd, dict):
        problems.append("controllerData missing or not an object")
    elif not isinstance(cd.get("connectors"), list):
        problems.append("controllerData.connectors missing or not a list")
    return problems


# ----------------------------------------------------------------------------- empty-slot representation


def _uniform_unknown_items(data: dict) -> dict:
    """Per-preset keys Signal Loom has not seen that every preset carries with an identical value: inert
    file-wide (a newer editor's constant), so a factory-empty slot may carry them. Any other unknown key is
    per-preset data and makes its slot occupied."""
    uniform: dict | None = None
    for b in data["presetData"]:
        for p in b["data"]:
            extra = {k: compact_json(v) for k, v in p.items() if k not in PRESET_KEYS}
            uniform = extra if uniform is None else {k: v for k, v in uniform.items() if extra.get(k) == v}
    if not uniform:
        return {}
    first = data["presetData"][0]["data"][0]
    return {k: first[k] for k in uniform}


def _factory_core(p: dict) -> bool:
    return (
        p["presetName"] == DEFAULT_PRESET_NAME
        and p["tipT"] == SPILLOVER_NOTHING
        and p["ringT"] == SPILLOVER_NOTHING
        and p["advancedMode"] is False
        and p["bypass"] == 0
        and len(p["matrixArray"]) == MATRIX_ROWS
        and not any(any(v) for v in p["matrixArray"].values())
    )


class _EmptyRule:
    """Occupancy classification and the empty-slot template, both derived from the file at hand."""

    def __init__(self, data: dict):
        self.uniform_unknown = _uniform_unknown_items(data)
        self.template: dict | None = None
        self.template_note = ""
        empties = [p for b in data["presetData"] for p in b["data"] if self.is_empty(p)]
        if empties:
            self.template = copy.deepcopy(empties[0])
            self.template_note = (
                f"{len(empties)} factory-empty slot(s) in this file share one payload; clearing a slot reuses it"
            )
        else:
            self.template_note = (
                "no factory-empty slot in this file: the empty-slot representation cannot be established"
            )

    def is_empty(self, p: dict) -> bool:
        if not _factory_core(p):
            return False
        extra = {k: v for k, v in p.items() if k not in PRESET_KEYS}
        return extra == self.uniform_unknown  # any per-preset unknown data means the slot is never "free"

    def describe(self, p: dict) -> dict:
        occ = slot_occupancy(p)
        if occ["state"] == "empty" and not self.is_empty(p):
            occ = {
                "state": "occupied",
                "reason": "carries per-preset data Signal Loom cannot account for (unknown keys not shared by every preset)",
            }
        return occ

    def cleared(self, source: dict) -> dict:
        """The source slot after a move: the file's own factory-empty payload in the source's key order."""
        assert self.template is not None
        out: dict[str, Any] = {}
        for k in source:
            if k == "presetNumber":
                out[k] = source[k]
            elif k == "matrixArray":
                out[k] = {row: [0] * MATRIX_ROW_BYTES for row in self.template["matrixArray"]}
            elif k in self.template:
                out[k] = copy.deepcopy(self.template[k])
        for k in self.template:  # keys the source lacks but the template has (cannot happen with a uniform file)
            if k not in out:
                out[k] = copy.deepcopy(self.template[k])
        return out


# ----------------------------------------------------------------------------- validation helpers


def _is_ascii_printable(s: str) -> bool:
    return all(32 <= ord(ch) <= 126 for ch in s)


def _name_problem(value: Any, where: str, accept_unverified_length: bool, warnings: list[str]) -> str | None:
    if not isinstance(value, str):
        return f"{where}: name must be a string"
    chars = len(value)
    nbytes = len(value.encode("utf-8"))
    if not value.strip():
        return f"{where}: name must not be empty (the factory name is {DEFAULT_PRESET_NAME!r}; use it explicitly if wanted)"
    if not _is_ascii_printable(value):
        return (
            f"{where}: name must be printable ASCII ({chars} characters, {nbytes} UTF-8 bytes); the editor's "
            "behaviour with non-ASCII names is unverified and the wire format is 7-bit"
        )
    if chars > PRESET_NAME_EDITOR_MAX:
        return (
            f"{where}: name is {chars} characters; the editor schema allows at most {PRESET_NAME_EDITOR_MAX} "
            "(nothing is truncated)"
        )
    if chars > PRESET_NAME_WIRE_BYTES:
        if not accept_unverified_length:
            return (
                f"{where}: name is {chars} characters / {nbytes} bytes; the device stores {PRESET_NAME_WIRE_BYTES} bytes "
                f"on the wire and the editor's handling of {PRESET_NAME_WIRE_BYTES + 1}-{PRESET_NAME_EDITOR_MAX} "
                "characters is unverified. Shorten it, or set accept_unverified_length to keep it as typed"
            )
        warnings.append(
            f"{where}: name {value!r} is {chars} characters; the device may keep only the first "
            f"{PRESET_NAME_WIRE_BYTES} bytes (unverified; the file carries it as typed)"
        )
    if value != value.rstrip(" "):
        warnings.append(f"{where}: name {value!r} ends with spaces; the device trims trailing spaces on the wire")
    return None


def _slot(obj: Any, where: str, problems: list[str]) -> tuple[int, int] | None:
    if not isinstance(obj, dict):
        problems.append(f"{where}: expected {{bank, preset}}")
        return None
    bank, preset = obj.get("bank"), obj.get("preset")
    if not isinstance(bank, int) or isinstance(bank, bool) or not 0 <= bank < specs.ML10X_BANKS:
        problems.append(f"{where}: bank must be 0-{specs.ML10X_BANKS - 1} (got {bank!r})")
        return None
    if not isinstance(preset, int) or isinstance(preset, bool) or not 0 <= preset < specs.ML10X_PRESETS_PER_BANK:
        problems.append(f"{where}: preset must be 0-{specs.ML10X_PRESETS_PER_BANK - 1} (got {preset!r})")
        return None
    return bank, preset


def _slot_label(s: tuple[int, int]) -> str:
    return f"bank {s[0] + 1} preset {s[1]}"


# ----------------------------------------------------------------------------- the transaction


def _without_number(p: dict) -> dict:
    return {k: v for k, v in p.items() if k != "presetNumber"}


def _without_identity(p: dict) -> dict:
    return {k: v for k, v in p.items() if k not in ("presetNumber", "presetName")}


class _Txn:
    def __init__(self, data: dict, rule: _EmptyRule):
        self.data = data
        self.rule = rule
        self.problems: list[str] = []
        self.warnings: list[str] = []
        self.effects: list[dict] = []
        self.touched: set[tuple[int, int]] = set()
        self.connector_fields: set[tuple[int, str]] = set()

    def get(self, s: tuple[int, int]) -> dict:
        return self.data["presetData"][s[0]]["data"][s[1]]

    def put(self, s: tuple[int, int], payload: dict) -> None:
        payload["presetNumber"] = s[1]
        self.data["presetData"][s[0]]["data"][s[1]] = payload
        self.touched.add(s)

    def snapshot(self, s: tuple[int, int]) -> dict:
        p = self.get(s)
        occ = self.rule.describe(p)
        return {
            "bank": s[0],
            "preset": s[1],
            "name": p["presetName"],
            "occupancy": occ["state"],
            "reason": occ["reason"],
            "advanced": bool(p["advancedMode"]),
        }

    def apply(self, op: Any, n: int) -> None:
        where = f"operation {n}"
        if not isinstance(op, dict) or op.get("op") not in OPS:
            self.problems.append(f"{where}: op must be one of {', '.join(OPS)}")
            return
        kind = op["op"]
        handler = getattr(self, f"_{kind}")
        handler(op, where)

    # ---- rename
    def _rename(self, op: dict, where: str) -> None:
        s = _slot(op.get("slot"), f"{where} (rename)", self.problems)
        if s is None:
            return
        err = _name_problem(
            op.get("name"),
            f"{where} (rename {_slot_label(s)})",
            bool(op.get("accept_unverified_length")),
            self.warnings,
        )
        if err:
            self.problems.append(err)
            return
        p = self.get(s)
        before = self.snapshot(s)
        if op["name"] == p["presetName"]:
            self.warnings.append(f"{where}: {_slot_label(s)} is already named {op['name']!r}; nothing changes")
        if op["name"] == DEFAULT_PRESET_NAME and before["occupancy"] == "occupied":
            self.warnings.append(
                f"{where}: {_slot_label(s)} keeps its routing data but is now named {DEFAULT_PRESET_NAME!r}, the factory "
                "name of an unused slot; Signal Loom will still treat it as occupied"
            )
        before_payload = copy.deepcopy(p)
        p["presetName"] = op["name"]
        self.touched.add(s)
        only_name = {k: v for k, v in before_payload.items() if k != "presetName"} == {
            k: v for k, v in p.items() if k != "presetName"
        }
        self.effects.append(
            {
                "op": "rename",
                "slot": before,
                "after": self.snapshot(s),
                "name_before": before["name"],
                "verified": {"only_name_changed": only_name},
            }
        )

    # ---- copy
    def _copy(self, op: dict, where: str) -> None:
        src = _slot(op.get("source"), f"{where} (copy source)", self.problems)
        dst = _slot(op.get("destination"), f"{where} (copy destination)", self.problems)
        if src is None or dst is None:
            return
        if src == dst:
            self.problems.append(f"{where}: copy source and destination are the same slot ({_slot_label(src)})")
            return
        s_before, d_before = self.snapshot(src), self.snapshot(dst)
        if s_before["occupancy"] == "empty":
            self.warnings.append(
                f"{where}: {_slot_label(src)} is a factory-empty slot; copying it clears the destination"
            )
        if d_before["occupancy"] == "occupied" and op.get("overwrite") is not True:
            self.problems.append(
                f"{where}: {_slot_label(dst)} is occupied ({d_before['name']!r}: {d_before['reason']}); copying onto it "
                "would destroy that preset. Set overwrite to true after reviewing it, or pick another slot"
            )
            return
        self.put(dst, copy.deepcopy(self.get(src)))
        self.effects.append(
            {
                "op": "copy",
                "source": s_before,
                "destination": d_before,
                "after": self.snapshot(dst),
                "overwrote": d_before if d_before["occupancy"] == "occupied" else None,
                "verified": {"payload_identical": _without_number(self.get(dst)) == _without_number(self.get(src))},
            }
        )

    # ---- move
    def _move(self, op: dict, where: str) -> None:
        src = _slot(op.get("source"), f"{where} (move source)", self.problems)
        dst = _slot(op.get("destination"), f"{where} (move destination)", self.problems)
        if src is None or dst is None:
            return
        if src == dst:
            self.problems.append(f"{where}: move source and destination are the same slot ({_slot_label(src)})")
            return
        mode = op.get("on_occupied", "refuse")
        if mode not in ON_OCCUPIED:
            self.problems.append(f"{where}: on_occupied must be one of {', '.join(ON_OCCUPIED)} (got {mode!r})")
            return
        s_before, d_before = self.snapshot(src), self.snapshot(dst)
        if s_before["occupancy"] == "empty":
            self.problems.append(
                f"{where}: {_slot_label(src)} is a factory-empty slot; there is nothing to move (copy or swap instead)"
            )
            return
        if d_before["occupancy"] == "occupied":
            if mode == "refuse":
                self.problems.append(
                    f"{where}: {_slot_label(dst)} is occupied ({d_before['name']!r}: {d_before['reason']}). Choose "
                    "on_occupied 'swap' to exchange the two presets or 'overwrite' to replace it after reviewing it"
                )
                return
            if mode == "swap":
                self._do_swap(src, dst, s_before, d_before, where, via_move=True)
                return
        if self.rule.template is None:
            self.problems.append(
                f"{where}: cannot clear {_slot_label(src)} after the move — {self.rule.template_note}. "
                "Use copy (keeps the source) or swap instead"
            )
            return
        payload = self.get(src)
        fingerprint = compact_json(_without_number(payload))
        self.put(dst, payload)
        self.put(src, self.rule.cleared(payload))
        self.effects.append(
            {
                "op": "move",
                "source": s_before,
                "destination": d_before,
                "after": self.snapshot(dst),
                "source_after": self.snapshot(src),
                "overwrote": d_before if d_before["occupancy"] == "occupied" else None,
                "cleared_with": self.rule.template_note,
                "verified": {
                    "payload_identical": compact_json(_without_number(self.get(dst))) == fingerprint,
                    "source_cleared_with_file_template": _without_number(self.get(src))
                    == _without_number(self.rule.template),
                },
            }
        )

    # ---- swap
    def _swap(self, op: dict, where: str) -> None:
        a = _slot(op.get("a"), f"{where} (swap a)", self.problems)
        b = _slot(op.get("b"), f"{where} (swap b)", self.problems)
        if a is None or b is None:
            return
        if a == b:
            self.problems.append(f"{where}: swap needs two different slots (both are {_slot_label(a)})")
            return
        self._do_swap(a, b, self.snapshot(a), self.snapshot(b), where, via_move=False)

    def _do_swap(
        self, a: tuple[int, int], b: tuple[int, int], a_before: dict, b_before: dict, where: str, *, via_move: bool
    ) -> None:
        if a_before["occupancy"] == "empty" and b_before["occupancy"] == "empty":
            self.warnings.append(
                f"{where}: both {_slot_label(a)} and {_slot_label(b)} are factory-empty; the swap changes nothing"
            )
        pa, pb = self.get(a), self.get(b)
        fa, fb = compact_json(_without_number(pa)), compact_json(_without_number(pb))
        self.put(a, pb)
        self.put(b, pa)
        self.effects.append(
            {
                "op": "swap",
                "via": "move" if via_move else "swap",
                "a": a_before,
                "b": b_before,
                "a_after": self.snapshot(a),
                "b_after": self.snapshot(b),
                "verified": {
                    "a_holds_former_b": compact_json(_without_number(self.get(a))) == fb,
                    "b_holds_former_a": compact_json(_without_number(self.get(b))) == fa,
                },
            }
        )

    # ---- connector names
    def _rename_connector(self, op: dict, where: str) -> None:
        conns = self.data["controllerData"]["connectors"]
        idx = op.get("connector")
        field = op.get("field")
        value = op.get("value")
        if not isinstance(idx, int) or isinstance(idx, bool) or not 0 <= idx < len(conns):
            self.problems.append(f"{where}: connector must be 0-{len(conns) - 1} (got {idx!r})")
            return
        c = conns[idx]
        if not isinstance(c, dict) or any(k not in c for k in CONNECTOR_KEYS):
            self.problems.append(f"{where}: connector {idx} does not have the native connector shape; not edited")
            return
        if c.get("id") != idx:
            self.problems.append(
                f"{where}: connector at position {idx} carries id {c.get('id')!r}; identity unclear, not edited"
            )
            return
        if field not in CONNECTOR_FIELD_WIRE_BYTES:
            self.problems.append(
                f"{where}: field must be one of {', '.join(CONNECTOR_FIELD_WIRE_BYTES)} (got {field!r}); trails, MIDI "
                "channel, Device ID, Input Split and Loop Bypass Persist are read-only in this version"
            )
            return
        if not isinstance(value, str):
            self.problems.append(f"{where}: {field} must be a string")
            return
        cap = CONNECTOR_FIELD_WIRE_BYTES[field]
        if not _is_ascii_printable(value):
            self.problems.append(f"{where}: connector {field} must be printable ASCII (the wire field is 7-bit)")
            return
        if len(value) > cap:
            self.problems.append(
                f"{where}: connector {field} is {len(value)} characters; the device stores {cap} (nothing is truncated)"
            )
            return
        if field == "shortName" and not value.strip():
            self.warnings.append(f"{where}: connector {idx} gets a blank short name")
        before = c[field]
        c[field] = value
        self.connector_fields.add((idx, field))
        self.effects.append(
            {"op": "rename_connector", "connector": idx, "field": field, "before": before, "after": value}
        )


# ----------------------------------------------------------------------------- preservation checks


def _preservation_checks(original: dict, new: dict, txn: _Txn, rule: _EmptyRule) -> list[dict]:
    checks: list[dict] = []

    def add(name: str, ok: bool, detail: str) -> None:
        checks.append({"check": name, "ok": bool(ok), "detail": detail})

    # Untouched presets are identical objects.
    broken = []
    for bi in range(specs.ML10X_BANKS):
        for pi in range(specs.ML10X_PRESETS_PER_BANK):
            if (bi, pi) not in txn.touched and original["presetData"][bi]["data"][pi] != new["presetData"][bi]["data"][
                pi
            ]:
                broken.append(_slot_label((bi, pi)))
    add(
        "untouched_presets_identical",
        not broken,
        f"{specs.ML10X_BANKS * specs.ML10X_PRESETS_PER_BANK - len(txn.touched)} untouched presets compared"
        + (f"; differ: {', '.join(broken[:5])}" if broken else ""),
    )
    # Bank wrappers (bank numbers, unknown bank-level keys) unchanged.
    add(
        "bank_metadata_identical",
        all(
            {k: v for k, v in original["presetData"][bi].items() if k != "data"}
            == {k: v for k, v in new["presetData"][bi].items() if k != "data"}
            for bi in range(specs.ML10X_BANKS)
        ),
        "bank numbers and any other bank-level keys",
    )
    # Controller data unchanged except the renamed connector fields.
    oc, nc = original["controllerData"], new["controllerData"]
    ctrl_ok = {k: v for k, v in oc.items() if k != "connectors"} == {k: v for k, v in nc.items() if k != "connectors"}
    conn_ok = len(oc["connectors"]) == len(nc["connectors"])
    if conn_ok:
        for i, (a, b) in enumerate(zip(oc["connectors"], nc["connectors"], strict=True)):
            if not isinstance(a, dict) or not isinstance(b, dict):
                conn_ok = conn_ok and a == b
                continue
            for k in set(a) | set(b):
                if a.get(k) != b.get(k) and (i, k) not in txn.connector_fields:
                    conn_ok = False
    add(
        "controller_settings_identical",
        ctrl_ok and conn_ok,
        "MIDI channel, Device ID, Input Split, Loop Bypass Persist, inputRingSwapPin, trails and every connector field "
        + ("except the renamed ones" if txn.connector_fields else "")
        + " compared",
    )
    # Other data-level keys unchanged.
    add(
        "other_data_keys_identical",
        {k: v for k, v in original.items() if k not in ("presetData", "controllerData")}
        == {k: v for k, v in new.items() if k not in ("presetData", "controllerData")},
        "keys of data other than presetData / controllerData",
    )
    # Per-operation identity, verified when each operation was applied (so chains such as copy-then-rename
    # are judged against the state they acted on, not against the original file).
    for i, e in enumerate(txn.effects, start=1):
        for name, ok in e.get("verified", {}).items():
            add(f"op{i}_{e['op']}_{name}", ok, _effect_detail(e))
    # Final state: every touched slot holds a payload that existed in the input (or the file's factory-empty
    # payload), compared without its name, carries a name that either existed in the input or was set by an
    # explicit rename, and has presetNumber equal to its position. Proposals never invent preset content.
    originals_nameless = {compact_json(_without_identity(p)) for b in original["presetData"] for p in b["data"]}
    allowed_names = {p["presetName"] for b in original["presetData"] for p in b["data"]}
    if rule.template is not None:
        originals_nameless.add(compact_json(_without_identity(rule.template)))
        allowed_names.add(rule.template["presetName"])
    allowed_names.update(e["after"]["name"] for e in txn.effects if e["op"] == "rename")
    invented = []
    for s in sorted(txn.touched):
        p = new["presetData"][s[0]]["data"][s[1]]
        if compact_json(_without_identity(p)) not in originals_nameless or p["presetName"] not in allowed_names:
            invented.append(_slot_label(s))
        if p["presetNumber"] != s[1]:
            invented.append(f"{_slot_label(s)} (presetNumber {p['presetNumber']})")
    add(
        "no_preset_content_invented",
        not invented,
        f"{len(txn.touched)} touched slot(s) hold only payloads that existed in the input (or the file's factory-empty "
        "payload), names from the input or an explicit rename, and presetNumber equal to their position"
        + (f"; unexpected: {', '.join(invented[:5])}" if invented else ""),
    )
    return checks


def _effect_detail(e: dict) -> str:
    if e["op"] == "rename":
        return f"{_slot_label((e['slot']['bank'], e['slot']['preset']))}: every field but presetName identical"
    if e["op"] in ("copy", "move"):
        src = (e["source"]["bank"], e["source"]["preset"])
        dst = (e["destination"]["bank"], e["destination"]["preset"])
        return (
            f"{_slot_label(src)} → {_slot_label(dst)}: matrixArray, advancedMode, bypass, tipT, ringT, name and unknown "
            "keys identical" + ("; source cleared with the file's factory-empty payload" if e["op"] == "move" else "")
        )
    if e["op"] == "swap":
        a, b = (e["a"]["bank"], e["a"]["preset"]), (e["b"]["bank"], e["b"]["preset"])
        return f"{_slot_label(a)} ↔ {_slot_label(b)}: both complete payloads exchanged"
    return ""


# ----------------------------------------------------------------------------- public API


def suggested_filename(when: datetime) -> str:
    """Editor-like name (one forum sample of the editor's convention) marked as a Signal Loom candidate."""
    return f"Morningstar_ML10X_Backup_File_{when.strftime('%Y%m%d_%H%M%S')}_signal-loom-candidate.json"


def slot_map(raw: str) -> dict:
    """Occupancy of every slot as the proposal layer sees it (for the UI), plus the empty-slot rule status."""
    native = load_native(raw)
    out: dict[str, Any] = {"ok": False, "problems": list(native["problems"]), "slots": [], "empty_rule": None}
    if not native["ok"]:
        return out
    problems = structure_problems(native["data"])
    if problems:
        out["problems"].extend(problems)
        return out
    rule = _EmptyRule(native["data"])
    for b in native["data"]["presetData"]:
        for p in b["data"]:
            occ = rule.describe(p)
            out["slots"].append(
                {
                    "bank": b["bank"],
                    "preset": p["presetNumber"],
                    "name": p["presetName"],
                    "occupancy": occ["state"],
                    "reason": occ["reason"],
                    "advanced": bool(p["advancedMode"]),
                }
            )
    out["empty_rule"] = {"template_available": rule.template is not None, "note": rule.template_note}
    out["ok"] = True
    return out


def propose(raw: str, operations: list | None = None, *, now: datetime | None = None) -> dict:
    """Apply a transaction of typed, routing-free operations to an ML10X Device Backup.

    Refused (no file produced) when the input is not a verifiable, structurally sound ML10X "full" backup
    of schema 1, or when any operation is invalid, ambiguous or would destroy a preset without explicit
    intent. Without operations (or with operations that change nothing) the output text is the input,
    byte for byte. Otherwise the output carries the complete native data with the edits, a fresh
    ``downloadDate`` and a recomputed hash; ``deviceModel``, ``dumpType`` and ``schemaVersion`` are left
    as read (only the supported values reach this point).
    """
    native = load_native(raw)
    out: dict[str, Any] = {
        "ok": False,
        "problems": list(native["problems"]),
        "warnings": [],
        "text": None,
        "filename": None,
        "diff": {"changes": [], "total": 0, "metadata": {}},
        "effects": [],
        "slots": [],
        "self_check": None,
        "preservation": [],
        "preserved": None,
        "identity": None,
        "evidence": EVIDENCE,
        "operations_applied": 0,
    }
    if out["problems"]:
        return out
    if native["dump_type"] != SUPPORTED_DUMP_TYPE:
        out["problems"].append(
            f"dumpType {native['dump_type']!r} is not the one real ML10X backup shape ({SUPPORTED_DUMP_TYPE!r}); its "
            "restore semantics are unknown, so no proposal is produced (inspection still works)"
        )
    if native["schema_version"] != SUPPORTED_SCHEMA_VERSION:
        out["problems"].append(
            f"schemaVersion {native['schema_version']!r} is not the supported {SUPPORTED_SCHEMA_VERSION}; Signal Loom "
            f"will not rewrite it as schema {SUPPORTED_SCHEMA_VERSION} (inspection still works)"
        )
    if native["hash"] is None:
        out["problems"].append(
            "integrity hash missing: the file cannot be verified, so no proposal is produced (inspection still works)"
        )
    elif native["hash_matches"] is False:
        out["problems"].append(
            "integrity hash mismatch: the data section does not match the file's hash (edited by hand or written by "
            "another serializer); Signal Loom does not re-hash an unverifiable input into a proposal (inspection still works)"
        )
    if out["problems"]:
        return out
    out["problems"].extend(structure_problems(native["data"]))
    if out["problems"]:
        out["problems"].insert(0, "bank/preset structure differs from the real backup; editing would be unreliable")
        return out
    operations = operations or []
    if len(operations) > MAX_OPERATIONS:
        out["problems"].append(f"at most {MAX_OPERATIONS} operations per proposal")
        return out
    original = native["data"]
    data = copy.deepcopy(original)
    rule = _EmptyRule(data)
    txn = _Txn(data, rule)
    for n, op in enumerate(operations, start=1):
        txn.apply(op, n)
    out["warnings"].extend(txn.warnings)
    if txn.problems:
        out["problems"].extend(txn.problems)
        out["problems"].append("the proposal is one transaction: nothing was applied and no file is produced")
        return out
    out["operations_applied"] = len(operations)
    out["effects"] = txn.effects
    changes = diff_objects(original, data, root="data")
    when = now or datetime.now(UTC)
    stamp = when.strftime("%Y-%m-%dT%H:%M:%S.") + f"{when.microsecond // 1000:03d}Z"
    if not changes:
        text = raw  # the no-op round trip is the input itself, byte for byte
        dump = json.loads(raw)
        out["diff"]["metadata"] = {
            "download_date": {"before": native["download_date"], "after": native["download_date"]},
            "hash": {"before": native["hash"], "after": native["hash"]},
        }
        out["warnings"].append("no operation changed anything: the candidate file is the original, byte for byte")
    else:
        dump = json.loads(raw)  # keeps unknown top-level keys and their order
        dump["data"] = data
        dump["deviceModel"] = specs.ML10X_EXPORT_DEVICE_MODEL
        dump["dumpType"] = SUPPORTED_DUMP_TYPE
        dump["downloadDate"] = stamp
        dump["hash"] = java_string_hash(compact_json(data))
        text = compact_json(dump)
        out["diff"]["metadata"] = {
            "download_date": {"before": native["download_date"], "after": stamp},
            "hash": {"before": native["hash"], "after": dump["hash"]},
        }
    out["diff"]["changes"] = changes
    out["diff"]["total"] = len(changes)
    # Self-check: the candidate must load as a verifiable ML10X backup with the same structure.
    check = load_native(text)
    self_problems = list(check["problems"])
    if check["ok"]:
        self_problems.extend(structure_problems(check["data"]))
        if check["hash_matches"] is not True:
            self_problems.append("recomputed hash does not verify")
        if check["device_model"] != specs.ML10X_EXPORT_DEVICE_MODEL or check["dump_type"] != SUPPORTED_DUMP_TYPE:
            self_problems.append("device model or dump type changed")
    out["self_check"] = {"ok": not self_problems, "problems": self_problems, "hash_matches": check.get("hash_matches")}
    out["preservation"] = _preservation_checks(original, data, txn, rule)
    failed = [c["check"] for c in out["preservation"] if not c["ok"]]
    if self_problems or failed:
        out["problems"].append("self-verification failed; no file is produced: " + "; ".join(self_problems + failed))
        return out
    unknown_before = len(_unknown_key_listing(raw))
    unknown_after = len(_unknown_key_listing(text))
    touched = sorted(txn.touched)
    out["slots"] = [
        {
            "bank": s[0],
            "preset": s[1],
            "before": _slot_summary(original["presetData"][s[0]]["data"][s[1]], rule),
            "after": _slot_summary(data["presetData"][s[0]]["data"][s[1]], rule),
            "fields_changed": sorted(
                k
                for k in set(original["presetData"][s[0]]["data"][s[1]]) | set(data["presetData"][s[0]]["data"][s[1]])
                if original["presetData"][s[0]]["data"][s[1]].get(k) != data["presetData"][s[0]]["data"][s[1]].get(k)
            ),
        }
        for s in touched
    ]
    out["preserved"] = {
        "untouched_presets": specs.ML10X_BANKS * specs.ML10X_PRESETS_PER_BANK - len(touched),
        "touched_presets": len(touched),
        "unknown_keys_before": unknown_before,
        "unknown_keys_after": unknown_after,
        "routing_fields_authored": 0,
        "byte_identical_to_input": text == raw,
        "structurally_identical_to_input": not changes,
    }
    out["identity"] = {
        "device_model": dump.get("deviceModel"),
        "dump_type": dump.get("dumpType"),
        "schema_version": dump.get("schemaVersion"),
        "download_date": dump.get("downloadDate"),
        "hash": dump.get("hash"),
        "presets": specs.ML10X_BANKS * specs.ML10X_PRESETS_PER_BANK,
        "size_bytes": len(text.encode("utf-8")),
    }
    out["text"] = text
    out["filename"] = suggested_filename(when)
    out["warnings"].append(
        "Candidate ML10X Device Backup: not yet loaded in the official Morningstar editor and not restored to any "
        "device. The hash algorithm is reproduced on one real backup. A 'full' backup restore may replace all 512 "
        "presets and the controller settings; keep the untouched original as the recovery baseline."
    )
    out["ok"] = True
    return out


def _slot_summary(p: dict, rule: _EmptyRule) -> dict:
    occ = rule.describe(p)
    return {
        "name": p["presetName"],
        "occupancy": occ["state"],
        "reason": occ["reason"],
        "advanced": bool(p["advancedMode"]),
        "matrix_rows_with_data": sum(1 for v in p["matrixArray"].values() if any(v)),
        "bypass": p["bypass"],
        "spillover": [p["tipT"], p["ringT"]],
        "unknown_keys": sorted(k for k in p if k not in PRESET_KEYS),
    }


def _unknown_key_listing(text: str) -> list[dict]:
    from .ml10x_native import inspect  # local import to keep module import order simple

    rep = inspect(text)
    return list(rep["native"].get("unknown_keys") or [])
