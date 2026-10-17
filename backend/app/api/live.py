"""Live control API. Loopback-only: the backend is the sole MIDI owner and never offers MIDI
control to another machine, even through the Next.js proxy (the forwarded client address is
checked as well as the socket peer)."""

from __future__ import annotations

import ipaddress
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..live.sender import LiveRefused
from ..live.service import LiveService
from ..models.live import LiveBindings, TransportMode

router = APIRouter(prefix="/api/live", tags=["live"])


def _is_loopback(host: str | None) -> bool:
    if not host:
        return False
    host = host.strip()
    if host in ("localhost", "testclient"):
        return True
    try:
        return ipaddress.ip_address(host.split("%")[0]).is_loopback
    except ValueError:
        return False


def require_local(request: Request) -> None:
    peer = request.client.host if request.client else None
    if not _is_loopback(peer):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "live.remote_forbidden",
                "message": "Live MIDI control is available on this computer only.",
            },
        )
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        first = fwd.split(",")[0].strip()
        if not _is_loopback(first):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "live.remote_forbidden",
                    "message": "Live MIDI control is not offered to another computer, even through the UI proxy.",
                },
            )


def _live(request: Request) -> LiveService:
    return request.app.state.live


Live = Annotated[LiveService, Depends(_live)]


def _refused(e: LiveRefused) -> HTTPException:
    return HTTPException(status_code=409, detail={"code": e.code, "message": str(e), **e.detail})


deps = [Depends(require_local)]


class ModeBody(BaseModel):
    mode: TransportMode


class ArmBody(BaseModel):
    confirm: str = ""


class AuditionBody(BaseModel):
    delay_ms: int | None = Field(default=None, ge=0, le=2000)
    confirm_nondeterministic: bool = False
    # Route prerequisites / unverified hops the user acknowledges for this connection session
    # (the exact strings a 409 ``live.confirm_route`` listed). Nothing is queued before they match.
    acknowledge: list[str] = Field(default_factory=list)


class SendBody(BaseModel):
    instance_id: str
    type: str
    number: int = Field(ge=0, le=127)
    value: int | None = Field(default=None, ge=0, le=127)
    confirm_nondeterministic: bool = False
    coalesce: bool = False
    label: str | None = None
    deterministic: bool | None = None
    acknowledge: list[str] = Field(default_factory=list)


class InjectBody(BaseModel):
    endpoint_id: str
    type: str
    channel: int = Field(ge=1, le=16)
    number: int = Field(ge=0, le=127)
    value: int | None = Field(default=None, ge=0, le=127)


class EndpointBody(BaseModel):
    endpoint_id: str


@router.get("/status", dependencies=deps)
def status(svc: Live):
    return svc.status()


@router.get("/endpoints", dependencies=deps)
def endpoints(svc: Live, rig_id: str | None = None):
    try:
        return svc.endpoints(rig_id)
    except LiveRefused as e:
        raise _refused(e) from e


@router.post("/mode", dependencies=deps)
def set_mode(body: ModeBody, svc: Live):
    try:
        return svc.set_mode(body.mode)
    except LiveRefused as e:
        raise _refused(e) from e


@router.post("/refresh", dependencies=deps)
def refresh(svc: Live):
    return svc.refresh()


@router.post("/release", dependencies=deps)
def release(body: EndpointBody, svc: Live):
    return svc.release(body.endpoint_id)


@router.post("/reacquire", dependencies=deps)
def reacquire(body: EndpointBody, svc: Live):
    return svc.reacquire(body.endpoint_id)


@router.get("/rigs/{rig_id}/bindings", response_model=LiveBindings, dependencies=deps)
def get_bindings(rig_id: str, svc: Live):
    return svc.get_bindings(rig_id)


@router.put("/rigs/{rig_id}/bindings", response_model=LiveBindings, dependencies=deps)
def put_bindings(rig_id: str, body: LiveBindings, svc: Live):
    try:
        svc._load(rig_id)
        return svc.save_bindings(rig_id, body)
    except LiveRefused as e:
        raise _refused(e) from e


@router.post("/rigs/{rig_id}/bindings/suggest", response_model=LiveBindings, dependencies=deps)
def suggest_bindings(rig_id: str, svc: Live):
    try:
        return svc.suggest_bindings(rig_id)
    except LiveRefused as e:
        raise _refused(e) from e


@router.get("/rigs/{rig_id}/coverage", dependencies=deps)
def coverage(rig_id: str, svc: Live):
    try:
        _, _, graph = svc.graph(rig_id)
    except LiveRefused as e:
        raise _refused(e) from e
    return graph.as_dict()


@router.post("/rigs/{rig_id}/connect", dependencies=deps)
def connect(rig_id: str, svc: Live):
    try:
        return svc.connect(rig_id)
    except LiveRefused as e:
        raise _refused(e) from e


@router.post("/disconnect", dependencies=deps)
def disconnect(svc: Live):
    return svc.disconnect()


@router.post("/arm", dependencies=deps)
def arm(body: ArmBody, svc: Live):
    try:
        svc.sender.arm(body.confirm)
    except LiveRefused as e:
        raise _refused(e) from e
    return svc.status()


@router.post("/disarm", dependencies=deps)
def disarm(svc: Live):
    svc.sender.disarm("user")
    return svc.status()


@router.post("/stop", dependencies=deps)
def stop(svc: Live):
    n = svc.sender.stop()
    return {"cancelled": n, **svc.status()}


@router.post("/rigs/{rig_id}/scenes/{scene_id}/dry-run", dependencies=deps)
def dry_run(rig_id: str, scene_id: str, svc: Live):
    try:
        return svc.dry_run(rig_id, scene_id)
    except LiveRefused as e:
        raise _refused(e) from e


@router.post("/rigs/{rig_id}/scenes/{scene_id}/audition", dependencies=deps)
def audition(rig_id: str, scene_id: str, body: AuditionBody, svc: Live):
    try:
        return svc.audition(rig_id, scene_id, body.delay_ms, body.confirm_nondeterministic, body.acknowledge)
    except LiveRefused as e:
        raise _refused(e) from e


@router.post("/rigs/{rig_id}/send", dependencies=deps)
def send(rig_id: str, body: SendBody, svc: Live):
    try:
        return svc.send(
            rig_id,
            body.instance_id,
            body.type,
            body.number,
            body.value,
            body.confirm_nondeterministic,
            body.coalesce,
            body.label,
            body.deterministic,
            body.acknowledge,
        )
    except LiveRefused as e:
        raise _refused(e) from e


@router.get("/rigs/{rig_id}/panels", dependencies=deps)
def panels(rig_id: str, svc: Live):
    try:
        return svc.panels(rig_id)
    except LiveRefused as e:
        raise _refused(e) from e


@router.get("/rigs/{rig_id}/follower", dependencies=deps)
def follower(rig_id: str, svc: Live):
    try:
        return svc.follower(rig_id)
    except LiveRefused as e:
        raise _refused(e) from e


@router.get("/events", dependencies=deps)
def events(svc: Live, since_log: int = 0, since_observed: int = 0, rig_id: str | None = None):
    return svc.events(since_log, since_observed, rig_id)


@router.post("/virtual/inject", dependencies=deps)
def inject(body: InjectBody, svc: Live):
    try:
        return svc.inject(body.endpoint_id, body.type, body.channel, body.number, body.value)
    except LiveRefused as e:
        raise _refused(e) from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
