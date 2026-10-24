"""Morningstar Bridge API (Session 7): stateless, request-scoped, offline.

Every endpoint takes the backup file's text in the request and returns a report. Nothing is stored and
nothing is sent to a controller. The only files produced are an MC8 ``singleBank`` proposal and, since the
ML10X Native Integration V2 slice, a *candidate* ML10X Device Backup whose routing data is carried verbatim
(``app/morningstar/ml10x_propose.py``). The three layers of the bridge (native snapshot, interpreted
configuration, proposed modification) are documented in ``app/morningstar/mc8_native.py``.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..analysis import analyze
from ..morningstar import mc8_native, ml10x_native, ml10x_propose, specs
from ..morningstar.backup_diff import diff_backups
from .deps import load_rig, profiles_for

router = APIRouter(prefix="/api/morningstar", tags=["morningstar-bridge"])

BRIDGE_STATUS: dict[str, dict[str, Any]] = {
    "mc8_inspect": {
        "level": "fixture_validated",
        "available": True,
        "note": "Native snapshot + interpretation of singleBank and allBanks files. Shape, codes 0/1/2 and the hash "
        "reproduced on three real editor exports. Other message types are named from a third-party enum and preserved.",
    },
    "mc8_compare": {
        "level": "fixture_validated",
        "available": True,
        "note": "Controller bank vs the rig's compiled MC8 plan, both rendered in the editor's vocabulary.",
    },
    "mc8_propose": {
        "level": "fixture_validated",
        "available": True,
        "note": "Edits on an allow-list of known fields; singleBank output only; unsupported and unknown content "
        "preserved verbatim. NOT editor-validated, NOT hardware-validated.",
    },
    "ml10x_inspect": {
        "level": "third_party_shape",
        "available": True,
        "note": "One real backup seen. Hash algorithm reproduced on it (1 sample). Routing matrix undecoded: "
        "preserved as opaque data with row observations only.",
    },
    "ml10x_propose": {
        "level": "third_party_shape",
        "available": True,
        "note": "Routing-free, whole-preset operations (rename, copy, move, swap, connector names) on a verified "
        "Device Backup; matrixArray/bypass/spillover/mode carried verbatim, hash recomputed. Output is a CANDIDATE: "
        "NOT editor-validated, NOT hardware-validated.",
    },
    "ml10x_native_export": {
        "level": "blocked",
        "available": False,
        "note": "Routing authorship: matrixArray undecoded, so Signal Loom never writes new routing, bypass or "
        "spillover values into an ML10X file.",
    },
    "hardware": {
        "level": "n/a",
        "available": False,
        "note": "No SysEx, no firmware, no controller programming. The official editors stay authoritative.",
    },
}


class CompareBody(BaseModel):
    file: str = Field(min_length=1)
    rig_id: str
    bank_number: int | None = Field(default=None, ge=1, le=specs.MC8_BANKS)  # Signal Loom bank number
    bank_index: int | None = Field(default=None, ge=0, le=specs.MC8_BANKS - 1)  # index inside an allBanks file


class ProposeBody(BaseModel):
    file: str = Field(min_length=1)
    bank_index: int | None = Field(default=None, ge=0, le=specs.MC8_BANKS - 1)
    edits: list[dict] = Field(default_factory=list, max_length=2000)


class PairBody(BaseModel):
    a: str
    b: str


# ---------------------------------------------------------------------------- ML10X proposal contract


class Ml10xSlot(BaseModel):
    bank: int = Field(ge=0, le=specs.ML10X_BANKS - 1)
    preset: int = Field(ge=0, le=specs.ML10X_PRESETS_PER_BANK - 1)


class Ml10xRenameOp(BaseModel):
    op: Literal["rename"]
    slot: Ml10xSlot
    name: str
    accept_unverified_length: bool = False  # keep a 13-16 character name as typed (device stores 12 bytes)


class Ml10xCopyOp(BaseModel):
    op: Literal["copy"]
    source: Ml10xSlot
    destination: Ml10xSlot
    overwrite: bool = False  # required when the destination is occupied


class Ml10xMoveOp(BaseModel):
    op: Literal["move"]
    source: Ml10xSlot
    destination: Ml10xSlot
    on_occupied: Literal["refuse", "swap", "overwrite"] = "refuse"


class Ml10xSwapOp(BaseModel):
    op: Literal["swap"]
    a: Ml10xSlot
    b: Ml10xSlot


class Ml10xConnectorNameOp(BaseModel):
    op: Literal["rename_connector"]
    connector: int = Field(ge=0, le=ml10x_native.EXPECTED_CONNECTORS - 1)
    field: Literal["name", "shortName", "inputName", "outputName"]
    value: str


Ml10xOperation = Annotated[
    Ml10xRenameOp | Ml10xCopyOp | Ml10xMoveOp | Ml10xSwapOp | Ml10xConnectorNameOp, Field(discriminator="op")
]


class Ml10xProposeBody(BaseModel):
    file: str = Field(min_length=1)
    operations: list[Ml10xOperation] = Field(default_factory=list, max_length=ml10x_propose.MAX_OPERATIONS)


@router.get("/status")
def status():
    return BRIDGE_STATUS


@router.post("/inspect")
async def inspect(request: Request):
    """Auto-detect the device model of an editor backup and return native + interpreted + coverage."""
    raw = (await request.body()).decode("utf-8", errors="replace")
    native = mc8_native.load_native(raw)
    model = native["device_model"]
    if model == specs.MC8_EXPORT_DEVICE_MODEL:
        return mc8_native.inspect(raw)
    if model == specs.ML10X_EXPORT_DEVICE_MODEL:
        return ml10x_native.inspect(raw)
    report = {k: v for k, v in native.items() if k != "data"}
    if not any("deviceModel" in p for p in report["problems"]) and model is not None:
        report["problems"].append(f"deviceModel {model!r} is neither the MC8 (4) nor the ML10X (7)")
    report["ok"] = False
    return {"device": None, "native": report, "interpreted": None, "coverage": None}


@router.post("/mc8/compare")
def compare(body: CompareBody, request: Request):
    """Native MC8 bank vs the rig's modeled intent (its compiled MC8 plan for that bank)."""
    rig = load_rig(request, body.rig_id)
    native = mc8_native.load_native(body.file)
    if not native["ok"] or native["device_model"] != specs.MC8_EXPORT_DEVICE_MODEL:
        raise HTTPException(
            status_code=422, detail={"message": "Not an MC8 editor backup.", "problems": native["problems"]}
        )
    banks = mc8_native.native_banks(native)
    if native["dump_type"] == "allBanks":
        if body.bank_index is None or body.bank_index >= len(banks):
            raise HTTPException(status_code=422, detail={"message": "bank_index is required for an allBanks file."})
        native_bank = banks[body.bank_index]
    else:
        native_bank = banks[0]
    a = analyze(rig, profiles_for(request, rig))
    wanted = body.bank_number
    if wanted is None and isinstance(native_bank.get("bankNumber"), int):
        wanted = native_bank["bankNumber"] + 1
    plan = next((b for b in a["compiled"]["mc8"]["banks"] if b["number"] == wanted), None)
    if plan is None:
        raise HTTPException(
            status_code=404,
            detail={
                "message": f"The rig has no MC8 bank {wanted}.",
                "available_banks": [b["number"] for b in a["compiled"]["mc8"]["banks"]],
            },
        )
    report = mc8_native.compare_bank_to_plan(native_bank, plan)
    report["rig"] = {"id": rig.id, "name": rig.name, "bank_number": plan["number"], "bank_name": plan["name"]}
    return report


@router.post("/mc8/propose")
def propose(body: ProposeBody):
    """Apply allow-listed edits to one bank and return a reviewable, self-checked singleBank file."""
    result = mc8_native.propose(body.file, body.edits, body.bank_index)
    if not result["ok"]:
        raise HTTPException(
            status_code=422,
            detail={"message": "Proposal refused.", "problems": result["problems"], "warnings": result["warnings"]},
        )
    return result


@router.post("/ml10x/slots")
async def ml10x_slots(request: Request):
    """Occupancy of all 512 slots as the proposal layer judges it (structural empty-slot rule)."""
    raw = (await request.body()).decode("utf-8", errors="replace")
    report = ml10x_propose.slot_map(raw)
    if not report["ok"]:
        raise HTTPException(
            status_code=422, detail={"message": "Not an editable ML10X backup.", "problems": report["problems"]}
        )
    return report


@router.post("/ml10x/propose")
def ml10x_propose_endpoint(body: Ml10xProposeBody):
    """One transaction of typed, routing-free operations on an ML10X Device Backup → a reviewable candidate file.

    Refused as a whole (422, no file) when the input is not a verifiable ML10X "full" backup of schema 1 or when
    any operation is invalid, ambiguous or would overwrite a preset without explicit intent. Stateless: nothing
    is stored, nothing reaches a device.
    """
    result = ml10x_propose.propose(body.file, [op.model_dump() for op in body.operations])
    if not result["ok"]:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Proposal refused.",
                "ok": False,
                "problems": result["problems"],
                "warnings": result["warnings"],
                "effects": result["effects"],
                "evidence": result["evidence"],
            },
        )
    return result


@router.post("/ml10x/matrix-diff")
def matrix_diff(body: PairBody):
    """Controlled-experiment helper for two ML10X backups (see ml10x_native.matrix_differential)."""
    report = ml10x_native.matrix_differential(body.a, body.b)
    if not report["ok"]:
        raise HTTPException(
            status_code=422, detail={"message": "Not two ML10X backups.", "problems": report["problems"]}
        )
    report["structural"] = diff_backups(body.a, body.b)["summary"]
    return report
