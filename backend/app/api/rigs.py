from __future__ import annotations

import copy

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..catalog.demo import demo_rig
from ..domain.geometry import rotated_size
from ..exports.project import ProjectImportError, export_project, parse_project
from ..models.common import new_id
from ..models.rig import PreviewDevice, ProjectFile, Rig, RigPreview, RigSummary, utcnow_iso
from .deps import load_rig, profile_repo, profiles_for, rig_repo

router = APIRouter(prefix="/api/rigs", tags=["rigs"])


class RigCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    board_width_mm: float = Field(default=600, gt=0, le=5000)
    board_depth_mm: float = Field(default=300, gt=0, le=5000)
    from_demo: bool = False


class RenameBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None


def rig_preview(rig: Rig, profiles) -> RigPreview:
    """A true-scale miniature of the board for the rig library: enclosures only, at their real size."""
    devices = []
    for inst in rig.instances:
        prof = profiles.get(inst.profile_id)
        w, h, placeholder = rotated_size(prof, inst.rotation)
        devices.append(
            PreviewDevice(
                x_mm=inst.x_mm,
                y_mm=inst.y_mm,
                width_mm=w,
                height_mm=h,
                category=prof.category.value if prof else "other",
                off_board=inst.off_board,
                placeholder=placeholder,
            )
        )
    return RigPreview(
        width_mm=rig.board.width_mm, depth_mm=rig.board.depth_mm, devices=devices, cable_count=len(rig.connections)
    )


@router.get("", response_model=list[RigSummary])
def list_rigs(request: Request):
    repo = rig_repo(request)
    summaries = repo.list()
    for s in summaries:
        rig = repo.get(s.id)
        if rig is not None:
            s.preview = rig_preview(rig, profiles_for(request, rig))
    return summaries


@router.post("", response_model=Rig, status_code=201)
def create_rig(body: RigCreate, request: Request):
    if body.from_demo:
        rig = demo_rig()
        rig.id = new_id("rig")
        rig.name = body.name
        rig.created_at = rig.updated_at = utcnow_iso()
    else:
        rig = Rig(name=body.name, description=body.description)
        rig.board.width_mm = body.board_width_mm
        rig.board.depth_mm = body.board_depth_mm
    return rig_repo(request).save(rig)


@router.get("/{rig_id}", response_model=Rig)
def get_rig(rig_id: str, request: Request):
    return load_rig(request, rig_id)


@router.put("/{rig_id}", response_model=Rig)
def put_rig(rig_id: str, rig: Rig, request: Request):
    """Replace the whole rig document (the UI saves the single underlying model)."""
    repo = rig_repo(request)
    existing = repo.get(rig_id)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Rig '{rig_id}' not found")
    if rig.id != rig_id:
        raise HTTPException(status_code=400, detail="Rig id in body does not match URL")
    if rig.revision < existing.revision:
        # A save that was overtaken by a newer one (or another tab) must not win.
        raise HTTPException(
            status_code=409,
            detail={
                "code": "stale_revision",
                "message": f"Rig revision {rig.revision} is older than the stored revision {existing.revision}; reload before editing.",
                "stored_revision": existing.revision,
            },
        )
    rig.created_at = existing.created_at
    _validate_references(rig)
    return repo.save(rig)


def _validate_references(rig: Rig) -> None:
    ids = {i.id for i in rig.instances}
    if len(ids) != len(rig.instances):
        raise HTTPException(status_code=422, detail="Duplicate device instance ids")
    conn_ids = [c.id for c in rig.connections]
    if len(set(conn_ids)) != len(conn_ids):
        raise HTTPException(status_code=422, detail="Duplicate connection ids")
    scene_ids = [s.id for s in rig.scenes]
    if len(set(scene_ids)) != len(scene_ids):
        raise HTTPException(status_code=422, detail="Duplicate scene ids")
    for c in rig.connections:
        if c.source.instance_id not in ids or c.target.instance_id not in ids:
            raise HTTPException(status_code=422, detail=f"Connection {c.id} refers to a device that is not on the rig")


@router.patch("/{rig_id}", response_model=Rig)
def rename_rig(rig_id: str, body: RenameBody, request: Request):
    rig = load_rig(request, rig_id)
    rig.name = body.name
    if body.description is not None:
        rig.description = body.description
    return rig_repo(request).save(rig)


@router.delete("/{rig_id}", status_code=204)
def delete_rig(rig_id: str, request: Request):
    if not rig_repo(request).delete(rig_id):
        raise HTTPException(status_code=404, detail=f"Rig '{rig_id}' not found")
    return None


@router.post("/{rig_id}/duplicate", response_model=Rig, status_code=201)
def duplicate_rig(rig_id: str, request: Request):
    rig = load_rig(request, rig_id)
    copy_rig = copy.deepcopy(rig)
    copy_rig.id = new_id("rig")
    copy_rig.name = f"{rig.name} (copy)"
    copy_rig.revision = 0
    copy_rig.created_at = copy_rig.updated_at = utcnow_iso()
    return rig_repo(request).save(copy_rig)


@router.get("/{rig_id}/export", response_model=ProjectFile)
def export_rig(rig_id: str, request: Request):
    rig = load_rig(request, rig_id)
    return export_project(rig, profiles_for(request, rig))


class ImportResult(BaseModel):
    rig: Rig
    warnings: list[str]
    imported_profiles: list[str]


@router.post("/import", response_model=ImportResult, status_code=201)
async def import_rig(request: Request, keep_id: bool = False, name: str | None = None):
    raw = await request.body()
    try:
        project, warnings = parse_project(raw)
    except ProjectImportError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    repo = rig_repo(request)
    prof_repo = profile_repo(request)
    imported: list[str] = []
    from ..models.profile import DeviceProfile

    for p in project.profiles:
        prof = DeviceProfile.model_validate(p)
        src = prof_repo.source_of(prof.id)
        if src is None:
            prof.builtin = False
            prof_repo.save(prof, source="imported")
            imported.append(prof.id)
        # Never overwrite an existing profile on import; the user's library wins.
    rig = project.rig
    if not keep_id or repo.exists(rig.id):
        rig.id = new_id("rig")
    if name:
        rig.name = name
    rig.revision = 0
    rig.created_at = rig.updated_at = utcnow_iso()
    return ImportResult(rig=repo.save(rig, touch=False), warnings=warnings, imported_profiles=imported)
