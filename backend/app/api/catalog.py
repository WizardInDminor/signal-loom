from __future__ import annotations

import json
from enum import Enum
from typing import Annotated

from fastapi import APIRouter, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field, model_validator

from ..catalog.boards import builtin_boards
from ..catalog.pedalplayground import parse_pedalplayground
from ..documents import MAX_DOCUMENT_BYTES, DocumentError, DocumentStore
from ..domain.commands import commands_from_midi_spec
from ..live.sender import LiveRefused
from ..models.board import PedalboardSpec
from ..models.profile import DeviceProfile, DocumentKind, DocumentRef, MidiCommand, PortDef
from ..repo import RigRepository
from .deps import profile_repo

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


class DocumentFile(BaseModel):
    """What is known on this computer about a document a profile refers to."""

    document_id: str
    present: bool  # metadata row and file both exist here
    page_count: int | None = None
    byte_size: int | None = None


class ProfileOut(DeviceProfile):
    unknown_attributes: list[str] = []
    source: str = "builtin"
    document_files: list[DocumentFile] = []


class ProfileIn(DeviceProfile):
    """A profile exactly as the API returned it may be sent back: the read-only echo fields
    (``unknown_attributes``, ``source``, ``document_files``) are accepted and ignored. Anything else
    unknown is still refused, so typos keep surfacing."""

    unknown_attributes: list[str] | None = None
    source: str | None = None
    document_files: list[DocumentFile] | None = None

    def to_profile(self) -> DeviceProfile:
        return DeviceProfile.model_validate(self.model_dump(exclude={"unknown_attributes", "source", "document_files"}))


def _document_files(store: DocumentStore | None, p: DeviceProfile) -> list[DocumentFile]:
    out: list[DocumentFile] = []
    for did in p.document_ids():
        rec = store.get(did) if store else None
        present = bool(rec and store and store.has_file(rec))
        out.append(
            DocumentFile(
                document_id=did,
                present=present,
                page_count=rec.page_count if rec else None,
                byte_size=rec.byte_size if rec else None,
            )
        )
    return out


def _out(p: DeviceProfile, source: str, request: Request | None = None) -> ProfileOut:
    store = getattr(request.app.state, "documents", None) if request else None
    return ProfileOut(
        **p.model_dump(), unknown_attributes=p.unknowns(), source=source, document_files=_document_files(store, p)
    )


def _document_store(request: Request) -> DocumentStore:
    return request.app.state.documents


def _load_editable(request: Request, profile_id: str) -> tuple[DeviceProfile, str]:
    repo = profile_repo(request)
    src = repo.source_of(profile_id)
    profile = repo.get(profile_id)
    if src is None or profile is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile, src


def _guard_profile(request: Request, profile_id: str, what: str) -> None:
    """Post-review finding 1: a MIDI/jack/command change to a profile the performing rig uses would
    change eligibility or addressing under a running stream; refuse until it is stopped."""
    try:
        request.app.state.live.check_profile_mutation(profile_id, what)
    except LiveRefused as e:
        raise HTTPException(status_code=409, detail={"code": e.code, "message": str(e), **e.detail}) from e


def _modify_profile(request: Request, profile_id: str, mutate, *, guard: str | None = None) -> ProfileOut:
    """Read-modify-save of one profile as a single critical section under the configuration write
    lock (the live service's lock, which every whole-object writer takes), so two concurrent
    partial updates — a document rename and a command change, say — are serialised and neither
    overwrites the other. ``mutate(profile)`` may raise an HTTPException. ``guard`` names a
    MIDI/jack/command change refused while the performing rig uses the profile."""
    with request.app.state.live.mutation_guard():
        profile, src = _load_editable(request, profile_id)
        mutate(profile)
        return _save_user_owned(request, profile, src, guard)


def _save_user_owned(request: Request, profile: DeviceProfile, src: str, guard: str | None = None) -> ProfileOut:
    """Persist a profile edit. Editing a builtin turns it into the user's own copy (same id).
    ``guard`` names a MIDI/jack/command change that is refused while the performing rig uses the
    profile (check and save under the live service's lock); document edits pass no guard."""
    if src == "builtin":
        profile.builtin = False
        profile.provenance.source = "user"
        src = "custom"
    with request.app.state.live.mutation_guard():
        if guard:
            _guard_profile(request, profile.id, guard)
        profile_repo(request).save(profile, source=src)
    return _out(profile, src, request)


@router.get("/boards", response_model=list[PedalboardSpec])
def list_boards():
    """Manufacturer pedalboards (hand-authored, with evidence per figure)."""
    return builtin_boards()


@router.get("/devices", response_model=list[ProfileOut])
def list_devices(request: Request, q: str | None = None, category: str | None = None):
    repo = profile_repo(request)
    return [_out(p, repo.source_of(p.id) or "custom", request) for p in repo.list(query=q, category=category)]


@router.get("/devices/{profile_id}", response_model=ProfileOut)
def get_device(profile_id: str, request: Request):
    repo = profile_repo(request)
    p = repo.get(profile_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return _out(p, repo.source_of(p.id) or "custom", request)


def _check_image(request: Request, profile: DeviceProfile) -> None:
    if profile.image is not None and request.app.state.assets.get(profile.image.asset_id) is None:
        raise HTTPException(status_code=422, detail=f"Image asset '{profile.image.asset_id}' is not on this computer")


@router.post("/devices", response_model=ProfileOut, status_code=201)
def create_device(body: ProfileIn, request: Request):
    profile = body.to_profile()
    repo = profile_repo(request)
    if repo.get(profile.id) is not None:
        raise HTTPException(status_code=409, detail=f"Profile id '{profile.id}' already exists")
    _check_image(request, profile)
    profile.reconcile_declared_unknowns()
    profile.builtin = False
    repo.save(profile, source="custom")
    return _out(profile, "custom", request)


@router.put("/devices/{profile_id}", response_model=ProfileOut)
def update_device(profile_id: str, body: ProfileIn, request: Request):
    profile = body.to_profile()
    repo = profile_repo(request)
    if profile.id != profile_id:
        raise HTTPException(status_code=400, detail="Profile id mismatch")
    _check_image(request, profile)
    profile.reconcile_declared_unknowns()
    # A full replacement from the client's copy (no revision on profiles, as before); the source
    # lookup, the guard and the write share the configuration write lock.
    with request.app.state.live.mutation_guard():
        src = repo.source_of(profile_id)
        if src is None:
            raise HTTPException(status_code=404, detail="Profile not found")
        if src == "builtin":
            # Editing a builtin turns it into a user-owned profile so reseeding never clobbers it.
            profile.builtin = False
            profile.provenance.source = "user"
            src = "custom"
        _guard_profile(request, profile_id, "replacing this device profile")
        repo.save(profile, source=src)
    return _out(profile, src, request)


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

    def mutate(profile: DeviceProfile) -> None:
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

    return _modify_profile(request, profile_id, mutate, guard="changing this device's jacks")


@router.delete("/devices/{profile_id}", status_code=204)
def delete_device(profile_id: str, request: Request):
    repo = profile_repo(request)
    if repo.source_of(profile_id) is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    with request.app.state.live.mutation_guard():
        _guard_profile(request, profile_id, "deleting this device profile")
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


# ----------------------------------------------------------------------------- documents (manuals)


@router.post("/devices/{profile_id}/documents", response_model=ProfileOut, status_code=201)
async def attach_document(
    profile_id: str,
    request: Request,
    file: UploadFile,
    title: Annotated[str | None, Form()] = None,
    kind: Annotated[DocumentKind, Form()] = "manual",
    note: Annotated[str | None, Form()] = None,
):
    """Upload a PDF and attach it to the profile in one step. The file is validated as a PDF
    (header, trailer, PDFium can open it), stored under an opaque id in the document directory,
    and the profile gains only a reference with the user's title."""
    _load_editable(request, profile_id)  # 404 before the upload is processed
    data = await file.read(MAX_DOCUMENT_BYTES + 1)
    try:
        rec = _document_store(request).ingest_pdf(data, file.filename)  # the slow part: outside any lock
    except DocumentError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from e
    clean_title = (
        (title or "").strip() or (rec.original_name or "").removesuffix(".pdf").removesuffix(".PDF") or "Manual"
    )

    def mutate(profile: DeviceProfile) -> None:
        profile.documents.append(DocumentRef(document_id=rec.id, title=clean_title[:120], kind=kind, note=note or None))

    return _modify_profile(request, profile_id, mutate)


class DocumentRefPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    kind: DocumentKind | None = None
    note: str | None = None
    clear_note: bool = False


@router.patch("/devices/{profile_id}/documents/{document_id}", response_model=ProfileOut)
def rename_document(profile_id: str, document_id: str, body: DocumentRefPatch, request: Request):
    """Change how the profile titles/classifies an attached document (the file is untouched)."""

    def mutate(profile: DeviceProfile) -> None:
        ref = profile.document(document_id)
        if ref is None:
            raise HTTPException(status_code=404, detail="Document is not attached to this profile")
        if body.title is not None:
            ref.title = body.title.strip() or ref.title
        if body.kind is not None:
            ref.kind = body.kind
        if body.clear_note:
            ref.note = None
        elif body.note is not None:
            ref.note = body.note or None

    return _modify_profile(request, profile_id, mutate)


@router.post("/devices/{profile_id}/documents/{document_id}/replace", response_model=ProfileOut)
async def replace_document(profile_id: str, document_id: str, request: Request, file: UploadFile, force: bool = False):
    """Swap the PDF behind an attached document, keeping its id so page citations stay valid.
    Refused (409) while another profile shares the same file, unless forced."""
    profile, src = _load_editable(request, profile_id)
    if profile.document(document_id) is None:
        raise HTTPException(status_code=404, detail="Document is not attached to this profile")
    store = _document_store(request)
    rec = store.get(document_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Document not found on this computer")
    others = [p for p in store.referenced_by(document_id) if p != profile_id]
    if others and not force:
        raise HTTPException(
            status_code=409,
            detail=f"This document is also used by {', '.join(others)}; replacing it would change their manual too. Confirm to replace anyway.",
        )
    data = await file.read(MAX_DOCUMENT_BYTES + 1)
    try:
        store.replace_pdf(rec, data, file.filename)
    except DocumentError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from e
    # The profile itself is unchanged by a replace (same document id): it is not rewritten, so a
    # concurrent profile edit cannot be lost here. Return the current stored profile.
    profile, src = _load_editable(request, profile_id)
    return _out(profile, src, request)


@router.delete("/devices/{profile_id}/documents/{document_id}", response_model=ProfileOut)
def detach_document(profile_id: str, document_id: str, request: Request, purge: bool = False):
    """Detach a document from the profile. Commands citing it keep their citation but are reported
    as citing a document that is no longer attached. With ``purge=1`` the file is also deleted,
    but only when nothing else refers to it any more (cleanup is deliberate, never implicit)."""

    def mutate(profile: DeviceProfile) -> None:
        if profile.document(document_id) is None:
            raise HTTPException(status_code=404, detail="Document is not attached to this profile")
        profile.documents = [d for d in profile.documents if d.document_id != document_id]

    out = _modify_profile(request, profile_id, mutate)
    if purge:
        store = _document_store(request)
        if not store.referenced_by(document_id):
            store.delete(document_id)
    return out


# ----------------------------------------------------------------------------- MIDI commands


class CommandsBody(BaseModel):
    commands: list[MidiCommand]

    @model_validator(mode="after")
    def _unique(self) -> CommandsBody:
        ids = [c.id for c in self.commands]
        if len(set(ids)) != len(ids):
            raise ValueError("command ids must be unique within a profile")
        return self


@router.put("/devices/{profile_id}/commands", response_model=ProfileOut)
def update_commands(profile_id: str, body: CommandsBody, request: Request):
    """Replace only the profile's command library (jacks, dimensions, picture, documented MIDI map
    untouched). Scenes that applied a changed or removed command keep their saved values and are
    flagged for review by the compiler; nothing is rewritten here."""

    def mutate(profile: DeviceProfile) -> None:
        profile.midi.commands = body.commands

    return _modify_profile(request, profile_id, mutate, guard="changing this device's command library")


class MidiCapabilityBody(BaseModel):
    """An explicit user statement that the device has a MIDI input (for imported profiles that came
    without any MIDI data). Recorded with evidence ``user``; never marked documented."""

    interfaces: list[str] = Field(min_length=1)
    default_channel: int | None = Field(default=None, ge=1, le=16)
    note: str | None = None


@router.post("/devices/{profile_id}/midi-capability", response_model=ProfileOut)
def declare_midi_capability(profile_id: str, body: MidiCapabilityBody, request: Request):
    from ..models.common import Evidence

    def mutate(profile: DeviceProfile) -> None:
        for i in body.interfaces:
            if i not in profile.midi.interfaces:
                profile.midi.interfaces.append(i)
        if body.default_channel is not None:
            profile.midi.default_channel = body.default_channel
        if profile.midi.evidence in (Evidence.UNKNOWN,):
            profile.midi.evidence = Evidence.USER
        stamp = "MIDI capability declared by the user, not taken from a manual."
        profile.midi.note = (
            f"{profile.midi.note} {stamp}"
            if profile.midi.note and stamp not in profile.midi.note
            else profile.midi.note or stamp
        )
        if body.note:
            profile.midi.note = f"{profile.midi.note} {body.note}"

    return _modify_profile(request, profile_id, mutate, guard="declaring this device's MIDI capability")


class FromMapResult(BaseModel):
    profile: ProfileOut
    added: list[str]


@router.post("/devices/{profile_id}/commands/from-map", response_model=FromMapResult)
def commands_from_map(profile_id: str, request: Request):
    """Add the commands implied by the documented MIDI map (bypass on/off, each CC, program recall),
    copying the map's evidence. Existing commands are kept; nothing is invented."""
    added: list[str] = []

    def mutate(profile: DeviceProfile) -> None:
        fresh = commands_from_midi_spec(profile.midi)
        profile.midi.commands = [*profile.midi.commands, *fresh]
        added.extend(c.id for c in fresh)

    out = _modify_profile(request, profile_id, mutate, guard="adding commands from this device's MIDI map")
    return FromMapResult(profile=out, added=added)


@router.get("/devices/{profile_id}/command-usage")
def command_usage(profile_id: str, request: Request):
    """Where each command of this profile has been applied: rig, scene, device, and whether the
    saved snapshot still matches the current definition. Keyed by command id; removed commands that
    scenes still reference appear too, so a user sees what a deletion left behind."""
    repo = profile_repo(request)
    profile = repo.get(profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    rigs = RigRepository(request.app.state.db)
    live = {c.id: c.fingerprint() for c in profile.midi.commands}
    usage: dict[str, list[dict]] = {}
    for rig_id in repo.referenced_by(profile_id):
        rig = rigs.get(rig_id)
        if rig is None:
            continue
        ours = {i.id: i for i in rig.instances if i.profile_id == profile_id}
        for scene in rig.scenes:
            for st in scene.device_states:
                inst = ours.get(st.instance_id)
                if inst is None:
                    continue
                applied = [cv.command for cv in st.cc_values if cv.command] + (
                    [st.program.command] if st.program and st.program.command else []
                )
                for a in applied:
                    usage.setdefault(a.command_id, []).append(
                        {
                            "rig_id": rig.id,
                            "rig_name": rig.name,
                            "scene_id": scene.id,
                            "scene_name": scene.name,
                            "instance_id": inst.id,
                            "instance_label": inst.label,
                            "name_at_apply": a.name,
                            "changed": live.get(a.command_id) != a.definition,
                            "removed": a.command_id not in live,
                        }
                    )
    return usage
