"""Charter §5/§9: which CCs may be swept. Bank select, channel mode, bypass toggles, discrete and
unknown semantics are refused; documented continuous controls, synthetic fixture controls and an
explicit user declaration (with a note) are eligible with the right basis and warnings."""

from __future__ import annotations

import pytest

from app.catalog.builtin import builtin_profiles
from app.catalog.demo import demo_rig, virtual_instrument_rig
from app.instrument.eligibility import check_cc, check_mapping, continuous_controls
from app.models.profile import MidiCommand
from app.models.texture import Mapping


@pytest.fixture
def profs():
    return {p.id: p for p in builtin_profiles()}


def test_bank_select_and_channel_mode_are_refused_even_with_an_override(profs):
    rig = demo_rig()
    bigsky = rig.instance("inst_bigsky")
    for cc in (0, 32, 120, 121, 123, 127):
        e = check_cc(bigsky, profs["strymon-bigsky-mx"], cc, user_override=True, override_note="I insist")
        assert e.eligible is False and e.hard_refusal is True, cc


def test_bypass_controls_are_refused_even_the_hardware_verified_sunset_ones(profs):
    rig = demo_rig()
    sunset = rig.instance("inst_sunset")
    # CC 10 is the profile's bypass CC; CC 15 is documented "0 = bypass, 1-127 = engage".
    for cc in (10, 15):
        e = check_cc(sunset, profs["strymon-sunset"], cc, user_override=True, override_note="verified on 2026-10-21")
        assert e.eligible is False and e.hard_refusal is True
        assert "bypass" in e.reason.lower()
    bigsky = rig.instance("inst_bigsky")
    assert check_cc(bigsky, profs["strymon-bigsky-mx"], 102).hard_refusal is True
    # ML10X bank/scroll/mute controls are switch-like by their documented names.
    ml10x = rig.instance("inst_ml10x")
    for cc in (5, 6, 7, 9):
        assert (
            check_cc(ml10x, profs["morningstar-ml10x"], cc, user_override=True, override_note="x").hard_refusal is True
        )


def test_unknown_semantics_are_not_promoted_but_a_declared_override_is_allowed_with_a_warning(profs):
    rig = demo_rig()
    sunset = rig.instance("inst_sunset")
    e = check_cc(sunset, profs["strymon-sunset"], 100)  # "Expression (unverified)", evidence unknown
    assert e.eligible is False and e.hard_refusal is False
    assert "does not state that it is continuously variable" in e.reason
    e = check_cc(sunset, profs["strymon-sunset"], 100, user_override=True, override_note="swept it by hand, it works")
    assert e.eligible is True and e.basis == "user_declared" and e.evidence == "user"
    assert any("user-declared" in w for w in e.warnings)
    # An unnamed raw CC: refused by default, allowed only by declaration, and the warning says it is unnamed.
    e = check_cc(sunset, profs["strymon-sunset"], 77)
    assert e.eligible is False and "not in" in e.reason
    e = check_cc(sunset, profs["strymon-sunset"], 77, user_override=True, override_note="my test")
    assert e.eligible is True and any("not in" in w for w in e.warnings)
    # The model itself refuses an override without a note.
    with pytest.raises(ValueError):
        Mapping(instance_id="inst_sunset", cc=77, user_override=True)
    with pytest.raises(ValueError):
        Mapping(instance_id="inst_sunset", cc=77, user_override=True, override_note="   ")


def test_documented_continuous_control_is_eligible_with_the_documented_basis(profs):
    rig = demo_rig()
    bigsky = rig.instance("inst_bigsky")
    e = check_cc(bigsky, profs["strymon-bigsky-mx"], 100)
    assert e.eligible is True and e.basis == "documented" and e.synthetic is False and e.channel == 2
    assert any("not hardware-verified" in w for w in e.warnings)


def test_synthetic_fixture_controls_are_eligible_and_labelled_synthetic(profs):
    rig = virtual_instrument_rig()
    tex = rig.texture("tex_undertow")
    for m in tex.macros[0].mappings:
        e = check_mapping(rig, profs, m)
        assert e.eligible is True and e.basis == "synthetic" and e.synthetic is True
        assert any("synthetic" in w for w in e.warnings)
    # The synthetic bypass CC is refused: synthetic does not mean "anything goes".
    pa = rig.instance("inst_vpedal_a")
    assert check_cc(pa, profs["signal-loom-virtual-pedal-a"], 60, user_override=True, override_note="x").hard_refusal
    ctl = continuous_controls(pa, profs["signal-loom-virtual-pedal-a"])
    assert [(c["cc"], c["eligible"]) for c in ctl] == [(21, True), (60, False)]


def test_missing_device_profile_or_channel_and_command_toggles_are_refused(profs):
    rig = demo_rig()
    assert check_cc(None, None, 21).eligible is False
    plumes = rig.instance("inst_plumes")  # no MIDI at all
    assert check_cc(plumes, profs["eqd-plumes"], 21, user_override=True, override_note="x").eligible is False
    sunset = rig.instance("inst_sunset")
    sunset.midi_channel = None
    prof = profs["strymon-sunset"].model_copy(deep=True)
    prof.midi.default_channel = None
    assert "channel" in check_cc(sunset, prof, 100, user_override=True, override_note="x").reason
    # A named command with intent toggle on an otherwise unknown CC blocks it hard.
    prof = profs["strymon-sunset"].model_copy(deep=True)
    prof.midi.commands.append(
        MidiCommand(id="cmd_t", name="Flip", kind="cc", cc=77, value_mode="fixed", value=127, intent="toggle")
    )
    sunset.midi_channel = 3
    e = check_cc(sunset, prof, 77, user_override=True, override_note="x")
    assert e.eligible is False and e.hard_refusal is True and "Flip" in e.reason
    # A removed device: the mapping is reported, never retargeted.
    rig2 = virtual_instrument_rig()
    rig2.instances = [i for i in rig2.instances if i.id != "inst_vpedal_b"]
    m = rig2.texture("tex_undertow").macros[0].mappings[1]
    e = check_mapping(rig2, profs, m)
    assert e.eligible is False and "no longer on the rig" in e.reason and m.instance_id == "inst_vpedal_b"
