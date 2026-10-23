"""Managed local documents: user-supplied PDF manuals for device profiles.

Security posture: the client's claimed content type is ignored. A file is accepted only when it
starts with the PDF header, ends with a PDF trailer and PDFium can open it and count its pages;
anything else (an image renamed .pdf, an HTML file, an encrypted or truncated PDF) is refused.
Files are named by a server-generated id only, so a caller can never choose a path, and the
browser never receives the PDF for rendering: pages are rasterized here with PDFium and served
as PNG pictures, so a PDF's embedded scripts, links and forms are never executed in the app.
The original bytes are only offered as an explicit download.

Unlike pictures, a document is kept byte-for-byte (a manual must stay citable by page), so the
store never re-encodes it; it only validates and renders.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from .db import Database
from .models.common import new_id

DOCUMENT_ID_RE = re.compile(r"^doc_[0-9a-f]{12}$")
MAX_DOCUMENT_BYTES = 40 * 1024 * 1024
MAX_PAGES = 2000  # refuse anything larger: not a device manual
PDF_HEADER = b"%PDF-"
PDF_TRAILER = b"%%EOF"
MIN_RENDER_WIDTH, MAX_RENDER_WIDTH, DEFAULT_RENDER_WIDTH = 240, 1600, 1000
MAX_SEARCH_HITS = 60


class DocumentError(ValueError):
    """A rejected upload or an impossible request. ``status`` is the HTTP status to answer with."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass
class DocumentRecord:
    id: str
    kind: str
    content_type: str
    byte_size: int
    sha256: str
    page_count: int | None
    original_name: str | None
    created_at: str
    updated_at: str

    @property
    def url(self) -> str:
        return f"/api/documents/{self.id}"

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "content_type": self.content_type,
            "byte_size": self.byte_size,
            "sha256": self.sha256,
            "page_count": self.page_count,
            "original_name": self.original_name,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "url": self.url,
            "download_url": f"{self.url}/file",
        }


def is_document_id(value: str) -> bool:
    return bool(DOCUMENT_ID_RE.match(value))


def _safe_name(name: str | None) -> str | None:
    if not name:
        return None
    base = re.sub(r"[\\/]+", "/", name).split("/")[-1]
    base = "".join(ch for ch in base if ch.isprintable())
    return base[:120] or None


def download_filename(title: str | None, fallback: str) -> str:
    """A filename safe for a Content-Disposition header: ASCII letters, digits, space, dash, dot."""
    base = re.sub(r"[^A-Za-z0-9 ._-]+", "_", title or "").strip(" ._") or fallback
    if not base.lower().endswith(".pdf"):
        base += ".pdf"
    return base[:100]


def _now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _pdfium():
    import pypdfium2 as pdfium  # local binary; imported lazily so the rest of the app never depends on it

    return pdfium


def inspect_pdf(data: bytes) -> int:
    """Validate the bytes as a PDF and return the page count. Raises ``DocumentError``."""
    if not data:
        raise DocumentError("the uploaded file is empty")
    if len(data) > MAX_DOCUMENT_BYTES:
        raise DocumentError(f"document is larger than {MAX_DOCUMENT_BYTES // (1024 * 1024)} MB", 413)
    if not data.startswith(PDF_HEADER):
        raise DocumentError("not a PDF file (the PDF header is missing); only PDF documents are accepted", 415)
    if PDF_TRAILER not in data[-8192:]:
        raise DocumentError("the PDF is truncated or damaged (no end-of-file trailer)", 415)
    pdfium = _pdfium()
    try:
        pdf = pdfium.PdfDocument(data)
        try:
            count = len(pdf)
        finally:
            pdf.close()
    except pdfium.PdfiumError as e:
        hint = " (encrypted PDFs are not accepted)" if "password" in str(e).lower() else ""
        raise DocumentError(f"the file could not be opened as a PDF{hint}: {e}", 415) from e
    if count < 1:
        raise DocumentError("the PDF has no pages", 415)
    if count > MAX_PAGES:
        raise DocumentError(f"the PDF has {count} pages; the limit is {MAX_PAGES}", 413)
    return count


class DocumentStore:
    def __init__(self, db: Database, directory: Path):
        self.db = db
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ paths
    def path_for(self, rec: DocumentRecord) -> Path:
        return self.directory / f"{rec.id}.pdf"

    def cache_dir(self, rec: DocumentRecord) -> Path:
        return self.directory / "cache" / rec.id

    # ------------------------------------------------------------------ queries
    def _row(self, row) -> DocumentRecord:
        return DocumentRecord(
            id=row["id"],
            kind=row["kind"],
            content_type=row["content_type"],
            byte_size=row["byte_size"],
            sha256=row["sha256"],
            page_count=row["page_count"],
            original_name=row["original_name"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def get(self, document_id: str) -> DocumentRecord | None:
        if not is_document_id(document_id):
            return None
        row = self.db.conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
        return self._row(row) if row else None

    def get_many(self, ids: list[str]) -> dict[str, DocumentRecord]:
        out: dict[str, DocumentRecord] = {}
        for i in set(ids):
            rec = self.get(i)
            if rec:
                out[i] = rec
        return out

    def list(self) -> list[DocumentRecord]:
        rows = self.db.conn.execute("SELECT * FROM documents ORDER BY created_at DESC, id").fetchall()
        return [self._row(r) for r in rows]

    def has_file(self, rec: DocumentRecord) -> bool:
        return self.path_for(rec).is_file()

    def read_bytes(self, rec: DocumentRecord) -> bytes | None:
        p = self.path_for(rec)
        return p.read_bytes() if p.is_file() else None

    # ------------------------------------------------------------------ writes
    def ingest_pdf(
        self, data: bytes, original_name: str | None = None, document_id: str | None = None
    ) -> DocumentRecord:
        """Validate and store an uploaded PDF. ``document_id`` is only used when restoring a bundled
        document from a project file and must already be a well-formed id."""
        pages = inspect_pdf(data)
        if document_id is not None and not is_document_id(document_id):
            raise DocumentError("malformed document id")
        now = _now()
        rec = DocumentRecord(
            id=document_id or new_id("doc"),
            kind="pdf",
            content_type="application/pdf",
            byte_size=len(data),
            sha256=hashlib.sha256(data).hexdigest(),
            page_count=pages,
            original_name=_safe_name(original_name),
            created_at=now,
            updated_at=now,
        )
        if self.get(rec.id) is not None:
            raise DocumentError(f"document {rec.id} already exists", 409)
        self.path_for(rec).write_bytes(data)
        with self.db.tx() as c:
            c.execute(
                "INSERT INTO documents(id, kind, content_type, byte_size, sha256, page_count, original_name, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    rec.id,
                    rec.kind,
                    rec.content_type,
                    rec.byte_size,
                    rec.sha256,
                    rec.page_count,
                    rec.original_name,
                    rec.created_at,
                    rec.updated_at,
                ),
            )
        return rec

    def replace_pdf(self, rec: DocumentRecord, data: bytes, original_name: str | None = None) -> DocumentRecord:
        """Swap the bytes behind an existing id (a corrected or newer edition of the same manual).
        Page citations keep pointing at the id; the rendered-page cache is dropped."""
        pages = inspect_pdf(data)
        self.path_for(rec).write_bytes(data)
        self._drop_cache(rec)
        now = _now()
        with self.db.tx() as c:
            c.execute(
                "UPDATE documents SET byte_size=?, sha256=?, page_count=?, original_name=?, updated_at=? WHERE id=?",
                (
                    len(data),
                    hashlib.sha256(data).hexdigest(),
                    pages,
                    _safe_name(original_name) or rec.original_name,
                    now,
                    rec.id,
                ),
            )
        return self.get(rec.id) or rec

    def delete(self, document_id: str) -> bool:
        rec = self.get(document_id)
        if rec is None:
            return False
        with self.db.tx() as c:
            c.execute("DELETE FROM documents WHERE id = ?", (document_id,))
        try:
            self.path_for(rec).unlink(missing_ok=True)
        except OSError:
            pass
        self._drop_cache(rec)
        return True

    def _drop_cache(self, rec: DocumentRecord) -> None:
        shutil.rmtree(self.cache_dir(rec), ignore_errors=True)

    # ------------------------------------------------------------------ references
    def referenced_by(self, document_id: str) -> list[str]:
        """Profiles whose JSON mentions the document id (attached manuals and command citations)."""
        if not is_document_id(document_id):
            return []
        needle = f'"{document_id}"'
        rows = self.db.conn.execute("SELECT id FROM device_profiles WHERE instr(data, ?) > 0", (needle,))
        return [r["id"] for r in rows]

    def is_referenced(self, document_id: str) -> bool:
        return bool(self.referenced_by(document_id))

    def unreferenced(self) -> list[DocumentRecord]:
        return [r for r in self.list() if not self.is_referenced(r.id)]

    # ------------------------------------------------------------------ rendering and text
    def render_page(self, rec: DocumentRecord, page: int, width: int | None = None) -> bytes:
        """PNG of one page (1-based) at the requested width in pixels (clamped). Cached on disk."""
        width = max(MIN_RENDER_WIDTH, min(MAX_RENDER_WIDTH, width or DEFAULT_RENDER_WIDTH))
        if rec.page_count is not None and not 1 <= page <= rec.page_count:
            raise DocumentError(f"page {page} does not exist (the document has {rec.page_count} pages)", 404)
        cache = self.cache_dir(rec) / f"p{page}-w{width}.png"
        if cache.is_file():
            return cache.read_bytes()
        data = self.read_bytes(rec)
        if data is None:
            raise DocumentError("the document file is missing from the document directory", 404)
        pdfium = _pdfium()
        from io import BytesIO

        try:
            pdf = pdfium.PdfDocument(data)
            try:
                if not 1 <= page <= len(pdf):
                    raise DocumentError(f"page {page} does not exist (the document has {len(pdf)} pages)", 404)
                pg = pdf[page - 1]
                w_pt, _ = pg.get_size()
                scale = width / w_pt if w_pt > 0 else 1.0
                image = pg.render(scale=scale).to_pil()
            finally:
                pdf.close()
        except pdfium.PdfiumError as e:
            raise DocumentError(f"the page could not be rendered: {e}", 422) from e
        out = BytesIO()
        image.convert("RGB").save(out, format="PNG", optimize=True)
        png = out.getvalue()
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_bytes(png)
        except OSError:
            pass
        return png

    def page_texts(self, rec: DocumentRecord) -> list[str]:
        """Plain text of every page (local PDFium extraction, cached). Scanned PDFs yield empty strings."""
        cache = self.cache_dir(rec) / "text.json"
        if cache.is_file():
            try:
                loaded = json.loads(cache.read_text(encoding="utf-8"))
                if isinstance(loaded, list):
                    return [str(t) for t in loaded]
            except (OSError, ValueError):
                pass
        data = self.read_bytes(rec)
        if data is None:
            raise DocumentError("the document file is missing from the document directory", 404)
        pdfium = _pdfium()
        texts: list[str] = []
        try:
            pdf = pdfium.PdfDocument(data)
            try:
                for i in range(len(pdf)):
                    tp = pdf[i].get_textpage()
                    try:
                        texts.append(tp.get_text_range() or "")
                    finally:
                        tp.close()
            finally:
                pdf.close()
        except pdfium.PdfiumError as e:
            raise DocumentError(f"text could not be extracted: {e}", 422) from e
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(texts), encoding="utf-8")
        except OSError:
            pass
        return texts

    def search(self, rec: DocumentRecord, query: str) -> list[dict]:
        """Case-insensitive substring hits: [{page, snippet}], bounded. Pure text search, no OCR."""
        q = query.strip().lower()
        if len(q) < 2:
            return []
        hits: list[dict] = []
        for n, text in enumerate(self.page_texts(rec), start=1):
            low = text.lower()
            start = 0
            while True:
                i = low.find(q, start)
                if i < 0:
                    break
                a, b = max(0, i - 60), min(len(text), i + len(q) + 60)
                snippet = " ".join(text[a:b].split())
                hits.append({"page": n, "snippet": snippet})
                if len(hits) >= MAX_SEARCH_HITS:
                    return hits
                start = i + len(q)
        return hits


# ---------------------------------------------------------------------- proposals from page text (Session 6)
# "CC 12", "CC#12", "CC12", "cc 12:", "Controller 12", "Control Change 12". Deliberately simple:
# every hit is a *proposal* that a human must review and may discard; nothing is written to a
# profile here.
_CC_MENTION = re.compile(r"\b(?:CC|Control\s+Change|Controller)\s*#?\s*(\d{1,3})\b", re.IGNORECASE)
_RANGE = re.compile(r"(?<![\w.])(\d{1,3})\s*(?:-|–|to)\s*(\d{1,3})(?!\w)")
_NAME_END = re.compile(r"[.;|:=]|\(|\s\d{1,3}\s*(?:-|–|to|=)\s*\w|\s(?:value|values|range|min|max)\b", re.IGNORECASE)
_BEHAVIOR_HINTS = (
    ("toggle", re.compile(r"\btoggle", re.IGNORECASE)),
    ("trigger", re.compile(r"\b(tap|trigger|momentary|any value)\b", re.IGNORECASE)),
    ("discrete", re.compile(r"\b(on/off|bypass|engage|select|switch)\b|\b0\s*=\s*\w+.*\b127\s*=", re.IGNORECASE)),
)


def propose_controls(text: str, document_id: str, page: int) -> list[dict]:
    """Candidate CC definitions found in one page of text, shaped like ``CcDef`` JSON plus the
    matched snippet. Each is ``review_status = "proposed"``, cites the page, and carries
    ``evidence = documented`` (the text is from the attached document) — never any hardware claim.
    One proposal per CC number (first occurrence wins); numbers above 127 are dropped. The name is
    the text that follows the number up to the next sentence/table break; a ``lo-hi`` range in the
    same span becomes the value range; a few words hint at the behaviour, which stays a hint."""
    out: list[dict] = []
    seen: set[int] = set()
    flat = " ".join(text.split())
    mentions = list(_CC_MENTION.finditer(flat))
    for i, m in enumerate(mentions):
        cc = int(m.group(1))
        if cc > 127 or cc in seen:
            continue
        span_end = mentions[i + 1].start() if i + 1 < len(mentions) else len(flat)
        span = flat[m.end() : min(span_end, m.end() + 160)]
        tail = span.lstrip(" :=-–|.\t")
        stop = _NAME_END.search(tail)
        name = tail[: stop.start()] if stop else tail
        name = name.strip(" :=-–|.,")[:60] or f"CC {cc}"
        rng = None
        r = _RANGE.search(span)
        if r is not None:
            lo, hi = int(r.group(1)), int(r.group(2))
            if lo <= hi <= 127:
                rng = (lo, hi)
        behavior = None
        for label, rx in _BEHAVIOR_HINTS:
            if rx.search(span):
                behavior = label
                break
        a, b = max(0, m.start() - 30), min(len(flat), m.end() + min(len(span), 90))
        seen.add(cc)
        out.append(
            {
                "cc": cc,
                "name": name,
                "value_semantics": None,
                "evidence": "documented",
                "behavior": behavior,
                "min_value": rng[0] if rng else None,
                "max_value": rng[1] if rng else None,
                "citation": {"document_id": document_id, "page": page, "note": None},
                "mapping": "manufacturer_default",
                "factory_cc": None,
                "hardware_status": "unverified",
                "hardware_note": None,
                "review_status": "proposed",
                "notes": None,
                "snippet": flat[a:b].strip(),
            }
        )
    return out


def default_documents_dir(db_path: Path) -> Path:
    env = os.environ.get("SIGNAL_LOOM_DOCS")
    return Path(env) if env else db_path.parent / "documents"
