from __future__ import annotations

import json
from enum import Enum

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
    profile.reconcile_declared_unknowns()
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
    profile.reconcile_declared_unknowns()
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
    # Removing, renaming or retyping a jack that rig cables use is refused unless the user
    # explicitly confirms.
    force: bool = False


# What a cable relies on about the jack it is plugged into. Labels, positions, anchors, clearance
# and notes can change freely; these change what the cable *means* and get the same guard as a
# removal. Filling in a value that was not stated (None / "unknown"), or un-stating one, is a
# refinement or a retraction, not a contradiction, so it passes.
PORT_SEMANTIC_FIELDS = (
    "kind",
    "direction",
    "connector",
    "audio_channel",
    "trs_role",
    "midi_trs_type",
    "pair_group",
    "role",
)
_UNSTATED = {None, "unknown"}


def _value(v):
    return v.value if isinstance(v, Enum) else v


def port_semantic_changes(old: PortDef, new: PortDef) -> list[str]:
    """Human-readable list of the semantic differences between two definitions of one jack id."""
    out: list[str] = []
    for f in PORT_SEMANTIC_FIELDS:
        a, b = _value(getattr(old, f)), _value(getattr(new, f))
        if a == b or a in _UNSTATED or b in _UNSTATED:
            continue
        out.append(f"{f} {a} → {b}")
    return out


@router.put("/devices/{profile_id}/ports", response_model=ProfileOut)
def update_ports(profile_id: str, body: PortsBody, request: Request):
    """Replace only the jack list of a profile (dimensions, provenance, picture, MIDI and power
    data untouched). Jack ids are stable handles for cables: a removed or renamed id that a cable
    references is reported with the affected cables and refused until confirmed; so is changing
    what a used jack *is* (signal kind, direction, connector, channel, TRS wiring, pair, role)."""
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
    before = {p.id: p for p in profile.ports}
    changes: dict[str, str] = {pid: "removed" for pid in sorted(set(before) - set(ids))}
    for p in body.ports:
        if p.id in before:
            diff = port_semantic_changes(before[p.id], p)
            if diff:
                changes[p.id] = "; ".join(diff)
    if changes and not body.force:
        usage = repo.port_usage(profile_id)
        affected = [dict(u, port_id=pid, change=changes[pid]) for pid in changes for u in usage.get(pid, [])]
        if affected:
            removed_ids = sorted({a["port_id"] for a in affected if a["change"] == "removed"})
            changed_ids = sorted({a["port_id"] for a in affected if a["change"] != "removed"})
            parts = []
            if removed_ids:
                parts.append("removing or renaming " + ", ".join(removed_ids))
            if changed_ids:
                parts.append("changing the type of " + ", ".join(changed_ids))
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "ports_in_use",
                    "message": f"{len(affected)} cable(s) are plugged into jack(s) you are " + " and ".join(parts),
                    "affected": affected,
                },
            )
    profile.ports = body.ports
    profile.reconcile_declared_unknowns()
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
