import json

from app.analysis import analyze
from app.domain.compiler import compile_rig
from app.domain.wiring import build_context
from app.models.rig import DeviceSceneState, Mc8Bank, Mc8Message, Mc8Preset, Ml10xPreset, ProgramSelection, Scene


def plan_for(rig, profiles):
    return compile_rig(rig, profiles, build_context(rig, profiles))


def test_three_scenes_compile_to_inspectable_messages(demo, profiles):
    plan = plan_for(demo, profiles)
    names = [s["scene_name"] for s in plan["scenes"]]
    assert names == ["Clean intro", "Heavy verse", "Solo"]
    clean = plan["scenes"][0]
    # ML10X routing first (bank select, then PC), every message has channel/type/number/target/why.
    assert clean["messages"][0]["summary"] == "CC 0 = 0 ch 10 -> ML10X"
    assert clean["messages"][1]["summary"] == "PC 0 ch 10 -> ML10X"
    for m in clean["messages"]:
        assert (
            m["channel"] in range(1, 17)
            and m["type"] in ("pc", "cc")
            and m["explanation"]
            and m["scene_id"] == "scene_clean"
        )
    assert "Plumes: switch OFF by hand (no MIDI control)." in clean["manual_steps"]
    solo = plan["scenes"][2]
    assert any(m["source_kind"] == "ml10x_loop" and m["number"] == 12 and m["value"] == 127 for m in solo["messages"])
    # MC8 switch map: three switches in bank 1 within limits.
    bank = plan["mc8"]["banks"][0]
    assert [s["position"] for s in bank["switches"]] == ["A", "B", "C"]
    assert all(s["message_count"] <= 16 for s in bank["switches"])
    assert not any(d["severity"] == "error" for s in bank["switches"] for d in s["diagnostics"])


def test_recompile_is_deterministic(demo, profiles):
    a = json.dumps(plan_for(demo, profiles), sort_keys=True)
    b = json.dumps(plan_for(demo, profiles), sort_keys=True)
    assert a == b
    # Reordering device_states must not change the output (ordering follows the rig).
    demo.scenes[0].device_states.reverse()
    c = json.dumps(plan_for(demo, profiles), sort_keys=True)
    assert a == c


def test_invalid_channel_and_values_fail_clearly(demo, profiles):
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        ProgramSelection(pc=128)
    with pytest.raises(ValidationError):
        Mc8Message(type="cc", channel=17, number=1, value=1)
    # Device without a channel -> explicit error, nothing silently sent.
    demo.instance("inst_bigsky").midi_channel = None
    prof = profiles["strymon-bigsky-mx"].model_copy(deep=True)
    prof.midi.default_channel = None
    plan = plan_for(demo, {**profiles, "strymon-bigsky-mx": prof})
    clean = plan["scenes"][0]
    assert any(d["code"] == "midi.channel_unknown" and d["severity"] == "error" for d in clean["diagnostics"])
    assert not any(m["target_instance_id"] == "inst_bigsky" for m in clean["messages"])


def test_pc_out_of_documented_range_is_an_error(demo, profiles):
    prof = profiles["strymon-sunset"].model_copy(deep=True)
    prof.midi.program_change.max = 10
    demo.scenes[1].device_states[1].program = ProgramSelection(pc=50)
    plan = plan_for(demo, {**profiles, "strymon-sunset": prof})
    heavy = plan["scenes"][1]
    assert any(d["code"] == "midi.pc_out_of_range" for d in heavy["diagnostics"])
    assert not any(m["type"] == "pc" and m["target_instance_id"] == "inst_sunset" for m in heavy["messages"])


def test_switch_message_limit_is_enforced_not_truncated(demo, profiles):
    big = Scene(
        id="scene_big",
        name="Big",
        device_states=[
            DeviceSceneState(
                instance_id="inst_sunset",
                program=ProgramSelection(pc=1),
                enabled=True,
                cc_values=[{"cc": i, "value": 1} for i in range(20, 40)],
            ),
        ],
    )
    demo.scenes.append(big)
    demo.controllers.mc8.banks[0].presets.append(Mc8Preset(position="D", short_name="Big", scene_id="scene_big"))
    plan = plan_for(demo, profiles)
    sw = plan["mc8"]["banks"][0]["switches"][3]
    assert sw["message_count"] == 22
    assert any(d["code"] == "mc8.message_limit" and d["severity"] == "error" for d in sw["diagnostics"])
    assert len(sw["messages"]) == 22  # nothing dropped silently


def test_mc8_position_and_bank_constraints(demo, profiles):
    demo.controllers.mc8.banks.append(
        Mc8Bank(number=31, name="too many", presets=[Mc8Preset(position="Z", short_name="x")])
    )
    demo.controllers.mc8.banks[0].presets.append(Mc8Preset(position="Q", short_name="aux", scene_id="scene_solo"))
    demo.controllers.mc8.banks[0].presets.append(Mc8Preset(position="I", short_name="pg2", scene_id="scene_solo"))
    plan = plan_for(demo, profiles)
    b31 = plan["mc8"]["banks"][1]
    assert any(d["code"] == "mc8.bank_out_of_range" for d in b31["diagnostics"])
    assert any(d["code"] == "mc8.position_invalid" for d in b31["switches"][0]["diagnostics"])
    b1 = {s["position"]: s for s in plan["mc8"]["banks"][0]["switches"]}
    assert any(d["code"] == "mc8.position_aux_only" for d in b1["Q"]["diagnostics"])
    assert any(d["code"] == "mc8.position_page2" for d in b1["I"]["diagnostics"])


def test_toggle_bypass_is_flagged_as_non_deterministic(demo, profiles):
    prof = profiles["strymon-sunset"].model_copy(deep=True)
    prof.midi.bypass.deterministic = False
    plan = plan_for(demo, {**profiles, "strymon-sunset": prof})
    assert any(d["code"] == "midi.bypass_toggle" for d in plan["scenes"][0]["diagnostics"])


def test_ml10x_advanced_mode_loop_cc_is_gated_by_firmware(demo, profiles):
    ml = demo.controllers.ml10x
    ml.presets[2] = Ml10xPreset(
        number=2, name="Solo", mode="advanced", advanced_edges=[["IN", "L1"], ["L1", "L3"], ["L3", "OUT"]]
    )
    for fw in ("1.1.2", "1.2.0"):
        ml.firmware_version = fw
        plan = plan_for(demo, profiles)
        solo = plan["scenes"][2]
        assert any(d["code"] == "ml10x.loop_cc_advanced_unsupported" for d in solo["diagnostics"])
        assert not any(m["source_kind"] == "ml10x_loop" for m in solo["messages"])


def test_ml10x_preset_through_uncabled_loop_is_flagged(demo, profiles):
    demo.controllers.ml10x.presets[0].chain = [1, 3, 5, 7]
    a = analyze(demo, profiles)
    assert any(
        d["code"] == "ml10x.preset_loop_not_cabled" and "loop 7" in d["message"] for d in a["ml10x"]["diagnostics"]
    )


def test_loop_state_for_loop_outside_preset_warns(demo, profiles):
    demo.scenes[2].ml10x.loop_states = {"9": True}
    plan = plan_for(demo, profiles)
    assert any(d["code"] == "ml10x.loop_not_in_preset" for d in plan["scenes"][2]["diagnostics"])


def test_midi_unreachable_device_warns(demo, profiles):
    demo.connections = [c for c in demo.connections if c.label != "ML10X Thru -> BigSky In"]
    plan = plan_for(demo, profiles)
    assert any(d["code"] == "midi.unreachable" and "BigSky" in d["message"] for d in plan["scenes"][0]["diagnostics"])


def test_shared_midi_channel_warns(demo, profiles):
    demo.instance("inst_sunset").midi_channel = 2  # same as BigSky
    a = analyze(demo, profiles)
    assert any(d["code"] == "midi.channel_shared" for d in a["diagnostics"])
