"""Signal Loom project files: versioned, portable, lossless round trip of a rig plus profiles."""

from __future__ import annotations

import base64
import json
from typing import Any

from pydantic import ValidationError

from ..models.profile import DeviceProfile
from ..models.rig import PROJECT_FORMAT, PROJECT_FORMAT_VERSION, PROJECT_FORMAT_VERSION_WITH_ASSETS, ProjectFile, Rig

MAX_BYTES = 50 * 1024 * 1024


class ProjectImportError(ValueError):
    pass


def export_project(rig: Rig, profiles: dict[str, DeviceProfile]) -> ProjectFile:
    used = sorted({i.profile_id for i in rig.instances})
    return ProjectFile(rig=rig, profiles=[profiles[p].model_dump(mode="json") for p in used if p in profiles])


def bundle_assets(project: ProjectFile, assets: dict, read_bytes) -> ProjectFile:
    """Opt-in: embed the rig's image assets (base64) and mark the file as format_version 2."""
    bundled = []
    for rec in sorted(assets.values(), key=lambda r: r.id):
        data = read_bytes(rec)
        if data is None:
            continue
        bundled.append(
            {
                "id": rec.id,
                "content_type": rec.content_type,
                "original_name": rec.original_name,
                "width": rec.width,
                "height": rec.height,
                "data_base64": base64.b64encode(data).decode("ascii"),
            }
        )
    project.assets = bundled
    if bundled:
        project.format_version = PROJECT_FORMAT_VERSION_WITH_ASSETS
    return project


def normalize_rig(rig: Rig) -> dict:
    """Content-only view used to compare an exported rig with its re-import (ids kept, timestamps dropped)."""
    d = rig.model_dump(mode="json")
    d.pop("created_at", None)
    d.pop("updated_at", None)
    return d


def parse_project(raw: str | bytes) -> tuple[ProjectFile, list[str]]:
    """Parse untrusted input defensively. Returns (project, warnings). Raises ProjectImportError."""
    if isinstance(raw, bytes):
        if len(raw) > MAX_BYTES:
            raise ProjectImportError("file too large")
        raw = raw.decode("utf-8", errors="strict")
    elif len(raw) > MAX_BYTES:
        raise ProjectImportError("file too large")
    try:
        data: Any = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ProjectImportError(f"not valid JSON: {e.msg} (line {e.lineno})") from e
    if not isinstance(data, dict):
        raise ProjectImportError("top level must be an object")
    if data.get("format") != PROJECT_FORMAT:
        raise ProjectImportError(f"not a Signal Loom project (format={data.get('format')!r})")
    version = data.get("format_version")
    if not isinstance(version, int) or version < 1:
        raise ProjectImportError("missing format_version")
    if version > PROJECT_FORMAT_VERSION_WITH_ASSETS:
        raise ProjectImportError(
            f"project format_version {version} is newer than this app supports ({PROJECT_FORMAT_VERSION_WITH_ASSETS})"
        )
    if version == PROJECT_FORMAT_VERSION and data.get("assets"):
        raise ProjectImportError("format_version 1 files cannot carry bundled assets")
    warnings: list[str] = []
    try:
        project = ProjectFile.model_validate(data)
    except ValidationError as e:
        msgs = "; ".join(f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors()[:5])
        raise ProjectImportError(f"invalid project content: {msgs}") from e
    for p in project.profiles:
        try:
            DeviceProfile.model_validate(p)
        except ValidationError as e:
            raise ProjectImportError(f"invalid embedded profile {p.get('id')!r}: {e.errors()[0]['msg']}") from e
    missing = {i.profile_id for i in project.rig.instances} - {p["id"] for p in project.profiles}
    if missing:
        warnings.append(f"profiles not embedded in file: {', '.join(sorted(missing))}")
    return project, warnings
