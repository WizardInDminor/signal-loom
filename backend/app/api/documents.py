"""User-supplied PDF documents (device manuals): metadata, passive page pictures, text search and
an explicit download. Attaching a document to a profile is done through the catalog routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

from ..documents import DocumentError, DocumentStore, download_filename, is_document_id

router = APIRouter(prefix="/api/documents", tags=["documents"])

# The original bytes are only ever handed out as a download: never rendered inline by the browser's
# PDF engine from this origin, no scripts, nothing cached by intermediaries.
DOWNLOAD_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, no-store",
}
PAGE_HEADERS = {"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"}


def document_store(request: Request) -> DocumentStore:
    return request.app.state.documents


def _get_or_404(store: DocumentStore, document_id: str):
    rec = store.get(document_id) if is_document_id(document_id) else None
    if rec is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return rec


def _title_for(request: Request, document_id: str) -> str | None:
    """The first title a profile gave this document (for the download filename)."""
    from ..repo import ProfileRepository

    repo = ProfileRepository(request.app.state.db)
    for pid in document_store(request).referenced_by(document_id):
        prof = repo.get(pid)
        ref = prof.document(document_id) if prof else None
        if ref:
            return ref.title
    return None


@router.get("")
def list_documents(request: Request):
    """Every stored document with the profiles that use it and whether its file is present."""
    store = document_store(request)
    return [
        {**r.as_dict(), "referenced_by": store.referenced_by(r.id), "file_present": store.has_file(r)}
        for r in store.list()
    ]


@router.delete("/unreferenced")
def delete_unreferenced_documents(request: Request):
    """Remove documents no profile attaches or cites any more. Referenced documents are never touched."""
    store = document_store(request)
    removed = [r.id for r in store.unreferenced() if store.delete(r.id)]
    return {"removed": removed, "count": len(removed)}


@router.get("/{document_id}")
def document_meta(document_id: str, request: Request):
    store = document_store(request)
    rec = _get_or_404(store, document_id)
    return {**rec.as_dict(), "referenced_by": store.referenced_by(document_id), "file_present": store.has_file(rec)}


@router.get("/{document_id}/file")
def download_document(document_id: str, request: Request):
    """The PDF itself, as an attachment. Viewing inside the app uses the rendered pages instead."""
    store = document_store(request)
    rec = _get_or_404(store, document_id)
    path = store.path_for(rec)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Document file is missing from the document directory")
    name = download_filename(_title_for(request, document_id) or rec.original_name, rec.id)
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={**DOWNLOAD_HEADERS, "Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/{document_id}/pages/{page}")
def document_page(document_id: str, page: int, request: Request, width: int | None = None):
    """One page rasterized to PNG (1-based). This is how the app shows a manual: as a picture, so
    nothing inside the PDF can run."""
    store = document_store(request)
    rec = _get_or_404(store, document_id)
    try:
        png = store.render_page(rec, page, width)
    except DocumentError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from e
    return Response(content=png, media_type="image/png", headers=PAGE_HEADERS)


@router.get("/{document_id}/search")
def search_document(document_id: str, request: Request, q: str = ""):
    """Case-insensitive text search over the PDF's own text layer (local extraction; no OCR, so a
    scanned manual yields nothing and says so)."""
    store = document_store(request)
    rec = _get_or_404(store, document_id)
    try:
        texts = store.page_texts(rec)
        hits = store.search(rec, q)
    except DocumentError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from e
    return {
        "query": q,
        "hits": hits,
        "truncated": len(hits) >= 60,
        "has_text_layer": any(t.strip() for t in texts),
        "page_count": len(texts),
    }


@router.delete("/{document_id}", status_code=204)
def delete_document(document_id: str, request: Request, force: bool = False):
    store = document_store(request)
    _get_or_404(store, document_id)
    refs = store.referenced_by(document_id)
    if refs and not force:
        raise HTTPException(
            status_code=409,
            detail=f"Document is still attached to or cited by {len(refs)} profile(s) ({', '.join(refs)}); detach it there first",
        )
    store.delete(document_id)
    return None
