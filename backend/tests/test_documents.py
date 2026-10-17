"""Session 3f, Part A: user-supplied PDF manuals attached to device profiles.

Every PDF here is synthetic (``tests/support/pdf.py``); no manufacturer document is read or bundled.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.documents import DocumentError, inspect_pdf
from app.main import create_app

from .support.pdf import make_pdf

MANUAL = make_pdf(
    [
        "Signal Loom test manual (synthetic)",
        "MIDI implementation chart. CC 10 = Bypass/engage A side: 0 = bypass, 1-127 = engage.",
        "Program Change: PC 0-127 recalls presets 1-128 as shown on the display.",
    ]
)


def _custom_profile(client, pid="e2e-doc-pedal"):
    body = {
        "id": pid,
        "manufacturer": "Test",
        "model": "Doc pedal",
        "provenance": {"source": "user", "evidence": "user"},
        "midi": {"interfaces": ["din_in"], "default_channel": 1, "evidence": "user"},
    }
    r = client.post("/api/catalog/devices", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _attach(client, pid, data=MANUAL, name="sunset-manual.pdf", title=None, kind=None, ctype="application/pdf"):
    form = {}
    if title is not None:
        form["title"] = title
    if kind is not None:
        form["kind"] = kind
    return client.post(f"/api/catalog/devices/{pid}/documents", files={"file": (name, data, ctype)}, data=form)


def test_upload_attach_view_search_download_and_reopen_after_restart(db_path):
    with TestClient(create_app(db_path)) as client:
        _custom_profile(client)
        r = _attach(client, "e2e-doc-pedal", title="Owner's manual", kind="manual")
        assert r.status_code == 201, r.text
        prof = r.json()
        (ref,) = prof["documents"]
        doc_id = ref["document_id"]
        assert doc_id.startswith("doc_") and len(doc_id) == 16
        assert ref["title"] == "Owner's manual" and ref["kind"] == "manual"
        # The profile JSON carries the reference only, never bytes; the API says the file is here.
        assert "data_base64" not in json.dumps(prof)
        assert prof["document_files"] == [
            {"document_id": doc_id, "present": True, "page_count": 3, "byte_size": len(MANUAL)}
        ]
        meta = client.get(f"/api/documents/{doc_id}").json()
        assert meta["page_count"] == 3 and meta["referenced_by"] == ["e2e-doc-pedal"] and meta["file_present"]
        assert meta["original_name"] == "sunset-manual.pdf"
        # Pages are served as pictures (nothing inside the PDF can run in the app).
        page = client.get(f"/api/documents/{doc_id}/pages/2?width=400")
        assert page.status_code == 200 and page.headers["content-type"] == "image/png"
        assert page.content[:8] == b"\x89PNG\r\n\x1a\n"
        assert page.headers["x-content-type-options"] == "nosniff"
        assert client.get(f"/api/documents/{doc_id}/pages/4").status_code == 404
        assert client.get(f"/api/documents/{doc_id}/pages/0").status_code == 404
        # Local text search finds the citation page.
        hits = client.get(f"/api/documents/{doc_id}/search", params={"q": "cc 10"}).json()
        assert hits["has_text_layer"] and hits["hits"][0]["page"] == 2 and "Bypass/engage" in hits["hits"][0]["snippet"]
        assert client.get(f"/api/documents/{doc_id}/search", params={"q": "x"}).json()["hits"] == []
        # The original is only ever a download, with conservative headers.
        dl = client.get(f"/api/documents/{doc_id}/file")
        assert dl.status_code == 200 and dl.content == MANUAL
        assert dl.headers["content-type"] == "application/pdf"
        assert dl.headers["content-disposition"] == 'attachment; filename="Owner_s manual.pdf"'
        assert dl.headers["x-content-type-options"] == "nosniff"
        assert "sandbox" in dl.headers["content-security-policy"] and "no-store" in dl.headers["cache-control"]
    # "Reload": a new process against the same database and document directory still has it.
    with TestClient(create_app(db_path)) as client:
        prof = client.get("/api/catalog/devices/e2e-doc-pedal").json()
        assert prof["documents"][0]["document_id"] == doc_id and prof["document_files"][0]["present"]
        assert client.get(f"/api/documents/{doc_id}/pages/1").status_code == 200


def test_rejects_non_pdf_oversized_and_unsafe_input(client, monkeypatch):
    _custom_profile(client)
    pid = "e2e-doc-pedal"
    # Claimed content type is ignored; the bytes decide.
    assert _attach(client, pid, b"\xff\xd8\xff\xe0 not a pdf", name="manual.pdf").status_code == 415
    assert _attach(client, pid, b"<html><script>alert(1)</script></html>", name="m.pdf").status_code == 415
    # A PDF header on garbage: PDFium refuses it.
    assert _attach(client, pid, b"%PDF-1.7\n garbage garbage\n%%EOF").status_code == 415
    # Truncated (no trailer).
    assert _attach(client, pid, MANUAL[: len(MANUAL) // 2]).status_code == 415
    assert _attach(client, pid, b"").status_code in (400, 415)
    # Size bound (patched down so the test stays small).
    monkeypatch.setattr("app.documents.MAX_DOCUMENT_BYTES", 600)
    assert _attach(client, pid).status_code == 413
    monkeypatch.undo()
    with pytest.raises(DocumentError):
        inspect_pdf(b"%PDF-1.4\n%%EOF")
    # Ids are opaque and path-shaped input never reaches the filesystem.
    assert client.get("/api/documents/doc_..%2F..%2Fetc").status_code == 404
    assert client.get("/api/documents/%2E%2E%2F%2E%2E%2Fetc%2Fpasswd").status_code == 404
    assert client.get("/api/documents/doc_zzzzzzzzzzzz").status_code == 404
    # A hostile original filename is reduced to display text only.
    r = _attach(client, pid, name="..\\..\\etc/../passwd.pdf")
    assert r.status_code == 201
    doc_id = r.json()["documents"][0]["document_id"]
    assert client.get(f"/api/documents/{doc_id}").json()["original_name"] == "passwd.pdf"
    # Nothing was written outside the document directory, and the profile is intact.
    prof = client.get(f"/api/catalog/devices/{pid}").json()
    assert len(prof["documents"]) == 1 and prof["manufacturer"] == "Test"


def test_rename_replace_detach_and_reference_aware_deletion(client):
    _custom_profile(client, "p-one")
    _custom_profile(client, "p-two")
    doc_id = _attach(client, "p-one", title="Quick start", kind="quick_start").json()["documents"][0]["document_id"]
    # Rename / reclassify touches only the reference.
    r = client.patch(
        f"/api/catalog/devices/p-one/documents/{doc_id}",
        json={"title": "MIDI chart", "kind": "midi_chart", "note": "rev B"},
    )
    assert r.status_code == 200 and r.json()["documents"][0] == {
        "document_id": doc_id,
        "title": "MIDI chart",
        "kind": "midi_chart",
        "note": "rev B",
    }
    assert client.patch("/api/catalog/devices/p-one/documents/doc_000000000000", json={"title": "x"}).status_code == 404
    # The same file may be attached to a second profile by reference (no second upload).
    two = client.get("/api/catalog/devices/p-two").json()
    two["documents"] = [{"document_id": doc_id, "title": "Shared manual", "kind": "manual"}]
    assert client.put("/api/catalog/devices/p-two", json=two).status_code == 200
    assert sorted(client.get(f"/api/documents/{doc_id}").json()["referenced_by"]) == ["p-one", "p-two"]
    # Replacing keeps the id (citations stay valid) but is refused while another profile shares it.
    newer = make_pdf(["edition 2"] * 5)
    rep = client.post(
        f"/api/catalog/devices/p-one/documents/{doc_id}/replace", files={"file": ("v2.pdf", newer, "application/pdf")}
    )
    assert rep.status_code == 409
    rep = client.post(
        f"/api/catalog/devices/p-one/documents/{doc_id}/replace?force=1",
        files={"file": ("v2.pdf", newer, "application/pdf")},
    )
    assert rep.status_code == 200 and rep.json()["documents"][0]["document_id"] == doc_id
    assert rep.json()["document_files"][0]["page_count"] == 5
    assert client.get(f"/api/documents/{doc_id}/file").content == newer
    assert (
        client.post(
            f"/api/catalog/devices/p-one/documents/{doc_id}/replace?force=1",
            files={"file": ("v2.pdf", b"nope", "application/pdf")},
        ).status_code
        == 415
    )
    # Deleting a referenced document outright is refused; detaching never deletes bytes implicitly.
    assert client.delete(f"/api/documents/{doc_id}").status_code == 409
    r = client.delete(f"/api/catalog/devices/p-one/documents/{doc_id}?purge=1")
    assert r.status_code == 200 and r.json()["documents"] == []
    assert client.get(f"/api/documents/{doc_id}").status_code == 200, "still used by p-two"
    assert client.delete(f"/api/catalog/devices/p-two/documents/{doc_id}").status_code == 200
    assert client.get(f"/api/documents/{doc_id}").status_code == 200, "detach without purge keeps the file"
    listed = client.get("/api/documents").json()
    assert [d["id"] for d in listed] == [doc_id] and listed[0]["referenced_by"] == []
    assert client.delete("/api/documents/unreferenced").json() == {"removed": [doc_id], "count": 1}
    assert client.get(f"/api/documents/{doc_id}").status_code == 404
    # Profiles are intact after all of it.
    assert client.get("/api/catalog/devices/p-one").json()["model"] == "Doc pedal"
    assert client.delete(f"/api/catalog/devices/p-one/documents/{doc_id}").status_code == 404


def test_export_bundles_documents_only_on_request_and_import_tolerates_missing_files(client, tmp_path):
    _custom_profile(client)
    doc_id = _attach(client, "e2e-doc-pedal", title="Manual").json()["documents"][0]["document_id"]
    rig = client.post("/api/rigs", json={"name": "Docs rig"}).json()
    rig["instances"].append({"profile_id": "e2e-doc-pedal", "label": "Pedal", "id": "inst_doc"})
    rig["revision"] += 1
    assert client.put(f"/api/rigs/{rig['id']}", json=rig).status_code == 200
    plain = client.get(f"/api/rigs/{rig['id']}/export").json()
    assert plain["format_version"] == 1 and "documents" not in plain and plain["assets"] == []
    assert plain["profiles"][0]["documents"][0]["document_id"] == doc_id  # the reference travels, the bytes do not
    full = client.get(f"/api/rigs/{rig['id']}/export?include_documents=1").json()
    assert full["format_version"] == 3 and [d["id"] for d in full["documents"]] == [doc_id]
    assert full["documents"][0]["page_count"] == 3
    # A format-1 file cannot smuggle documents.
    bad = {**full, "format_version": 1}
    assert client.post("/api/rigs/import", content=json.dumps(bad)).status_code == 422
    # Fresh computer, metadata-only file: the profile keeps its reference and the UI is told.
    with TestClient(create_app(tmp_path / "other.sqlite3")) as other:
        res = other.post("/api/rigs/import", content=json.dumps(plain)).json()
        assert any("not on this computer" in w and doc_id in w for w in res["warnings"])
        prof = other.get("/api/catalog/devices/e2e-doc-pedal").json()
        assert prof["documents"][0]["document_id"] == doc_id
        assert prof["document_files"] == [
            {"document_id": doc_id, "present": False, "page_count": None, "byte_size": None}
        ]
        assert other.get(f"/api/documents/{doc_id}").status_code == 404
        assert other.get(f"/api/rigs/{res['rig']['id']}/analysis").json()["summary"]["errors"] == 0
    # Fresh computer, documents-inclusive file: bytes restored under the same id through validation.
    with TestClient(create_app(tmp_path / "third.sqlite3")) as third:
        res = third.post("/api/rigs/import", content=json.dumps(full)).json()
        assert not any(doc_id in w for w in res["warnings"])
        assert third.get(f"/api/documents/{doc_id}/file").content == MANUAL
        assert third.get("/api/catalog/devices/e2e-doc-pedal").json()["document_files"][0]["present"]
        # A corrupt bundled document is reported, not restored, and nothing else fails.
        broken = json.loads(json.dumps(full))
        broken["documents"][0]["id"] = "doc_0123456789ab"
        broken["documents"][0]["data_base64"] = "bm90IGEgcGRm"
        res = third.post("/api/rigs/import", content=json.dumps(broken)).json()
        assert any("was not restored" in w for w in res["warnings"])
