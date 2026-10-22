from __future__ import annotations

import base64
import copy
import json
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..assets import ImageAssetError
from ..catalog.demo import demo_rig, virtual_instrument_rig
from ..documents import DocumentError
from ..domain.geometry import rotated_size
from ..exports.project import (
    MAX_BYTES,
    ProjectImportError,
    bundle_assets,
    bundle_documents,
    export_project,
    parse_project,
    project_dict,
)
from ..images import image_asset_ids, resolve_image
from ..live.sender import LiveRefused
from ..models.common import new_id
from ..models.rig import PreviewDevice, Rig, RigPreview, RigSummary, utcnow_iso
from .deps import asset_store, assets_for, load_rig, profile_repo, profiles_for, rig_repo

router = APIRouter(prefix="/api/rigs", tags=["rigs"])


class RigCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    board_width_mm: float = Field(default=600, gt=0, le=5000)
    board_depth_mm: float = Field(default=300, gt=0, le=5000)
    from_demo: bool = False
    # Optional template: "virtual_instrument" creates the Session 5 synthetic Undertow demo (two
    # simulated pedals with labelled synthetic continuous CCs). Never created implicitly.
    template: Literal["virtual_instrument"] | None = None


class RenameBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None


def rig_preview(rig: Rig, profiles, assets=None) -> RigPreview:
    """A true-scale miniature of the board for the rig library: enclosures at their real size,
    with the device picture when one is on this computer."""
    devices = []
    for inst in rig.instances:
        prof = profiles.get(inst.profile_id)
        w, h, placeholder = rotated_size(prof, inst.rotation)
        img = resolve_image(inst, prof, assets or {})
        devices.append(
            PreviewDevice(
                x_mm=inst.x_mm,
                y_mm=inst.y_mm,
                width_mm=w,
                height_mm=h,
                category=prof.category.value if prof else "other",
                off_board=inst.off_board,
                surface=inst.mount,
                placeholder=placeholder,
                rotation=inst.rotation,
                image=img if img and not img.get("missing") else None,
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
            profiles = profiles_for(request, rig)
            s.preview = rig_preview(rig, profiles, assets_for(request, rig, profiles))
    return summaries


@router.post("", response_model=Rig, status_code=201)
def create_rig(body: RigCreate, request: Request):
    if body.template == "virtual_instrument":
        rig = virtual_instrument_rig()
        rig.id = new_id("rig")
        rig.name = body.name
        rig.created_at = rig.updated_at = utcnow_iso()
    elif body.from_demo:
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


def _performing_locked(e: LiveRefused) -> HTTPException:
    return HTTPException(status_code=409, detail={"code": e.code, "message": str(e), **e.detail})


@router.put("/{rig_id}", response_model=Rig)
def put_rig(rig_id: str, rig: Rig, request: Request):
    """Replace the whole rig document (the UI saves the single underlying model). While a
    performance of this rig runs, a save that changes MIDI addressing or the performing texture's
    destinations is refused (``409 live.performing_locked``); the check and the save share the live
    service's lock so nothing can slip between Start and its first message."""
    repo = rig_repo(request)
    live = request.app.state.live
    with live.mutation_guard():
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
        try:
            live.check_rig_replacement(existing, rig)
        except LiveRefused as e:
            raise _performing_locked(e) from e
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
    texture_ids = [t.id for t in rig.textures]
    if len(set(texture_ids)) != len(texture_ids):
        raise HTTPException(status_code=422, detail="Duplicate texture ids")
    # A texture pointing at a device or scene that is gone is kept and reported by the analysis
    # (``texture.instance_missing`` / ``texture.scene_missing``): never rejected, never retargeted.
    for c in rig.connections:
        if c.source.instance_id not in ids or c.target.instance_id not in ids:
            raise HTTPException(status_code=422, detail=f"Connection {c.id} refers to a device that is not on the rig")


@router.patch("/{rig_id}", response_model=Rig)
def rename_rig(rig_id: str, body: RenameBody, request: Request):
    """Rename / re-describe a rig. A metadata-only UPDATE: it never rewrites the document, so it
    cannot overwrite a newer device, cable, scene or texture change, and it leaves the revision
    alone. Allowed while the rig performs (a name is not MIDI addressing)."""
    load_rig(request, rig_id)  # 404 if unknown
    repo = rig_repo(request)
    repo.update_metadata(rig_id, name=body.name, description=body.description)
    return load_rig(request, rig_id)


@router.delete("/{rig_id}", status_code=204)
def delete_rig(rig_id: str, request: Request):
    live = request.app.state.live
    with live.mutation_guard():
        try:
            live.check_rig_deletion(rig_id)
        except LiveRefused as e:
            raise _performing_locked(e) from e
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


@router.get("/{rig_id}/export")
def export_rig(
    rig_id: str,
    request: Request,
    include_images: bool = False,
    include_documents: bool = False,
    require_complete: bool = False,
):
    """Preserve tolerant legacy exports; opt-in complete backups fail if referenced media is missing."""
    if require_complete and not (include_images and include_documents):
        raise HTTPException(status_code=422, detail="Complete backup requires both images and documents.")
    rig = load_rig(request, rig_id)
    profiles = profiles_for(request, rig)
    project = export_project(rig, profiles)
    image_ids = set(image_asset_ids(rig, profiles))
    document_ids = {d for p in profiles.values() for d in p.document_ids()}
    if include_images:
        store = asset_store(request)
        bundle_assets(project, store.get_many(sorted(image_ids)), store.read_bytes)
    if include_documents:
        docs = request.app.state.documents
        bundle_documents(project, docs.get_many(sorted(document_ids)), docs.read_bytes)
    if require_complete:
        missing_profiles = sorted({i.profile_id for i in rig.instances} - set(profiles))
        missing_images = sorted(image_ids - {a["id"] for a in project.assets})
        missing_documents = sorted(document_ids - {d["id"] for d in project.documents})
        if missing_profiles or missing_images or missing_documents:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "export.incomplete_backup",
                    "message": "Complete backup blocked: required device profiles, photos or PDF manuals "
                    "are missing. Restore them or use the plain reference-only export.",
                    "missing_profiles": missing_profiles,
                    "missing_images": missing_images,
                    "missing_documents": missing_documents,
                },
            )
        # Keep a recognizable portable-backup marker even when this rig has no binary media.
        project.format_version = 3
    payload = project_dict(project)
    if require_complete:
        # Import cannot accept a file over MAX_BYTES; check the emitted (pretty-printed)
        # representation too, not just a compact encoding.
        pretty_size = len(json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"))
        if pretty_size > MAX_BYTES:
            raise HTTPException(status_code=413, detail="Complete backup exceeds the 50 MiB project-import limit.")
    return payload


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

    # Bundled images (opt-in exports) are restored through the same validation as an upload.
    store = asset_store(request)
    for a in project.assets:
        aid = a.get("id")
        if not isinstance(aid, str) or store.get(aid) is not None:
            continue
        try:
            store.ingest_image(
                base64.b64decode(a.get("data_base64", ""), validate=True), a.get("original_name"), asset_id=aid
            )
        except (ImageAssetError, ValueError) as e:
            warnings.append(f"bundled image {aid} was not restored: {e}")
    # Images referenced but not on this computer: keep the metadata, draw the enclosure meanwhile.
    for p in project.profiles:
        img = p.get("image") if isinstance(p, dict) else None
        if isinstance(img, dict) and isinstance(img.get("asset_id"), str) and store.get(img["asset_id"]) is None:
            warnings.append(
                f"profile {p.get('id')} refers to image {img['asset_id']}, which is not on this computer; the enclosure drawing is used until you add a picture"
            )
    for inst in project.rig.instances:
        if inst.image and store.get(inst.image.asset_id) is None:
            warnings.append(f"device {inst.label} refers to image {inst.image.asset_id}, which is not on this computer")
    # Bundled manuals (opt-in exports) go through the same PDF validation as an upload. Missing
    # ones are reported, never invented: the profile keeps its reference and the UI says "not here".
    docs = request.app.state.documents
    for dd in project.documents:
        did = dd.get("id")
        if not isinstance(did, str) or docs.get(did) is not None:
            continue
        try:
            docs.ingest_pdf(
                base64.b64decode(dd.get("data_base64", ""), validate=True), dd.get("original_name"), document_id=did
            )
        except (DocumentError, ValueError) as e:
            warnings.append(f"bundled document {did} was not restored: {e}")
    for p in project.profiles:
        try:
            prof_doc_ids = DeviceProfile.model_validate(p).document_ids()
        except Exception:  # validated again below; a bad profile fails there with a clear message
            prof_doc_ids = []
        for did in prof_doc_ids:
            if docs.get(did) is None:
                title = next((d.get("title") for d in p.get("documents", []) if d.get("document_id") == did), None)
                warnings.append(
                    f"profile {p.get('id')} refers to document {did}{f' ({title})' if title else ''}, which is not on this computer; upload it again to view it"
                )

    # A fresh database already contains seeded built-ins. An exported customised MC8 or
    # Sunset may have the *same id* as its seed but different photos, jacks, documents or
    # MIDI capabilities. Silently keeping the seed loses the owner's rig definition.
    #
    # Never replace an existing library profile (other rigs may use it). If its content
    # differs, save the imported variant under a unique id and point only the imported
    # rig's instances at it. Scenes, cables and Texture mappings reference instance ids,
    # so they remain intact without being retargeted.
    remapped_profiles: dict[str, str] = {}
    for p in project.profiles:
        prof = DeviceProfile.model_validate(p)
        original_id = prof.id
        existing = prof_repo.get(original_id)
        if existing is not None:
            # Source/builtin ownership is local-library metadata, not pedal capabilities.
            # Compare the actual profile content before deciding whether to fork it.
            comparable = {"id", "builtin"}
            if existing.model_dump(mode="json", exclude=comparable) == prof.model_dump(
                mode="json", exclude=comparable
            ):
                continue
            replacement_id = new_id("prof")
            while prof_repo.get(replacement_id) is not None:
                replacement_id = new_id("prof")
            prof.id = replacement_id
            remapped_profiles[original_id] = replacement_id
            warnings.append(
                f"profile {original_id} differs from the device library; restored as {replacement_id} "
                "(the existing profile was not changed)"
            )
        prof.builtin = False
        prof_repo.save(prof, source="imported")
        imported.append(prof.id)

    rig = project.rig
    for inst in rig.instances:
        if inst.profile_id in remapped_profiles:
            inst.profile_id = remapped_profiles[inst.profile_id]
    if not keep_id or repo.exists(rig.id):
        rig.id = new_id("rig")
    if name:
        rig.name = name
    rig.revision = 0
    rig.created_at = rig.updated_at = utcnow_iso()
    return ImportResult(rig=repo.save(rig, touch=False), warnings=warnings, imported_profiles=imported)
