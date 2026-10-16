"""Session 3b: user device images — validated local assets, crop/calibration metadata on
profiles and instances, resolution into analysis/previews, deletion rules, export/import.

The fixture photograph is synthetic (drawn with Pillow), so nothing here depends on a vendor's
product photography.
"""

from __future__ import annotations

import base64
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from app.assets import sanitize_image
from app.main import create_app

FIXTURE = Path(__file__).parent / "fixtures" / "pedal-photo.jpg"
CROP = {"x": 0.2111, "y": 0.1917, "w": 0.4667, "h": 0.6333}  # the drawn enclosure inside the photo


def _upload(client, data: bytes | None = None, name="pedal-photo.jpg", ctype="image/jpeg"):
    return client.post("/api/assets/images", files={"file": (name, data or FIXTURE.read_bytes(), ctype)})


def _png_with_alpha() -> bytes:
    b = BytesIO()
    Image.new("RGBA", (120, 80), (0, 0, 0, 0)).save(b, format="PNG")
    return b.getvalue()


def _jpeg_with_orientation(orientation: int) -> bytes:
    exif = Image.Exif()
    exif[0x0112] = orientation
    exif[0x010E] = "a description that must not survive"
    b = BytesIO()
    Image.open(FIXTURE).save(b, format="JPEG", exif=exif.tobytes())
    return b.getvalue()


def test_upload_sanitizes_and_serves_the_image(client):
    r = _upload(client, _jpeg_with_orientation(6))
    assert r.status_code == 201, r.text
    rec = r.json()
    assert rec["id"].startswith("img_") and len(rec["id"]) == 16
    # EXIF orientation 6 is applied (900x1200 portrait source becomes 1200x900) and then dropped.
    assert (rec["width"], rec["height"]) == (1200, 900)
    assert rec["content_type"] == "image/jpeg" and rec["url"] == f"/api/assets/images/{rec['id']}"
    served = client.get(rec["url"])
    assert served.status_code == 200 and served.headers["content-type"] == "image/jpeg"
    assert "immutable" in served.headers["cache-control"]
    img = Image.open(BytesIO(served.content))
    assert img.size == (1200, 900) and not img.getexif()
    meta = client.get(f"{rec['url']}/meta").json()
    assert meta["referenced_by"] == {"profiles": [], "rigs": []}
    assert meta["original_name"] == "pedal-photo.jpg"


def test_upload_rejects_unsupported_and_damaged_files(client):
    svg = b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
    r = _upload(client, svg, name="evil.svg", ctype="image/svg+xml")
    assert r.status_code == 400 and "SVG" in r.json()["detail"]
    # The client's content type is not trusted: a text file claiming to be a JPEG is still rejected.
    r = _upload(client, b"not an image at all", name="x.jpg", ctype="image/jpeg")
    assert r.status_code == 400
    # A GIF is a real image but not an accepted format.
    b = BytesIO()
    Image.new("P", (10, 10)).save(b, format="GIF")
    r = _upload(client, b.getvalue(), name="a.gif", ctype="image/gif")
    assert r.status_code == 415
    # Truncated JPEG data is reported as damaged, not stored.
    r = _upload(client, FIXTURE.read_bytes()[:4000])
    assert r.status_code == 400 and "damaged" in r.json()["detail"]
    assert client.get("/api/assets/images").json() == []


def test_pixel_limit_and_downscale():
    big = BytesIO()
    Image.new("RGB", (9000, 5000)).save(big, format="PNG")
    try:
        sanitize_image(big.getvalue())
        raise AssertionError("40 MP limit not enforced")
    except ValueError as e:
        assert "megapixels" in str(e)
    wide = BytesIO()
    Image.new("RGB", (4000, 1000), (1, 2, 3)).save(wide, format="JPEG")
    _, _, _, w, h = sanitize_image(wide.getvalue())
    assert (w, h) == (2048, 512)
    _, ctype, ext, _, _ = sanitize_image(_png_with_alpha())
    assert (ctype, ext) == ("image/png", "png")  # transparency is kept


def test_asset_ids_are_strict_and_paths_cannot_be_chosen(client):
    for bad in ("..%2F..%2Fetc%2Fpasswd", "img_zzzzzzzzzzzz", "img_0123456789ab.jpg", "x"):
        assert client.get(f"/api/assets/images/{bad}").status_code == 404
    assert client.get("/api/assets/images/img_0123456789ab").status_code == 404


def test_profile_image_calibration_round_trip_and_resolution(client):
    asset = _upload(client).json()
    bigsky = client.get("/api/catalog/devices/strymon-bigsky-mx").json()
    bigsky.pop("unknown_attributes")
    bigsky.pop("source")
    # An image must point at an asset on this computer.
    bigsky["image"] = {"asset_id": "img_000000000000", "crop": CROP}
    assert client.put("/api/catalog/devices/strymon-bigsky-mx", json=bigsky).status_code == 422
    # A crop outside the image is refused by the model.
    bigsky["image"] = {"asset_id": asset["id"], "crop": {"x": 0.8, "y": 0, "w": 0.5, "h": 0.5}}
    assert client.put("/api/catalog/devices/strymon-bigsky-mx", json=bigsky).status_code == 422
    bigsky["image"] = {"asset_id": asset["id"], "crop": CROP, "rotation_quarter": 1, "fit": "cover", "calibrated": True}
    r = client.put("/api/catalog/devices/strymon-bigsky-mx", json=bigsky)
    assert r.status_code == 200, r.text
    saved = r.json()
    assert (
        saved["image"]["crop"] == CROP
        and saved["image"]["rotation_quarter"] == 1
        and saved["image"]["calibrated"] is True
    )
    # Physical and MIDI data are untouched by adding a picture.
    assert saved["footprint"]["width"]["value_mm"] == 177.8 and saved["midi"]["interfaces"]
    # Every BigSky instance resolves the same picture; geometry is unchanged.
    a = client.get("/api/rigs/rig_demo_stereo/analysis").json()
    inst = a["instances"]["inst_bigsky"]
    assert inst["image"]["asset_id"] == asset["id"] and inst["image"]["source"] == "profile"
    assert inst["image"]["url"] == asset["url"] and (inst["image"]["width"], inst["image"]["height"]) == (900, 1200)
    assert inst["image"]["fit"] == "cover" and inst["image"]["rotation_quarter"] == 1
    assert (inst["width_mm"], inst["height_mm"]) == (round(177.8, 1), 127.0)
    assert len(inst["ports"]) > 0 and a["instances"]["inst_plumes"]["image"] is None
    # The rig library miniature carries the picture too.
    summary = next(s for s in client.get("/api/rigs").json() if s["id"] == "rig_demo_stereo")
    dev = next(d for d in summary["preview"]["devices"] if d["image"])
    assert dev["image"]["asset_id"] == asset["id"] and dev["rotation"] == 0
    # The asset now reports its reference and refuses deletion until it is removed from the profile.
    assert client.get(f"{asset['url']}/meta").json()["referenced_by"]["profiles"] == ["strymon-bigsky-mx"]
    assert client.delete(asset["url"]).status_code == 409
    # Removing the image restores the plain enclosure and frees the asset.
    saved.pop("unknown_attributes")
    saved.pop("source")
    saved["image"] = None
    assert client.put("/api/catalog/devices/strymon-bigsky-mx", json=saved).status_code == 200
    assert client.get("/api/rigs/rig_demo_stereo/analysis").json()["instances"]["inst_bigsky"]["image"] is None
    assert client.delete(asset["url"]).status_code == 204
    assert client.get(asset["url"]).status_code == 404


def test_instance_override_wins_and_rotation_is_geometry_only(client):
    a1 = _upload(client).json()
    a2 = _upload(client, _png_with_alpha(), name="custom.png", ctype="image/png").json()
    prof = client.get("/api/catalog/devices/eqd-plumes").json()
    prof.pop("unknown_attributes")
    prof.pop("source")
    prof["image"] = {"asset_id": a1["id"], "crop": CROP, "calibrated": True}
    assert client.put("/api/catalog/devices/eqd-plumes", json=prof).status_code == 200
    rig = client.get("/api/rigs/rig_demo_signal_loom").json()
    plumes = next(i for i in rig["instances"] if i["id"] == "inst_plumes")
    plumes["image"] = {"asset_id": a2["id"], "crop": {"x": 0, "y": 0, "w": 1, "h": 1}}
    plumes["rotation"] = 90
    rig["revision"] += 1
    assert client.put(f"/api/rigs/{rig['id']}", json=rig).status_code == 200
    a = client.get(f"/api/rigs/{rig['id']}/analysis").json()
    inst = a["instances"]["inst_plumes"]
    assert inst["image"]["asset_id"] == a2["id"] and inst["image"]["source"] == "instance"
    # Rotation swapped the footprint and moved the jacks; the image record is only told the quarter turn.
    assert (inst["width_mm"], inst["height_mm"]) == (121.0, 64.0)
    assert {p["edge"] for p in inst["ports"]} <= {"top", "right", "bottom", "left", "top_face"}
    # Project files stay compatible: the plain export carries the metadata but no bytes.
    plain = client.get(f"/api/rigs/{rig['id']}/export").json()
    assert plain["format_version"] == 1 and plain["assets"] == []
    assert next(p for p in plain["profiles"] if p["id"] == "eqd-plumes")["image"]["asset_id"] == a1["id"]


def test_missing_assets_are_handled_and_bundled_backups_restore_them(client, tmp_path):
    import json

    asset = _upload(client).json()
    # A per-unit override on a copy of the demo rig (overrides travel with the rig document).
    rig = client.post("/api/rigs/rig_demo_signal_loom/duplicate").json()
    sunset = next(i for i in rig["instances"] if i["id"] == "inst_sunset")
    sunset["image"] = {"asset_id": asset["id"], "crop": CROP, "calibrated": True}
    rig["revision"] += 1
    assert client.put(f"/api/rigs/{rig['id']}", json=rig).status_code == 200
    plain = client.get(f"/api/rigs/{rig['id']}/export").json()
    bundled = client.get(f"/api/rigs/{rig['id']}/export?include_images=1").json()
    assert plain["format_version"] == 1 and plain["assets"] == []
    assert bundled["format_version"] == 2 and [a["id"] for a in bundled["assets"]] == [asset["id"]]
    assert base64.b64decode(bundled["assets"][0]["data_base64"])[:3] == b"\xff\xd8\xff"
    # A second computer: fresh database and asset directory.
    other = create_app(tmp_path / "other.sqlite3")
    with TestClient(other) as c2:
        r = c2.post("/api/rigs/import", content=json.dumps(plain))
        assert r.status_code == 201
        assert any("not on this computer" in w for w in r.json()["warnings"])
        # Metadata is kept; resolution reports the asset as missing and the renderer falls back.
        rid = r.json()["rig"]["id"]
        img = c2.get(f"/api/rigs/{rid}/analysis").json()["instances"]["inst_sunset"]["image"]
        assert img == {"asset_id": asset["id"], "missing": True, "source": "instance"}
        assert c2.get(asset["url"]).status_code == 404
        # The opt-in bundle restores the picture under the same id, through the upload validation.
        r = c2.post("/api/rigs/import?name=with-images", content=json.dumps(bundled))
        assert r.status_code == 201 and not any("not on this computer" in w for w in r.json()["warnings"])
        assert c2.get(asset["url"]).status_code == 200
        rid2 = r.json()["rig"]["id"]
        resolved = c2.get(f"/api/rigs/{rid2}/analysis").json()["instances"]["inst_sunset"]["image"]
        assert resolved["missing"] is False and resolved["crop"] == CROP
        # A tampered bundle (non-image bytes) is reported, never stored.
        bad = dict(bundled)
        bad["assets"] = [
            {"id": "img_abcdefabcdef", "content_type": "image/jpeg", "data_base64": base64.b64encode(b"nope").decode()}
        ]
        r = c2.post("/api/rigs/import?name=bad", content=json.dumps(bad))
        assert r.status_code == 201 and any("was not restored" in w for w in r.json()["warnings"])
        assert c2.get("/api/assets/images/img_abcdefabcdef").status_code == 404
        # A version-1 file is never allowed to smuggle binary data.
        smuggle = dict(plain)
        smuggle["assets"] = bundled["assets"]
        assert c2.post("/api/rigs/import", content=json.dumps(smuggle)).status_code == 422


def test_existing_rigs_without_images_are_unchanged(client):
    a = client.get("/api/rigs/rig_demo_stereo/analysis").json()
    assert all(v["image"] is None for v in a["instances"].values())
    assert a["summary"]["errors"] == 0
    exported = client.get("/api/rigs/rig_demo_stereo/export").json()
    assert exported["format_version"] == 1 and "assets" in exported and exported["assets"] == []
