"""Session 3: the physical facts behind a traced path (jacks and cables) and MIDI routes.

The Stage view draws a scene's signal along real cables and sends MIDI pulses along real MIDI
cables; these tests pin down the data it reads so a drawing can never show a cable that does
not exist.
"""

from app.analysis import analyze
from app.catalog.demo import demo_rig, stereo_demo_rig
from app.models.rig import Ml10xPreset


def _conn(rig, src_port, dst_port):
    return next(c for c in rig.connections if c.source.port_id == src_port and c.target.port_id == dst_port).id


def test_path_steps_name_the_physical_cables_and_switcher_jacks(profiles):
    rig = stereo_demo_rig()
    a = analyze(rig, profiles)
    clean = next(p for p in a["ml10x"]["preset_paths"] if p["preset_number"] == 0)
    left, right = clean["paths"]
    inp, loop5, out = left["steps"]
    # Input: the guitar cable arrives on the ML10X's Input (Tip) jack.
    assert inp["in_port_id"] == "in_tip" and inp["out_port_id"] is None
    assert inp["cables"] == [_conn(rig, "out", "in_tip")]
    # Loop 5 (C Tip): out through Send C Tip into BigSky IN L, back from OUT L into Return C Tip.
    assert loop5["out_port_id"] == "send_c_tip" and loop5["in_port_id"] == "return_c_tip"
    assert loop5["cables"] == [_conn(rig, "send_c_tip", "in_l"), _conn(rig, "out_l", "return_c_tip")]
    # Output (Tip) leaves through the out_tip jack to Amp L.
    assert out["out_port_id"] == "out_tip" and out["cables"] == [_conn(rig, "out_tip", "input")]
    # The right conductor starts at a return-only loop: only the Return cable is physical.
    first, out_r = right["steps"]
    assert first["state"] == "return_only"
    assert first["out_port_id"] is None and first["in_port_id"] == "return_c_ring"
    assert first["cables"] == [_conn(rig, "out_r", "return_c_ring")]
    assert out_r["out_port_id"] == "out_ring" and out_r["cables"] == [_conn(rig, "out_ring", "input")]


def test_empty_and_half_cabled_loops_carry_only_the_cables_that_exist(profiles):
    rig = stereo_demo_rig()
    # Loop 7 (D Tip) is empty; loop 6 (C Ring) has only a Return.
    rig.controllers.ml10x.presets.append(
        Ml10xPreset(
            number=9, name="probe", mode="advanced", advanced_edges=[["IN_TIP", "L7"], ["L7", "L6"], ["L6", "OUT_TIP"]]
        )
    )
    a = analyze(rig, profiles)
    probe = next(p for p in a["ml10x"]["preset_paths"] if p["preset_number"] == 9)
    steps = {s["node"]: s for s in probe["paths"][0]["steps"]}
    assert steps["L7"]["state"] == "missing" and steps["L7"]["cables"] == []
    assert steps["L7"]["out_port_id"] == "send_d_tip"  # the jack exists even when nothing is plugged in
    assert steps["L6"]["state"] == "missing" and steps["L6"]["cables"] == [_conn(rig, "out_r", "return_c_ring")]


def test_midi_routes_follow_cables_through_thru_and_omniport(profiles):
    rig = demo_rig()
    a = analyze(rig, profiles)
    routes = a["midi"]["routes"]
    assert a["midi"]["controller_id"] == "inst_mc8"
    din = _conn(rig, "midi_out", "midi_in")
    thru = _conn(rig, "midi_thru", "midi_in")
    assert routes["inst_ml10x"] == [din]
    assert routes["inst_bigsky"] == [din, thru]  # via the ML10X's MIDI Thru
    assert routes["inst_sunset"] == [_conn(rig, "omni1", "exp_midi")]  # TRS MIDI from the Omniport
    assert "inst_plumes" not in routes  # no MIDI on an analog pedal
    # Unplug the DIN cable: the ML10X and everything behind its Thru drop out of the routes.
    rig.connections = [c for c in rig.connections if c.id != din]
    b = analyze(rig, profiles)
    assert set(b["midi"]["routes"]) == {"inst_sunset"}
    assert "midi.unreachable" in {d["code"] for p in b["compiled"]["scenes"] for d in p["diagnostics"]}


def test_midi_routes_empty_without_an_mc8(profiles):
    rig = demo_rig()
    rig.controllers.mc8.instance_id = None
    a = analyze(rig, profiles)
    assert a["midi"] == {"controller_id": None, "routes": {}}
