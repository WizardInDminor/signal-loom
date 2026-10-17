"""Resolve which picture, if any, a placed device shows, and the facts a renderer needs.

The profile's footprint stays the source of truth for size; an image is a visual overlay fitted
to that footprint. An instance may override the profile's image (a repainted or customised
pedal). Resolution never invents anything: a reference to an asset that is not on this computer
resolves to ``None`` and the renderer falls back to the enclosure drawing.
"""

from __future__ import annotations

from .assets import AssetRecord
from .models.profile import DeviceImage, DeviceProfile
from .models.rig import DeviceInstance, Rig


def image_asset_ids(rig: Rig, profiles: dict[str, DeviceProfile]) -> list[str]:
    ids: list[str] = []
    for inst in rig.instances:
        if inst.image:
            ids.append(inst.image.asset_id)
        prof = profiles.get(inst.profile_id)
        if prof and prof.image:
            ids.append(prof.image.asset_id)
    return ids


def resolve_image(
    inst: DeviceInstance | None, profile: DeviceProfile | None, assets: dict[str, AssetRecord]
) -> dict | None:
    """The effective image for a device: the instance override if it has one, else the profile's."""
    chosen: DeviceImage | None = None
    source = None
    if inst is not None and inst.image is not None:
        chosen, source = inst.image, "instance"
    elif profile is not None and profile.image is not None:
        chosen, source = profile.image, "profile"
    if chosen is None:
        return None
    rec = assets.get(chosen.asset_id)
    if rec is None:
        return {"asset_id": chosen.asset_id, "missing": True, "source": source}
    return {
        "asset_id": rec.id,
        "url": rec.url,
        "width": rec.width,
        "height": rec.height,
        "crop": chosen.crop.model_dump(),
        "rotation_quarter": chosen.rotation_quarter,
        "fit": chosen.fit,
        "calibrated": chosen.calibrated,
        "source": source,
        "missing": False,
    }
