from __future__ import annotations

from fastapi import APIRouter, Request

from ..analysis import analyze
from ..models.rig import Rig
from .deps import load_rig, profile_repo, profiles_for

router = APIRouter(prefix="/api/rigs", tags=["analysis"])


@router.get("/{rig_id}/analysis")
def rig_analysis(rig_id: str, request: Request):
    rig = load_rig(request, rig_id)
    return analyze(rig, profiles_for(request, rig))


@router.post("/analyze")
def analyze_document(rig: Rig, request: Request):
    """Analyze an unsaved rig document (the UI uses this for live feedback while editing)."""
    profiles = profile_repo(request).get_many([i.profile_id for i in rig.instances])
    return analyze(rig, profiles)
