"""Session 3e, phase A: mounting surfaces (top / underside / off-board).

Older rigs carry only ``off_board``; loading must not reinterpret it. Top and underside share one
coordinate system and perimeter, collide only with their own surface, and a device under the board
is only called a fit when both its height and the board's usable clearance are known.
"""

from __future__ import annotations

import json

from app.catalog.boards import board_spec, builtin_boards
from app.domain.geometry import board_diagnostics
from app.models.common import Severity
from app.models.rig import Board, DeviceInstance, Rig


def codes(diags):
    return {d.code for d in diags}


def by_code(diags, code):
    return [d for d in diags if d.code == code]


def test_legacy_off_board_flag_is_honoured_and_never_rewritten():
    legacy = {"id": "inst_a", "profile_id": "generic-amp", "label": "Amp", "off_board": True}
    inst = DeviceInstance.model_validate(legacy)
    assert inst.surface is None and inst.off_board is True and inst.mount == "off_board"
    assert DeviceInstance.model_validate({**legacy, "off_board": False}).mount == "top"
    # Round-tripping keeps the legacy document as it was: no surface is invented.
    assert inst.model_dump(mode="json")["surface"] is None
    # An explicit surface is the user's statement and the flag follows it.
    assert DeviceInstance(profile_id="x", label="x", surface="underside").off_board is False
    assert DeviceInstance(profile_id="x", label="x", surface="off_board").off_board is True
    assert DeviceInstance(profile_id="x", label="x", surface="top", off_board=True).off_board is False


def test_board_catalog_has_evidence_and_unknowns():
    boards = {b.id: b for b in builtin_boards()}
    cl2 = boards["pedaltrain-classic-2"]
    assert cl2.width.value_mm == 609.6 and cl2.depth.value_mm == 317.5 and cl2.height.value_mm == 88.9
    assert cl2.width.evidence.value == "third_party"  # retailer copies of the manufacturer's figures
    assert cl2.rails == 4 and cl2.rail_pitch.value_mm is None  # count known, spacing not published
    assert cl2.underside_mountable is True and cl2.underside_clearance.value_mm is None
    assert any("rail spacing" in u for u in cl2.declared_unknowns)
    assert boards["pedaltrain-novo-24"].rails == 5 and boards["pedaltrain-novo-24"].depth.value_mm == 368.3
    assert boards["generic-flat-board"].underside_mountable is False
    assert board_spec(None) is None and board_spec("nope") is None


def _rig(board: Board, *instances: DeviceInstance) -> Rig:
    return Rig(name="t", board=board, instances=list(instances))


def test_surfaces_share_the_perimeter_but_collide_only_with_their_own(profiles):
    board = Board(width_mm=600, depth_mm=300, model_id="pedaltrain-classic-2")
    top = DeviceInstance(id="p", profile_id="eqd-plumes", label="Plumes", x_mm=20, y_mm=20)
    under_same_spot = DeviceInstance(
        id="m", profile_id="morningstar-ml10x", label="ML10X", x_mm=20, y_mm=20, surface="underside"
    )
    under_again = DeviceInstance(
        id="u", profile_id="generic-isolated-psu", label="PSU", x_mm=30, y_mm=30, surface="underside"
    )
    outside = DeviceInstance(id="o", profile_id="eqd-plumes", label="Far", x_mm=580, y_mm=20, surface="underside")
    diags = board_diagnostics(
        _rig(board, top, under_same_spot, under_again, outside), profiles, board_spec(board.model_id)
    )
    collisions = by_code(diags, "instance.collision")
    # The pedal on top and the switcher beneath it do not collide; the two underside units do.
    assert [(d.subject_id, d.related_ids) for d in collisions] == [("m", ["u"])]
    assert "under the board" in collisions[0].message
    oob = by_code(diags, "instance.out_of_bounds")
    assert [d.subject_id for d in oob] == ["o"] and "under it" in oob[0].message


def test_underside_fit_needs_height_and_clearance(profiles):
    ml10x = DeviceInstance(
        id="m", profile_id="morningstar-ml10x", label="ML10X", x_mm=20, y_mm=20, surface="underside"
    )  # 58 mm tall
    guitar = DeviceInstance(
        id="g", profile_id="generic-guitar", label="Odd", x_mm=300, y_mm=20, surface="underside"
    )  # no height
    # Classic 2: underside exists, clearance not published -> unverified, never approved.
    board = Board(width_mm=609.6, depth_mm=317.5, model_id="pedaltrain-classic-2")
    diags = board_diagnostics(_rig(board, ml10x, guitar), profiles, board_spec(board.model_id))
    assert {d.subject_id for d in by_code(diags, "instance.underside_clearance_unverified")} == {"m", "g"}
    assert [d.subject_id for d in by_code(diags, "instance.underside_height_unknown")] == ["g"]
    assert "instance.underside_fits" not in codes(diags) and "instance.underside_too_tall" not in codes(diags)
    assert "board.underside_mounting_unverified" in codes(diags)  # rails counted, spacing unknown
    # The user measured 50 mm: the 58 mm switcher does not fit; a 35 mm supply does.
    board.underside_clearance_mm = 50
    psu = DeviceInstance(
        id="u", profile_id="generic-isolated-psu", label="PSU", x_mm=300, y_mm=150, surface="underside"
    )
    diags = board_diagnostics(_rig(board, ml10x, psu), profiles, board_spec(board.model_id))
    tall = by_code(diags, "instance.underside_too_tall")
    assert (
        [d.subject_id for d in tall] == ["m"]
        and tall[0].severity == Severity.ERROR
        and "your measurement" in tall[0].message
    )
    fits = by_code(diags, "instance.underside_fits")
    assert [d.subject_id for d in fits] == ["u"] and "15 mm" in fits[0].message
    # A flat board has no underside at all.
    flat = Board(width_mm=600, depth_mm=300, model_id="generic-flat-board")
    diags = board_diagnostics(_rig(flat, psu), profiles, board_spec(flat.model_id))
    assert [d.subject_id for d in by_code(diags, "instance.underside_unavailable")] == ["u"]
    # Nothing underneath: none of the underside diagnostics appear.
    diags = board_diagnostics(
        _rig(board, DeviceInstance(id="t", profile_id="eqd-plumes", label="P", x_mm=10, y_mm=10)),
        profiles,
        board_spec(board.model_id),
    )
    assert not any(c.startswith("instance.underside") or c.startswith("board.underside") for c in codes(diags))


def test_api_exposes_boards_mounting_and_round_trips_the_data(client):
    boards = client.get("/api/catalog/boards").json()
    assert [b["id"] for b in boards] == ["pedaltrain-classic-2", "pedaltrain-novo-24", "generic-flat-board"]
    rig = client.post("/api/rigs", json={"name": "Mount test"}).json()
    rig["board"].update(
        {"model_id": "pedaltrain-classic-2", "width_mm": 609.6, "depth_mm": 317.5, "underside_clearance_mm": 60}
    )
    rig["instances"] = [
        {
            "id": "inst_p",
            "profile_id": "eqd-plumes",
            "label": "Plumes",
            "x_mm": 20,
            "y_mm": 20,
            "rotation": 0,
            "intentional_overlap": False,
            "off_board": False,
            "midi_channel": None,
            "port_overrides": [],
            "removed_port_ids": [],
        },
        {
            "id": "inst_m",
            "profile_id": "morningstar-ml10x",
            "label": "ML10X",
            "x_mm": 20,
            "y_mm": 20,
            "rotation": 0,
            "intentional_overlap": False,
            "off_board": False,
            "surface": "underside",
            "midi_channel": None,
            "port_overrides": [],
            "removed_port_ids": [],
        },
        {
            "id": "inst_u",
            "profile_id": "generic-isolated-psu",
            "label": "PSU",
            "x_mm": 300,
            "y_mm": 150,
            "rotation": 0,
            "intentional_overlap": False,
            "off_board": False,
            "surface": "underside",
            "midi_channel": None,
            "port_overrides": [],
            "removed_port_ids": [],
        },
        {
            "id": "inst_amp",
            "profile_id": "generic-amp",
            "label": "Amp",
            "x_mm": 0,
            "y_mm": 0,
            "rotation": 0,
            "intentional_overlap": False,
            "off_board": True,
            "midi_channel": None,
            "port_overrides": [],
            "removed_port_ids": [],
        },
    ]
    rig["connections"] = [
        {
            "id": "c_pow",
            "kind": "power",
            "source": {"instance_id": "inst_u", "port_id": "out1"},
            "target": {"instance_id": "inst_p", "port_id": "dc_in"},
            "intentional": False,
        },
        {
            "id": "c_aud",
            "kind": "audio",
            "source": {"instance_id": "inst_m", "port_id": "out_tip"},
            "target": {"instance_id": "inst_amp", "port_id": "input"},
            "intentional": False,
        },
    ]
    rig["revision"] += 1
    r = client.put(f"/api/rigs/{rig['id']}", json=rig)
    assert r.status_code == 200, r.text
    a = client.get(f"/api/rigs/{rig['id']}/analysis").json()
    assert a["mounting"]["spec"]["id"] == "pedaltrain-classic-2" and a["mounting"]["clearance_mm"] == 60
    assert a["mounting"]["clearance_source"] == "user" and a["mounting"]["counts"] == {
        "top": 1,
        "underside": 2,
        "off_board": 1,
    }
    assert a["instances"]["inst_m"]["surface"] == "underside" and a["instances"]["inst_m"]["tall_mm"] == 58
    assert a["instances"]["inst_p"]["surface"] == "top" and a["instances"]["inst_amp"]["surface"] == "off_board"
    c = {d["code"] for d in a["diagnostics"]}
    assert "instance.collision" not in c and "instance.underside_fits" in c and "instance.underside_too_tall" not in c
    # The underside supply powers the pedal on top and the switcher's audio reaches the amp: no new
    # wiring diagnostics come from the mounting surfaces.
    assert not any(d["code"].startswith("connection.") for d in a["diagnostics"])
    # Rig cards draw the top only.
    pv = next(s for s in client.get("/api/rigs").json() if s["id"] == rig["id"])["preview"]
    assert {d["surface"] for d in pv["devices"]} == {"top", "underside", "off_board"}
    # Export / import keeps the board model, the clearance and every surface.
    exported = client.get(f"/api/rigs/{rig['id']}/export").json()
    assert exported["format_version"] == 1
    imp = client.post("/api/rigs/import", content=json.dumps(exported)).json()["rig"]
    assert imp["board"]["model_id"] == "pedaltrain-classic-2" and imp["board"]["underside_clearance_mm"] == 60
    assert {i["id"]: i.get("surface") for i in imp["instances"]} == {
        "inst_p": None,
        "inst_m": "underside",
        "inst_u": "underside",
        "inst_amp": None,
    }
    assert next(i for i in imp["instances"] if i["id"] == "inst_amp")["off_board"] is True
    # The wiring manifest says where each device is mounted and flags cables that change surface.
    md = client.get(f"/api/rigs/{rig['id']}/exports/wiring.md").text
    assert "| ML10X | Morningstar ML10X | underside | 20, 20 |" in md
    assert "| Amp | Generic Guitar amplifier | off-board | - |" in md
    assert "Crosses from under the board to the top of the board" in md
