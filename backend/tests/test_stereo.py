"""Stereo routing: per-conductor paths, return-only loops, breakout cables and the stereo demo."""

from app.analysis import analyze
from app.catalog.demo import stereo_demo_rig
from app.domain.wiring import wiring_diagnostics
from app.models.rig import Ml10xPreset


def codes(diags):
    return {d["code"] if isinstance(d, dict) else d.code for d in diags}


def test_stereo_demo_has_distinct_left_and_right_paths(profiles):
    rig = stereo_demo_rig()
    a = analyze(rig, profiles)
    assert a["summary"]["errors"] == 0
    drive = next(p for p in a["ml10x"]["preset_paths"] if p["preset_number"] == 1)
    assert drive["stereo_output"] is True and drive["stereo_input"] is False
    left, right = drive["paths"]
    assert left["name"].startswith("Left") and left["complete"]
    assert left["summary"] == "Guitar → Input (Tip) → Plumes → Sunset → BigSky MX → Output (Tip) → Amp L"
    assert right["name"].startswith("Right") and right["complete"]
    assert right["summary"] == "BigSky MX → Output (Ring) → Amp R"
    assert right["steps"][0]["state"] == "return_only"
    # Physical jacks for the stereo loop are named per conductor.
    bigsky_step = next(s for s in left["steps"] if s["device"] == "BigSky MX")
    assert bigsky_step["send_jack"] == "Send C (Tip)" and bigsky_step["return_jack"] == "Return C (Tip)"
    # Loop order differs in the solo preset and the trace follows the edges, not the loop numbers.
    solo = next(p for p in a["ml10x"]["preset_paths"] if p["preset_number"] == 2)
    assert solo["paths"][0]["summary"].startswith("Guitar → Input (Tip) → Sunset → Plumes → BigSky MX")


def test_return_only_loop_is_info_at_wiring_level_but_breaks_a_simple_chain(profiles):
    rig = stereo_demo_rig()
    _, diags = wiring_diagnostics(rig, profiles)
    assert "switcher.loop_return_only" in codes(diags)
    assert "switcher.loop_open" not in codes(diags)
    # A Simple preset cannot use loop 6 (no Send cabled): the preset check says so.
    rig.controllers.ml10x.presets.append(Ml10xPreset(number=3, name="bad simple", mode="simple", chain=[1, 6]))
    a = analyze(rig, profiles)
    bad = [d for d in a["ml10x"]["diagnostics"] if d["subject_id"] == "ml10x-preset-3"]
    assert any(d["code"] == "ml10x.preset_loop_not_cabled" and "Send is not cabled" in d["message"] for d in bad)


def test_advanced_edges_are_checked_per_direction(profiles):
    rig = stereo_demo_rig()
    # Route *into* loop 6 (its Send is not cabled) -> error; and a preset that never reaches an output.
    rig.controllers.ml10x.presets = [
        Ml10xPreset(number=0, name="into ring", mode="advanced", advanced_edges=[["IN_TIP", "L6"], ["L6", "OUT_TIP"]]),
        Ml10xPreset(number=1, name="dead end", mode="advanced", advanced_edges=[["IN_TIP", "L1"]]),
        Ml10xPreset(
            number=2,
            name="ring out unreachable",
            mode="advanced",
            advanced_edges=[["IN_TIP", "L1"], ["L1", "OUT_TIP"], ["L9", "OUT_RING"]],
        ),
    ]
    a = analyze(rig, profiles)
    by_preset = {}
    for d in a["ml10x"]["diagnostics"]:
        by_preset.setdefault(d["subject_id"], set()).add(d["code"])
    assert "ml10x.preset_loop_not_cabled" in by_preset["ml10x-preset-0"]
    assert "ml10x.no_output" in by_preset["ml10x-preset-1"]
    # L9 has nothing cabled: return-only use of an empty loop is flagged as not cabled.
    assert "ml10x.preset_loop_not_cabled" in by_preset["ml10x-preset-2"]


def test_cable_kit_identifies_breakouts_and_plain_ts(profiles):
    rig = stereo_demo_rig()
    a = analyze(rig, profiles)
    kit = a["cable_kit"]
    breakouts = [k for k in kit if k["kind"] == "trs_breakout"]
    assert {k["description"] for k in breakouts} == {
        "TRS-to-dual-TS breakout at ML10X Return C",
        "TRS-to-dual-TS breakout at ML10X Output",
    }
    ret_c = next(k for k in breakouts if "Return C" in k["description"])
    assert any("Tip → BigSky MX: OUT L" in e for e in ret_c["ends"]) and any(
        "Ring → BigSky MX: OUT R" in e for e in ret_c["ends"]
    )
    assert len(ret_c["connection_ids"]) == 2
    send_c = next(k for k in kit if "Send C (Tip only)" in k["description"])
    assert send_c["kind"] == "ts"
    assert sum(1 for k in kit if k["kind"] == "midi_din") == 2
    # Every cable appears in exactly one kit item.
    ids = [c for k in kit for c in k["connection_ids"]]
    assert sorted(ids) == sorted(c.id for c in rig.connections)


def test_ring_only_use_needs_breakout(profiles):
    rig = stereo_demo_rig()
    # Drop the Tip return of loop C: only the Ring conductor of Return C is used.
    rig.connections = [c for c in rig.connections if c.label != "BigSky Out L -> Return C (Tip)"]
    a = analyze(rig, profiles)
    assert any(k["kind"] == "trs_breakout" and "Ring lead only" in k["description"] for k in a["cable_kit"])
    assert "cable.ring_only_breakout" in codes(a["diagnostics"])


def test_stereo_scenes_compile_without_loop_ccs(profiles):
    rig = stereo_demo_rig()
    a = analyze(rig, profiles)
    for sp in a["compiled"]["scenes"]:
        assert not any(d["severity"] == "error" for d in sp["diagnostics"]), sp["diagnostics"]
        assert not any(m["source_kind"] == "ml10x_loop" for m in sp["messages"])
        assert [m["source_kind"] for m in sp["messages"][:2]] == ["ml10x_bank", "ml10x_preset"]
    # Asking for a loop CC on an Advanced preset is refused with an explanation, not silently sent.
    rig.scenes[1].ml10x.loop_states = {"1": True}
    a = analyze(rig, profiles)
    heavy = a["compiled"]["scenes"][1]
    assert any(d["code"] == "ml10x.loop_cc_advanced_unsupported" for d in heavy["diagnostics"])


def test_stereo_demo_export_import_round_trip(client):
    rigs = client.get("/api/rigs").json()
    stereo = next(r for r in rigs if r["name"].startswith("Stereo demo"))
    exported = client.get(f"/api/rigs/{stereo['id']}/export").json()
    res = client.post("/api/rigs/import", content=__import__("json").dumps(exported)).json()
    a = client.get(f"/api/rigs/{res['rig']['id']}/analysis").json()
    assert a["summary"]["errors"] == 0
    assert a["ml10x"]["preset_paths"][1]["stereo_output"] is True
