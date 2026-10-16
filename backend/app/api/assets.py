from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from ..assets import MAX_UPLOAD_BYTES, AssetStore, ImageAssetError, is_asset_id

router = APIRouter(prefix="/api/assets", tags=["assets"])


def asset_store(request: Request) -> AssetStore:
    return request.app.state.assets


def _get_or_404(store: AssetStore, asset_id: str):
    # Ids are matched against a strict pattern before they touch the database or the filesystem.
    rec = store.get(asset_id) if is_asset_id(asset_id) else None
    if rec is None:
        raise HTTPException(status_code=404, detail="Image not found")
    return rec


@router.get("/images")
def list_images(request: Request):
    """Every stored picture with whether anything still uses it (so the UI can offer cleanup)."""
    store = asset_store(request)
    return [{**r.as_dict(), "referenced": store.is_referenced(r.id)} for r in store.list()]


@router.delete("/images/unreferenced")
def delete_unreferenced_images(request: Request):
    """Remove pictures that no profile or placed unit uses any more (aborted crops, replaced photos).
    Referenced assets are never touched."""
    store = asset_store(request)
    removed = [r.id for r in store.unreferenced() if store.delete(r.id)]
    return {"removed": removed, "count": len(removed)}


@router.post("/images", status_code=201)
async def upload_image(file: UploadFile, request: Request):
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    try:
        rec = asset_store(request).ingest_image(data, file.filename)
    except ImageAssetError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from e
    return rec.as_dict()


@router.get("/images/{asset_id}/meta")
def image_meta(asset_id: str, request: Request):
    store = asset_store(request)
    rec = _get_or_404(store, asset_id)
    return {**rec.as_dict(), "referenced_by": store.referenced_by(asset_id)}


@router.get("/images/{asset_id}")
def serve_image(asset_id: str, request: Request):
    store = asset_store(request)
    rec = _get_or_404(store, asset_id)
    path = store.path_for(rec)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Image file is missing from the asset directory")
    # The bytes of an id never change, so browsers may cache them for good.
    return FileResponse(
        path,
        media_type=rec.content_type,
        headers={"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/images/{asset_id}", status_code=204)
def delete_image(asset_id: str, request: Request, force: bool = False):
    store = asset_store(request)
    _get_or_404(store, asset_id)
    refs = store.referenced_by(asset_id)
    if (refs["profiles"] or refs["rigs"]) and not force:
        raise HTTPException(
            status_code=409,
            detail=f"Image is still used by {len(refs['profiles'])} profile(s) and {len(refs['rigs'])} rig(s); remove it there first",
        )
    store.delete(asset_id)
    return None
