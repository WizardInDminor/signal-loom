from __future__ import annotations

from fastapi import HTTPException, Request

from ..assets import AssetRecord, AssetStore
from ..images import image_asset_ids
from ..models.profile import DeviceProfile
from ..models.rig import Rig
from ..repo import ProfileRepository, RigRepository


def rig_repo(request: Request) -> RigRepository:
    return RigRepository(request.app.state.db)


def profile_repo(request: Request) -> ProfileRepository:
    return ProfileRepository(request.app.state.db)


def load_rig(request: Request, rig_id: str) -> Rig:
    rig = rig_repo(request).get(rig_id)
    if rig is None:
        raise HTTPException(status_code=404, detail=f"Rig '{rig_id}' not found")
    return rig


def profiles_for(request: Request, rig: Rig) -> dict[str, DeviceProfile]:
    return profile_repo(request).get_many([i.profile_id for i in rig.instances])


def asset_store(request: Request) -> AssetStore:
    return request.app.state.assets


def assets_for(request: Request, rig: Rig, profiles: dict[str, DeviceProfile]) -> dict[str, AssetRecord]:
    return asset_store(request).get_many(image_asset_ids(rig, profiles))
