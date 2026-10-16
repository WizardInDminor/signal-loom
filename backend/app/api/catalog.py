from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..catalog.pedalplayground import parse_pedalplayground
from ..models.profile import DeviceProfile, PortDef
from .deps import profile_repo

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


class ProfileOut(DeviceProfile):
    unknown_attributes: list[str] = []
    source: str = "builtin"


def _out(p: DeviceProfile, source: str) -> ProfileOut:
    return ProfileOut(**p.model_dump(), unknown_attributes=p.unknowns(), source=source)


@router.get("/devices", response_model=list[ProfileOut])
def list_devices(request: Request, q: str | None = None, category: str | None = None):
    repo = profile_repo(request)
    return [_out(p, repo.source_of(p.id) or "custom") for p in repo.list(query=q, category=category)]


@router.get("/devices/{profile_id}", response_model=ProfileOut)
def get_device(profile_id: str, request: Request):
    repo = profile_repo(request)
    p = repo.get(profile_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return _out(p, repo.source_of(p.id) or "custom")


def _check_image(request: Request, profile: DeviceProfile) -> None:
    if profile.image is not None and request.app.state.assets.get(profile.image.asset_id) is None:
        raise HTTPException(status_code=422, detail=f"Image asset '{profile.image.asset_id}' is not on this computer")


@router.post("/devices", response_model=ProfileOut, status_code=201)
def create_device(profile: DeviceProfile, request: Request):
    repo = profile_repo(request)
    if repo.get(profile.id) is not None:
        raise HTTPException(status_code=409, detail=f"Profile id '{profile.id}' already exists")
    _check_image(request, profile)
    profile.builtin = False
    repo.save(profile, source="custom")
    return _out(profile, "custom")


@router.put("/devices/{profile_id}", response_model=ProfileOut)
def update_device(profile_id: str, profile: DeviceProfile, request: Request):
    repo = profile_repo(request)
    src = repo.source_of(profile_id)
    if src is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    if profile.id != profile_id:
        raise HTTPException(status_code=400, detail="Profile id mismatch")
    _check_image(request, profile)
    if src == "builtin":
        # Editing a builtin turns it into a user-owned profile so reseeding never clobbers it.
        profile.builtin = False
        profile.provenance.source = "user"
        src = "custom"
    repo.save(profile, source=src)
    return _out(profile, src)


@router.get("/devices/{profile_id}/port-usage")
def port_usage(profile_id: str, request: Request):
    """Which cables (in which rigs) are plugged into each of this profile's jacks."""
    repo = profile_repo(request)
    if repo.source_of(profile_id) is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return repo.port_usage(profile_id)


class PortsBody(BaseModel):
    ports: list[PortDef]
    # Removing or renaming a jack that rig cables use is refused unless the user explicitly confirms.
    force: bool = False


@router.put("/devices/{profile_id}/ports", response_model=ProfileOut)
def update_ports(profile_id: str, body: PortsBody, request: Request):
    """Replace only the jack list of a profile (dimensions, provenance, picture, MIDI and power
    data untouched). Jack ids are stable handles for cables: a removed or renamed id that a cable
    references is reported with the affected cables and refused until confirmed."""
    repo = profile_repo(request)
    src = repo.source_of(profile_id)
    profile = repo.get(profile_id)
    if src is None or profile is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    ids = [p.id for p in body.ports]
    if len(set(ids)) != len(ids):
        dup = sorted({i for i in ids if ids.count(i) > 1})
        raise HTTPException(status_code=422, detail=f"duplicate jack id(s): {', '.join(dup)}")
    if any(not i.strip() for i in ids):
        raise HTTPException(status_code=422, detail="every jack needs an id")
    for p in body.ports:
        if p.image_anchor is not None and request.app.state.assets.get(p.image_anchor.asset_id) is None:
            raise HTTPException(
                status_code=422,
                detail=f"jack '{p.id}' is anchored on image {p.image_anchor.asset_id}, which is not on this computer",
            )
    removed = {p.id for p in profile.ports} - set(ids)
    if removed and not body.force:
        usage = repo.port_usage(profile_id)
        affected = [dict(u, port_id=pid) for pid in sorted(removed) for u in usage.get(pid, [])]
        if affected:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "ports_in_use",
                    "message": f"{len(affected)} cable(s) are plugged into jack(s) you are removing or renaming: "
                    + ", ".join(sorted({a["port_id"] for a in affected})),
                    "affected": affected,
                },
            )
    profile.ports = body.ports
    if src == "builtin":
        profile.builtin = False
        profile.provenance.source = "user"
        src = "custom"
    repo.save(profile, source=src)
    return _out(profile, src)


@router.delete("/devices/{profile_id}", status_code=204)
def delete_device(profile_id: str, request: Request):
    repo = profile_repo(request)
    if repo.source_of(profile_id) is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    used = repo.referenced_by(profile_id)
    if used:
        raise HTTPException(
            status_code=409, detail=f"Profile is used by {len(used)} rig(s); remove those devices first"
        )
    repo.delete(profile_id)
    return None


class ImportReport(BaseModel):
    imported: int
    skipped_existing: int
    problems: list[str]


@router.post("/import/pedalplayground", response_model=ImportReport)
async def import_pedalplayground(request: Request):
    raw = await request.body()
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"Not valid JSON: {e.msg}") from e
    profiles, problems = parse_pedalplayground(payload)
    repo = profile_repo(request)
    imported = skipped = 0
    for p in profiles:
        if repo.source_of(p.id) is not None:
            skipped += 1
            continue
        repo.save(p, source="imported")
        imported += 1
    return ImportReport(imported=imported, skipped_existing=skipped, problems=problems[:50])
