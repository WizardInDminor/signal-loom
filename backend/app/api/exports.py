from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse, Response

from ..analysis import analyze
from ..domain.wiring import wiring_diagnostics
from ..exports.text import (
    mc8_switch_map_csv,
    mc8_switch_map_markdown,
    scene_report_markdown,
    wiring_manifest_csv,
    wiring_manifest_markdown,
)
from ..models.rig import Mc8Bank
from ..morningstar import specs
from ..morningstar.backup_diff import diff_backups
from ..morningstar.mc8_export import (
    bank_dump_to_plan,
    build_single_bank_dump,
    check_dump,
    serialize,
    suggested_filename,
)
from ..morningstar.ml10x_backup import read_backup
from .deps import load_rig, profiles_for, rig_repo

router = APIRouter(prefix="/api/rigs", tags=["exports"])

EXPORT_STATUS = {
    "signal_loom_project": {
        "level": "fixture_validated",
        "available": True,
        "note": "Round-trip tested by automated tests (export -> import -> normalized compare).",
    },
    "wiring_manifest": {"level": "n/a", "available": True, "note": "Human-readable; CSV and Markdown."},
    "scene_report": {"level": "n/a", "available": True, "note": "Human-readable Markdown."},
    "mc8_switch_map": {"level": "n/a", "available": True, "note": "CSV, Markdown and JSON."},
    "mc8_bank_backup": {
        "level": "fixture_validated",
        "available": True,
        "note": "Shape, codes and integrity hash reproduced from three real MC8 editor bank/all-banks exports "
        "(third-party public files). NOT editor-validated, NOT hardware-validated. Only singleBank files "
        "(PC/CC messages) are produced; restoring one replaces that bank only. Back up your MC8 first. "
        "Refused while any error-level diagnostic (board, wiring, ML10X, MIDI or compile) exists on the rig.",
    },
    "ml10x_native": {
        "level": "blocked",
        "available": False,
        "note": "The ML10X editor backup's routing field (matrixArray) is undecoded and its hash is undocumented. "
        "Signal Loom will not write a file it cannot validate. Use the scene report to program presets in the "
        "Morningstar editor; a user-supplied backup can be inspected read-only.",
    },
}


def native_export_blockers(analysis: dict, bank_plan: dict) -> list[dict]:
    """Every error-level diagnostic on the rig blocks a native export, not only compile errors.

    A switch plan can compile cleanly while a loop return cable is missing or two devices
    collide; a file produced in that state would encode a configuration the physical rig
    cannot honour. The UI promises "N errors; native export is refused", so the exporter
    enforces exactly that: board + wiring + ML10X + MIDI diagnostics, the rig-level compile
    diagnostics, and the bank's own switch diagnostics.
    """
    seen: set[tuple] = set()
    out: list[dict] = []

    def add(d: dict) -> None:
        if d.get("severity") != "error":
            return
        key = (d.get("code"), d.get("subject_id"), d.get("message"))
        if key not in seen:
            seen.add(key)
            out.append(d)

    for d in analysis["diagnostics"]:
        add(d)
    for d in analysis["compiled"]["diagnostics"]:
        add(d)
    for d in bank_plan["diagnostics"]:
        add(d)
    for sw in bank_plan["switches"]:
        for d in sw["diagnostics"]:
            add(d)
    return out


@router.get("/{rig_id}/exports/status")
def export_status(rig_id: str, request: Request):
    load_rig(request, rig_id)
    return EXPORT_STATUS


@router.get("/{rig_id}/exports/wiring.md", response_class=PlainTextResponse)
def wiring_md(rig_id: str, request: Request):
    rig = load_rig(request, rig_id)
    profiles = profiles_for(request, rig)
    ctx, diags = wiring_diagnostics(rig, profiles)
    return wiring_manifest_markdown(rig, profiles, ctx, diags)


@router.get("/{rig_id}/exports/wiring.csv")
def wiring_csv(rig_id: str, request: Request):
    rig = load_rig(request, rig_id)
    return Response(
        wiring_manifest_csv(rig, profiles_for(request, rig)),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{rig.name}-wiring.csv"'},
    )


@router.get("/{rig_id}/exports/scenes.md", response_class=PlainTextResponse)
def scenes_md(rig_id: str, request: Request):
    rig = load_rig(request, rig_id)
    a = analyze(rig, profiles_for(request, rig))
    return scene_report_markdown(rig, a["compiled"])


@router.get("/{rig_id}/exports/mc8-switch-map.csv")
def switch_map_csv(rig_id: str, request: Request):
    rig = load_rig(request, rig_id)
    a = analyze(rig, profiles_for(request, rig))
    return Response(
        mc8_switch_map_csv(a["compiled"]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{rig.name}-mc8-switch-map.csv"'},
    )


@router.get("/{rig_id}/exports/mc8-switch-map.md", response_class=PlainTextResponse)
def switch_map_md(rig_id: str, request: Request):
    rig = load_rig(request, rig_id)
    a = analyze(rig, profiles_for(request, rig))
    return mc8_switch_map_markdown(rig, a["compiled"])


@router.get("/{rig_id}/exports/compiled.json")
def compiled_json(rig_id: str, request: Request):
    rig = load_rig(request, rig_id)
    a = analyze(rig, profiles_for(request, rig))
    return a["compiled"]


@router.get("/{rig_id}/exports/mc8-bank/{bank_number}")
def mc8_bank_backup(rig_id: str, bank_number: int, request: Request, download: bool = False):
    """Morningstar editor 'Bank Backup' JSON (fixture-validated shape). Refuses on compile errors."""
    rig = load_rig(request, rig_id)
    a = analyze(rig, profiles_for(request, rig))
    bank_plan = next((b for b in a["compiled"]["mc8"]["banks"] if b["number"] == bank_number), None)
    if bank_plan is None:
        raise HTTPException(status_code=404, detail=f"Bank {bank_number} is not configured")
    blocking = native_export_blockers(a, bank_plan)
    if blocking:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "The rig has error-level diagnostics; the native export is refused until they are fixed.",
                "diagnostics": blocking,
            },
        )
    dump, diags = build_single_bank_dump(
        bank_plan, description=f"Signal Loom export of '{rig.name}' bank {bank_number}"
    )
    errors = [d.model_dump(mode="json") for d in diags if d.severity.value == "error"]
    if errors:
        raise HTTPException(status_code=409, detail={"message": "Export refused.", "diagnostics": errors})
    body = serialize(dump)
    if download:
        return Response(
            body,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{suggested_filename(bank_plan["name"])}"'},
        )
    return {
        "filename": suggested_filename(bank_plan["name"]),
        "evidence_level": EXPORT_STATUS["mc8_bank_backup"]["level"],
        "warning": EXPORT_STATUS["mc8_bank_backup"]["note"],
        "self_check": check_dump(body),
        "dump": dump,
        "limits": {"messages_per_preset": specs.MC8_MESSAGES_PER_PRESET},
    }


@router.post("/inspect/mc8-backup")
async def inspect_mc8_backup(request: Request):
    raw = await request.body()
    return check_dump(raw.decode("utf-8", errors="replace"))


@router.post("/inspect/ml10x-backup")
async def inspect_ml10x_backup(request: Request):
    raw = await request.body()
    return read_backup(raw.decode("utf-8", errors="replace"))


@router.post("/inspect/backup-diff")
async def inspect_backup_diff(request: Request):
    """Compare two editor backups (JSON body: {"a": "<file text>", "b": "<file text>"})."""
    body = await request.json()
    if not isinstance(body, dict) or not isinstance(body.get("a"), str) or not isinstance(body.get("b"), str):
        raise HTTPException(status_code=422, detail='Body must be {"a": <text of backup A>, "b": <text of backup B>}')
    return diff_backups(body["a"], body["b"])


@router.post("/{rig_id}/import/mc8-bank")
async def import_mc8_bank(rig_id: str, request: Request, replace: bool = False):
    """Import an MC8 editor 'Current Bank' backup into this rig's MC8 plan as explicit PC/CC messages.

    The bank is added (or replaces the bank with the same number when ``replace`` is true).
    Nothing is mapped to scenes: the messages become ``extra_messages`` so the round trip to
    the bank-backup export is lossless for PC/CC content and visible in the switch map.
    """
    rig = load_rig(request, rig_id)
    raw = (await request.body()).decode("utf-8", errors="replace")
    result = bank_dump_to_plan(raw)
    if not result["ok"]:
        raise HTTPException(
            status_code=422, detail={"message": "Not an importable MC8 bank backup.", "problems": result["problems"]}
        )
    bank = Mc8Bank.model_validate(result["bank"])
    existing = next((b for b in rig.controllers.mc8.banks if b.number == bank.number), None)
    if existing is not None and not replace:
        used = {b.number for b in rig.controllers.mc8.banks}
        n = bank.number
        while n in used:
            n += 1
        bank.number = n
    if existing is not None and replace:
        rig.controllers.mc8.banks = [b for b in rig.controllers.mc8.banks if b.number != bank.number]
    rig.controllers.mc8.banks.append(bank)
    rig.revision += 1
    saved = rig_repo(request).save(rig)
    return {
        "rig": saved.model_dump(mode="json"),
        "bank_number": bank.number,
        "imported_presets": len(bank.presets),
        "skipped": result["skipped"],
    }
