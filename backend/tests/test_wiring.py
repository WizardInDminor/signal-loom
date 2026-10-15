from app.domain.wiring import wiring_diagnostics
from app.models.common import SignalKind
from app.models.rig import Connection, DeviceInstance, PortRef, Rig


def codes(diags):
    return {d.code for d in diags}


def conn(kind, a, ap, b, bp, **kw):
    return Connection(
        kind=kind, source=PortRef(instance_id=a, port_id=ap), target=PortRef(instance_id=b, port_id=bp), **kw
    )


def test_demo_rig_is_coherent(demo, profiles):
    _, diags = wiring_diagnostics(demo, profiles)
    errors = [d for d in diags if d.severity.value == "error"]
    assert errors == []
    # The only expected warning: Sunset's EXP/MIDI jack needs a Strymon-specific cable.
    assert codes(diags) == {"midi.trs_type_mismatch"}


def test_incompatible_signal_domains_are_rejected(profiles):
    rig = Rig(
        name="t",
        instances=[
            DeviceInstance(id="mc8", profile_id="morningstar-mc8", label="MC8"),
            DeviceInstance(id="pl", profile_id="eqd-plumes", label="Plumes"),
        ],
        connections=[conn(SignalKind.MIDI, "mc8", "midi_out", "pl", "in")],
    )
    _, diags = wiring_diagnostics(rig, profiles)
    assert "connection.kind_mismatch" in codes(diags)


def test_direction_and_exclusive_input_rules(profiles):
    rig = Rig(
        name="t",
        instances=[
            DeviceInstance(id="g", profile_id="generic-guitar", label="Guitar"),
            DeviceInstance(id="a", profile_id="eqd-plumes", label="A"),
            DeviceInstance(id="b", profile_id="eqd-plumes", label="B"),
        ],
        connections=[
            conn(SignalKind.AUDIO, "a", "in", "g", "out"),  # input -> output: wrong way round
            conn(SignalKind.AUDIO, "g", "out", "b", "in"),
            conn(SignalKind.AUDIO, "a", "out", "b", "in"),  # second cable into the same input
            conn(SignalKind.AUDIO, "a", "out", "a", "nope"),  # nonexistent port
        ],
    )
    _, diags = wiring_diagnostics(rig, profiles)
    c = codes(diags)
    assert {"connection.direction", "connection.input_shared", "connection.port_missing"} <= c


def test_trs_midi_type_mismatch_and_din_adapter(profiles):
    rig = Rig(
        name="t",
        instances=[
            DeviceInstance(id="mc8", profile_id="morningstar-mc8", label="MC8"),
            DeviceInstance(id="bs", profile_id="strymon-bigsky-mx", label="BigSky"),
            DeviceInstance(id="ss", profile_id="strymon-sunset", label="Sunset"),
        ],
        connections=[
            conn(SignalKind.MIDI, "mc8", "omni1", "bs", "midi_in"),  # TRS -> DIN needs adapter
            conn(SignalKind.MIDI, "mc8", "omni2", "ss", "exp_midi"),  # Type A -> proprietary
        ],
    )
    _, diags = wiring_diagnostics(rig, profiles)
    assert {"midi.din_trs_adapter", "midi.trs_type_mismatch"} <= codes(diags)


def test_power_validation(profiles):
    rig = Rig(
        name="t",
        instances=[
            DeviceInstance(id="psu", profile_id="generic-isolated-psu", label="PSU"),
            DeviceInstance(id="bs", profile_id="strymon-bigsky-mx", label="BigSky"),  # needs 9 V 500 mA
            DeviceInstance(id="gen", profile_id="generic-mono-effect", label="Mystery"),  # unknown requirement
            DeviceInstance(id="pl", profile_id="eqd-plumes", label="Plumes"),  # unpowered
        ],
        connections=[
            conn(SignalKind.POWER, "psu", "out9", "bs", "dc_in"),  # 18 V outlet into a 9 V pedal
            conn(SignalKind.POWER, "psu", "out1", "gen", "dc_in"),
        ],
    )
    _, diags = wiring_diagnostics(rig, profiles)
    c = codes(diags)
    assert "power.voltage_mismatch" in c
    assert "power.requirement_unknown" in c  # unknown is a warning, never an approval
    assert "power.unpowered" in c


def test_audio_cycle_detected(profiles):
    rig = Rig(
        name="t",
        instances=[
            DeviceInstance(id="a", profile_id="generic-mono-effect", label="A"),
            DeviceInstance(id="b", profile_id="generic-mono-effect", label="B"),
        ],
        connections=[conn(SignalKind.AUDIO, "a", "out", "b", "in"), conn(SignalKind.AUDIO, "b", "out", "a", "in")],
    )
    _, diags = wiring_diagnostics(rig, profiles)
    assert "audio.cycle" in codes(diags)


def test_removing_one_cable_breaks_loop_independent_of_scene(demo, profiles):
    # Remove "Plumes -> Return A": loop 1 becomes open and the path through it breaks.
    demo.connections = [c for c in demo.connections if c.label != "Plumes -> Return A"]
    _, diags = wiring_diagnostics(demo, profiles)
    loop_open = [d for d in diags if d.code == "switcher.loop_open"]
    assert loop_open and "loop 1" in loop_open[0].message
    # Scenes were not consulted: dropping them changes nothing.
    demo.scenes = []
    _, diags2 = wiring_diagnostics(demo, profiles)
    assert {d.code for d in diags2 if d.code.startswith("switcher")} == {
        d.code for d in diags if d.code.startswith("switcher")
    }


def test_removing_output_cable_breaks_guitar_to_amp_path(demo, profiles):
    demo.connections = [c for c in demo.connections if c.label != "ML10X Out -> Amp"]
    _, diags = wiring_diagnostics(demo, profiles)
    assert "audio.path_broken" in codes(diags)
    assert "switcher.no_output" in codes(diags)


def test_intentional_split_downgrades_warning(profiles):
    rig = Rig(
        name="t",
        instances=[
            DeviceInstance(id="g", profile_id="generic-guitar", label="G"),
            DeviceInstance(id="a", profile_id="generic-mono-effect", label="A"),
            DeviceInstance(id="b", profile_id="generic-mono-effect", label="B"),
        ],
        connections=[conn(SignalKind.AUDIO, "g", "out", "a", "in"), conn(SignalKind.AUDIO, "g", "out", "b", "in")],
    )
    _, diags = wiring_diagnostics(rig, profiles)
    assert "connection.output_split" in codes(diags)
    rig.connections[1].intentional = True
    _, diags = wiring_diagnostics(rig, profiles)
    assert "connection.output_split" not in codes(diags)
