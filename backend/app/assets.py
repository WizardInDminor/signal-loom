"""Managed local image assets: user photographs of their pedals.

Security posture: the client's claimed content type is ignored; Pillow sniffs the real format
and only JPEG, PNG and WebP are accepted (never SVG, which can execute script). Every accepted
image is decoded with a pixel-count ceiling, orientation-corrected from EXIF, downscaled to a
bounded edge, and **re-encoded** so no original bytes or metadata (EXIF, GPS, ICC, comments)
ever reach disk or another browser. Files are named by a server-generated id only; a caller can
never choose a path.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from .db import Database
from .models.common import new_id

ASSET_ID_RE = re.compile(r"^img_[0-9a-f]{12}$")
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_PIXELS = 40_000_000  # refuse before decoding anything larger than 40 MP
MAX_EDGE = 2048  # stored copies are downscaled to at most this many px on the long edge
ALLOWED_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}

# Pillow's own bomb guard sits above our explicit header check as a second line of defence.
Image.MAX_IMAGE_PIXELS = MAX_PIXELS * 2


class ImageAssetError(ValueError):
    """A rejected upload. ``status`` is the HTTP status the API should answer with."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass
class AssetRecord:
    id: str
    kind: str
    content_type: str
    ext: str
    width: int
    height: int
    byte_size: int
    sha256: str
    original_name: str | None
    created_at: str

    @property
    def url(self) -> str:
        return f"/api/assets/images/{self.id}"

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "content_type": self.content_type,
            "width": self.width,
            "height": self.height,
            "byte_size": self.byte_size,
            "sha256": self.sha256,
            "original_name": self.original_name,
            "created_at": self.created_at,
            "url": self.url,
        }


def is_asset_id(value: str) -> bool:
    return bool(ASSET_ID_RE.match(value))


def _safe_name(name: str | None) -> str | None:
    if not name:
        return None
    # Keep only the final path component and printable characters; this is display text only.
    base = re.sub(r"[\\/]+", "/", name).split("/")[-1]
    base = "".join(ch for ch in base if ch.isprintable())
    return base[:120] or None


def sanitize_image(data: bytes) -> tuple[bytes, str, str, int, int]:
    """Decode defensively and re-encode. Returns (bytes, content_type, ext, width, height)."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise ImageAssetError(f"image is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB", 413)
    if not data:
        raise ImageAssetError("the uploaded file is empty")
    try:
        img = Image.open(BytesIO(data))
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError) as e:
        raise ImageAssetError("not a JPEG, PNG or WebP image (SVG and other formats are not accepted)") from e
    fmt = (img.format or "").upper()
    if fmt not in ALLOWED_FORMATS:
        raise ImageAssetError(f"{fmt or 'unknown'} images are not accepted; use JPEG, PNG or WebP", 415)
    w, h = img.size
    if w * h > MAX_PIXELS:
        raise ImageAssetError(f"image has {w}×{h} pixels; the limit is {MAX_PIXELS // 1_000_000} megapixels", 413)
    try:
        img.load()
        img = ImageOps.exif_transpose(img) or img  # honour EXIF orientation, then forget the EXIF
    except (OSError, ValueError, Image.DecompressionBombError) as e:
        raise ImageAssetError("the image data is damaged or truncated") from e
    if max(img.size) > MAX_EDGE:
        img.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
    has_alpha = img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)
    out = BytesIO()
    if has_alpha:
        img.convert("RGBA").save(out, format="PNG", optimize=True)
        ctype, ext = "image/png", "png"
    else:
        img.convert("RGB").save(out, format="JPEG", quality=90, optimize=True, progressive=True)
        ctype, ext = "image/jpeg", "jpg"
    return out.getvalue(), ctype, ext, img.size[0], img.size[1]


class AssetStore:
    def __init__(self, db: Database, directory: Path):
        self.db = db
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ paths
    def path_for(self, rec: AssetRecord) -> Path:
        return self.directory / f"{rec.id}.{rec.ext}"

    # ------------------------------------------------------------------ queries
    def _row(self, row) -> AssetRecord:
        return AssetRecord(
            id=row["id"],
            kind=row["kind"],
            content_type=row["content_type"],
            ext=row["ext"],
            width=row["width"],
            height=row["height"],
            byte_size=row["byte_size"],
            sha256=row["sha256"],
            original_name=row["original_name"],
            created_at=row["created_at"],
        )

    def get(self, asset_id: str) -> AssetRecord | None:
        if not is_asset_id(asset_id):
            return None
        row = self.db.conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
        return self._row(row) if row else None

    def get_many(self, ids: list[str]) -> dict[str, AssetRecord]:
        out: dict[str, AssetRecord] = {}
        for i in set(ids):
            rec = self.get(i)
            if rec:
                out[i] = rec
        return out

    def list(self) -> list[AssetRecord]:
        rows = self.db.conn.execute("SELECT * FROM assets ORDER BY created_at DESC, id").fetchall()
        return [self._row(r) for r in rows]

    def read_bytes(self, rec: AssetRecord) -> bytes | None:
        p = self.path_for(rec)
        return p.read_bytes() if p.is_file() else None

    # ------------------------------------------------------------------ writes
    def ingest_image(self, data: bytes, original_name: str | None = None, asset_id: str | None = None) -> AssetRecord:
        """Validate, sanitize and store an uploaded image. ``asset_id`` is only used when
        restoring a bundled asset from a project file and must already be a well-formed id."""
        payload, ctype, ext, w, h = sanitize_image(data)
        if asset_id is not None and not is_asset_id(asset_id):
            raise ImageAssetError("malformed asset id")
        rec = AssetRecord(
            id=asset_id or new_id("img"),
            kind="image",
            content_type=ctype,
            ext=ext,
            width=w,
            height=h,
            byte_size=len(payload),
            sha256=hashlib.sha256(payload).hexdigest(),
            original_name=_safe_name(original_name),
            created_at=datetime.now(UTC).replace(microsecond=0).isoformat(),
        )
        if self.get(rec.id) is not None:
            raise ImageAssetError(f"asset {rec.id} already exists", 409)
        path = self.path_for(rec)
        path.write_bytes(payload)
        with self.db.tx() as c:
            c.execute(
                "INSERT INTO assets(id, kind, content_type, ext, width, height, byte_size, sha256, original_name, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    rec.id,
                    rec.kind,
                    rec.content_type,
                    rec.ext,
                    rec.width,
                    rec.height,
                    rec.byte_size,
                    rec.sha256,
                    rec.original_name,
                    rec.created_at,
                ),
            )
        return rec

    def delete(self, asset_id: str) -> bool:
        rec = self.get(asset_id)
        if rec is None:
            return False
        with self.db.tx() as c:
            c.execute("DELETE FROM assets WHERE id = ?", (asset_id,))
        try:
            self.path_for(rec).unlink(missing_ok=True)
        except OSError:
            pass
        return True

    def is_referenced(self, asset_id: str) -> bool:
        refs = self.referenced_by(asset_id)
        return bool(refs["profiles"] or refs["rigs"])

    def unreferenced(self) -> list[AssetRecord]:
        """Assets no profile image and no instance override points at (safe to remove)."""
        return [r for r in self.list() if not self.is_referenced(r.id)]

    def referenced_by(self, asset_id: str) -> dict[str, list[str]]:
        """Profiles and rigs whose JSON mentions the asset id (profile images and instance overrides)."""
        if not is_asset_id(asset_id):
            return {"profiles": [], "rigs": []}
        needle = f'"{asset_id}"'
        c = self.db.conn
        profiles = [r["id"] for r in c.execute("SELECT id FROM device_profiles WHERE instr(data, ?) > 0", (needle,))]
        rigs = [
            r["rig_id"]
            for r in c.execute("SELECT DISTINCT rig_id FROM device_instances WHERE instr(data, ?) > 0", (needle,))
        ]
        return {"profiles": profiles, "rigs": rigs}


def default_assets_dir(db_path: Path) -> Path:
    import os

    env = os.environ.get("SIGNAL_LOOM_ASSETS")
    return Path(env) if env else db_path.parent / "assets"
