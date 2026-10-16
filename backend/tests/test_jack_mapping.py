"""Session 3c: image-assisted jack mapping.

A connector's *appearance* in a photograph (``image_anchor``) is a visual annotation; wiring
geometry still comes from ``edge``/``position``. Jack ids are stable handles for cables, so the
ports-only update refuses to drop one that a rig uses unless the user confirms. User-entered
connector facts carry their own evidence, separate from third-party dimensions.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.catalog.builtin import builtin_profiles
from app.domain.geometry import placed_ports
from app.models.profile import DeviceProfile, PortDef
from app.models.rig import DeviceInstance

FIXTURE = Path(__file__).parent / "fixtures" / "pedal-photo.jpg"


def _upload(client):
    return client.post("/api/assets/images", files={"file": ("pedal.jpg", FIXTURE.read_bytes(), "image/jpeg")}).json()


def _pp_import(client, brand="Acme", name="Boost", width=2.6, height=4.9):
    pp = [{"Brand": brand, "Name": name, "Width": width, "Height": height, "Image": "x.png"}]
    assert client.post("/api/catalog/import/pedalplayground", content=json.dumps(pp)).json()["imported"] == 1
    return f"pp-{brand.lower()}-{name.lower()}"


def _port(pid, label, kind, direction, edge, position, asset_id=None, ax=0.5, ay=0.5, **extra):
    d = {
        "id": pid,
        "label": label,
        "kind": kind,
        "direction": direction,
        "edge": edge,
        "position": position,
        "position_evidence": "user",
        "evidence": "user",
        **extra,
    }
    if asset_id:
        d["image_anchor"] = {"x": ax, "y": ay, "asset_id": asset_id}
    return d


def test_anchor_is_an_annotation_and_wiring_geometry_ignores_it(profiles):
    """Two ports with different anchors but the same edge/position land on the same wiring point."""
    prof = DeviceProfile(
        id="t",
        manufacturer="T",
        model="T",
        footprint={"width": {"value_mm": 60, "evidence": "user"}, "depth": {"value_mm": 120, "evidence": "user"}},
        ports=[
            PortDef.model_validate(_port("a", "A", "audio", "in", "right", 0.25, "img_0123456789ab", 0.9, 0.1)),
            PortDef.model_validate(_port("b", "B", "audio", "out", "right", 0.25, "img_0123456789ab", 0.1, 0.9)),
        ],
    )
    inst = DeviceInstance(profile_id="t", label="t", x_mm=0, y_mm=0)
    pa, pb = placed_ports(inst, prof)
    assert (pa.x_mm, pa.y_mm) == (pb.x_mm, pb.y_mm) == (60.0, 30.0)
    assert pa.estimated is False  # user-confirmed position


def test_anchor_validation(client):
    pid = _pp_import(client)
    bad_point = {"ports": [_port("in", "In", "audio", "in", "right", 0.5, "img_0123456789ab", 1.2, 0.5)]}
    assert client.put(f"/api/catalog/devices/{pid}/ports", json=bad_point).status_code == 422
    bad_id = {"ports": [_port("in", "In", "audio", "in", "right", 0.5)]}
    bad_id["ports"][0]["image_anchor"] = {"x": 0.5, "y": 0.5, "asset_id": "../../etc"}
    assert client.put(f"/api/catalog/devices/{pid}/ports", json=bad_id).status_code == 422
    # An anchor must refer to a picture on this computer.
    missing = {"ports": [_port("in", "In", "audio", "in", "right", 0.5, "img_0123456789ab")]}
    r = client.put(f"/api/catalog/devices/{pid}/ports", json=missing)
    assert r.status_code == 422 and "not on this computer" in r.json()["detail"]
    dup = {"ports": [_port("in", "In", "audio", "in", "right", 0.5), _port("in", "In 2", "audio", "out", "left", 0.5)]}
    assert client.put(f"/api/catalog/devices/{pid}/ports", json=dup).status_code == 422


def test_ports_only_update_enriches_an_imported_profile_without_touching_its_other_facts(client):
    pid = _pp_import(client)
    before = client.get(f"/api/catalog/devices/{pid}").json()
    assert before["ports"] == [] and before["footprint"]["width"]["evidence"] == "third_party"
    asset = _upload(client)
    before.pop("unknown_attributes")
    before.pop("source")
    before["image"] = {"asset_id": asset["id"], "crop": {"x": 0.2, "y": 0.2, "w": 0.5, "h": 0.6}, "calibrated": True}
    assert client.put(f"/api/catalog/devices/{pid}", json=before).status_code == 200
    ports = [
        _port(
            "in", "In", "audio", "in", "right", 0.3, asset["id"], 0.75, 0.4, connector="ts_1_4", audio_channel="mono"
        ),
        _port(
            "out", "Out", "audio", "out", "left", 0.3, asset["id"], 0.15, 0.4, connector="ts_1_4", audio_channel="mono"
        ),
        # A plug visible *outside* the crop: the anchor may lie beyond the crop rectangle.
        _port("dc", "DC 9V", "power", "in", "top", 0.5, asset["id"], 0.45, 0.12, connector="dc_barrel_2_1mm"),
    ]
    r = client.put(f"/api/catalog/devices/{pid}/ports", json={"ports": ports})
    assert r.status_code == 200, r.text
    after = r.json()
    assert [p["id"] for p in after["ports"]] == ["in", "out", "dc"]
    assert all(p["evidence"] == "user" and p["position_evidence"] == "user" for p in after["ports"])
    assert after["ports"][2]["image_anchor"] == {"x": 0.45, "y": 0.12, "asset_id": asset["id"]}
    # Third-party dimensions, attribution, picture and source are exactly as before.
    assert after["footprint"] == before["footprint"]
    assert after["provenance"] == before["provenance"] and after["source"] == "imported"
    assert after["image"]["asset_id"] == asset["id"] and after["image"]["crop"] == before["image"]["crop"]
    assert "port.dc.position" not in after["unknown_attributes"]
    # Recropping later leaves the jacks (anchors and wiring positions) untouched.
    after.pop("unknown_attributes")
    after.pop("source")
    after["image"]["crop"] = {"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.8}
    r2 = client.put(f"/api/catalog/devices/{pid}", json=after).json()
    assert r2["ports"] == after["ports"]


def test_removing_or_renaming_a_wired_jack_is_refused_until_confirmed(client):
    plumes = client.get("/api/catalog/devices/eqd-plumes").json()
    usage = client.get("/api/catalog/devices/eqd-plumes/port-usage").json()
    # The demo rigs plug Send A into Plumes' "in" and Plumes' "out" into Return A.
    assert {u["rig_id"] for u in usage["in"]} == {"rig_demo_signal_loom", "rig_demo_stereo"}
    assert usage["in"][0]["other_label"].startswith("ML10X: send_a_tip")
    assert "dc" not in usage or usage["dc"]  # power may or may not be cabled in the demo
    # Rename "in" -> "input": the old id disappears, so the cables would dangle.
    ports = [dict(p, id="input") if p["id"] == "in" else p for p in plumes["ports"]]
    r = client.put("/api/catalog/devices/eqd-plumes/ports", json={"ports": ports})
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["code"] == "ports_in_use" and len(detail["affected"]) == 2
    assert {a["port_id"] for a in detail["affected"]} == {"in"}
    assert {a["rig_name"] for a in detail["affected"]} == {
        "Demo rig: three-scene song",
        "Stereo demo: drives into a stereo BigSky, two amps",
    }
    # Nothing changed.
    assert [p["id"] for p in client.get("/api/catalog/devices/eqd-plumes").json()["ports"]] == [
        p["id"] for p in plumes["ports"]
    ]
    # Moving / relabelling / adding keeps ids and needs no confirmation.
    moved = [dict(p, position=0.9, position_evidence="user", label=p["label"].upper()) for p in plumes["ports"]]
    moved.append(_port("exp", "EXP", "expression", "in", "left", 0.5))
    r = client.put("/api/catalog/devices/eqd-plumes/ports", json={"ports": moved})
    assert r.status_code == 200 and r.json()["source"] == "custom"  # a builtin edited becomes the user's own copy
    assert client.get("/api/rigs/rig_demo_signal_loom/analysis").json()["summary"]["errors"] == 0
    # An explicit decision: force the rename. The cables now report the missing port.
    r = client.put("/api/catalog/devices/eqd-plumes/ports", json={"ports": ports, "force": True})
    assert r.status_code == 200
    a = client.get("/api/rigs/rig_demo_signal_loom/analysis").json()
    assert "connection.port_missing" in {d["code"] for d in a["diagnostics"]}


def test_stereo_and_trs_semantics_survive_the_ports_endpoint(client, profiles):
    """Anchors on the BigSky's L/R pair and a TRS stereo jack keep pair_group/channel/role facts,
    and the stereo demo still routes, splits and compiles exactly as before."""
    asset = _upload(client)
    bigsky = client.get("/api/catalog/devices/strymon-bigsky-mx").json()
    bigsky.pop("unknown_attributes")
    bigsky.pop("source")
    bigsky["image"] = {"asset_id": asset["id"], "crop": {"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.8}, "calibrated": True}
    assert client.put("/api/catalog/devices/strymon-bigsky-mx", json=bigsky).status_code == 200
    ports = [
        dict(p, image_anchor={"x": 0.1 + i * 0.1, "y": 0.05, "asset_id": asset["id"]}, position_evidence="user")
        for i, p in enumerate(bigsky["ports"])
    ]
    # One physical TRS socket carrying two signals is still one socket: a stereo TRS output.
    ports.append(
        _port(
            "out_trs",
            "OUT (TRS stereo)",
            "audio",
            "out",
            "top",
            0.4,
            asset["id"],
            0.5,
            0.05,
            connector="trs_1_4",
            audio_channel="stereo_trs",
            trs_role="stereo",
        )
    )
    r = client.put("/api/catalog/devices/strymon-bigsky-mx/ports", json={"ports": ports})
    assert r.status_code == 200, r.text
    saved = {p["id"]: p for p in r.json()["ports"]}
    assert saved["in_l"]["pair_group"] == "in" and saved["in_l"]["audio_channel"] == "left"
    assert saved["out_r"]["pair_group"] == "out" and saved["out_r"]["audio_channel"] == "right"
    assert saved["out_trs"]["audio_channel"] == "stereo_trs" and saved["out_trs"]["trs_role"] == "stereo"
    a = client.get("/api/rigs/rig_demo_stereo/analysis").json()
    assert a["summary"]["errors"] == 0
    drive = next(p for p in a["ml10x"]["preset_paths"] if p["preset_number"] == 1)
    assert drive["stereo_output"] is True and drive["paths"][1]["steps"][0]["state"] == "return_only"
    kit = a["cable_kit"]
    assert sum(1 for k in kit if k["kind"] == "trs_breakout") == 2  # Return C and Output, as before
    # The wiring position evidence drives "estimated" on the board; anchors never do.
    inst = a["instances"]["inst_bigsky"]
    assert all(pp["estimated"] is False for pp in inst["ports"] if pp["port_id"] in ("in_l", "out_r"))


def test_port_evidence_defaults_keep_builtins_honest():
    for p in builtin_profiles():
        for port in p.ports:
            assert port.evidence is None and port.image_anchor is None  # hand-authored: no separate claim
