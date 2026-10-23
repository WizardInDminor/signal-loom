"""PDFium is not thread-safe. FastAPI serves sync endpoints from a thread pool, and the Knowledge
Workbench viewer asks for the next page while the current one renders, so two renders *do* overlap
in normal use. Before the lock in ``app.documents`` that overlap crashed the whole backend process
(a segfault, observed during Session 6 visual testing). These tests pin the fix: every PDFium call
runs under one lock, and overlapping requests all succeed."""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from app import documents as docmod
from app.main import create_app

from .support.pdf import make_pdf

PDF = make_pdf([f"Synthetic page {i}. CC {10 + i} Control {i}." for i in range(1, 7)])


def _profile_with_pdf(client, pid="pdf-concurrency"):
    body = {
        "id": pid,
        "manufacturer": "Test",
        "model": "Concurrent",
        "provenance": {"source": "user", "evidence": "user"},
    }
    assert client.post("/api/catalog/devices", json=body).status_code == 201
    r = client.post(f"/api/catalog/devices/{pid}/documents", files={"file": ("m.pdf", PDF, "application/pdf")})
    assert r.status_code == 201, r.text
    return r.json()["documents"][0]["document_id"]


def test_overlapping_page_renders_text_extraction_and_proposals_all_succeed(db_path):
    with TestClient(create_app(db_path)) as client:
        did = _profile_with_pdf(client)
        # Distinct widths defeat the on-disk cache, so every request really renders.
        jobs = [
            (f"/api/documents/{did}/pages/{p}", {"width": 300 + 7 * k}) for k, p in enumerate([1, 2, 3, 4, 5, 6] * 3)
        ]
        jobs += [(f"/api/documents/{did}/search", {"q": "control"})] * 3
        jobs += [(f"/api/documents/{did}/pages/2/proposals", {})] * 3

        def hit(job):
            path, params = job
            return client.get(path, params=params).status_code

        with ThreadPoolExecutor(max_workers=8) as pool:
            codes = list(pool.map(hit, jobs))
        assert codes == [200] * len(jobs)
        assert client.get("/api/health").status_code == 200  # the process is still here


def test_pdfium_is_never_entered_by_two_threads_at_once(db_path, monkeypatch):
    """Drive the real store with a fake PDFium that records how many threads are inside it."""
    inside, peak = [0], [0]
    gate = threading.Lock()

    class FakePage:
        def get_size(self):
            return (595.0, 842.0)

        def render(self, scale):
            class Img:
                def to_pil(self):
                    from PIL import Image

                    return Image.new("RGB", (8, 8), "white")

            return Img()

        def get_textpage(self):
            class TP:
                def get_text_range(self):
                    return "CC 12 Level"

                def close(self):
                    pass

            return TP()

    class FakePdf:
        def __init__(self, data):
            with gate:
                inside[0] += 1
                peak[0] = max(peak[0], inside[0])
            time.sleep(0.01)  # long enough for a second thread to arrive if the lock were missing

        def __len__(self):
            return 3

        def __getitem__(self, i):
            return FakePage()

        def close(self):
            with gate:
                inside[0] -= 1

    class FakePdfium:
        PdfDocument = FakePdf

        class PdfiumError(Exception):
            pass

    monkeypatch.setattr(docmod, "_pdfium", lambda: FakePdfium)
    with TestClient(create_app(db_path)) as client:
        did = _profile_with_pdf(client)
        # Render, text extraction and inspection (replace) interleaved from eight threads.
        work = [
            lambda k=k: client.get(f"/api/documents/{did}/pages/{1 + k % 3}", params={"width": 240 + k}).status_code
            for k in range(12)
        ]
        work += [lambda: client.get(f"/api/documents/{did}/search", params={"q": "cc"}).status_code for _ in range(4)]
        with ThreadPoolExecutor(max_workers=8) as pool:
            codes = list(pool.map(lambda f: f(), work))
        assert all(c == 200 for c in codes), codes
    assert peak[0] == 1, f"{peak[0]} threads were inside PDFium at once"


def test_the_lock_is_reentrant_for_nested_store_calls():
    # ``search`` → ``page_texts`` → PDFium; a non-reentrant lock would deadlock a caller that already holds it.
    assert isinstance(docmod._PDFIUM_LOCK, type(threading.RLock()))
    with docmod._PDFIUM_LOCK:
        with docmod._PDFIUM_LOCK:
            pass
