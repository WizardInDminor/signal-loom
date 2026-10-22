"""The sample rig used for the first-run experience and the north-star demo."""

from __future__ import annotations

from ..models.common import SignalKind
from ..models.rig import (
    Board,
    CcValue,
    Connection,
    Controllers,
    DeviceInstance,
    DeviceSceneState,
    Mc8Bank,
    Mc8Config,
    Mc8Preset,
    Ml10xConfig,
    Ml10xLoopAssignment,
    Ml10xPreset,
    Ml10xSceneState,
    PortRef,
    ProgramSelection,
    Rig,
    Scene,
)
from ..models.texture import Lfo, Macro, Mapping, Texture

DEMO_RIG_ID = "rig_demo_signal_loom"
STEREO_DEMO_RIG_ID = "rig_demo_stereo"
VIRTUAL_INSTRUMENT_RIG_ID = "rig_demo_virtual_instrument"
UNDERTOW_TEXTURE_ID = "tex_undertow"


def _c(kind: SignalKind, src: str, sp: str, dst: str, dp: str, label: str | None = None, **kw) -> Connection:
    return Connection(
        kind=kind,
        source=PortRef(instance_id=src, port_id=sp),
        target=PortRef(instance_id=dst, port_id=dp),
        label=label,
        **kw,
    )


def demo_rig() -> Rig:
    A, M, P, S, B, G, AMP, PSU = (
        "inst_mc8",
        "inst_ml10x",
        "inst_plumes",
        "inst_sunset",
        "inst_bigsky",
        "inst_guitar",
        "inst_amp",
        "inst_psu",
    )
    instances = [
        DeviceInstance(
            id=M, profile_id="morningstar-ml10x", label="ML10X", x_mm=20, y_mm=20, rotation=0, midi_channel=10
        ),
        DeviceInstance(id=P, profile_id="eqd-plumes", label="Plumes", x_mm=210, y_mm=20, rotation=0),
        DeviceInstance(
            id=S, profile_id="strymon-sunset", label="Sunset", x_mm=300, y_mm=20, rotation=0, midi_channel=3
        ),
        DeviceInstance(
            id=B, profile_id="strymon-bigsky-mx", label="BigSky MX", x_mm=410, y_mm=20, rotation=0, midi_channel=2
        ),
        DeviceInstance(id=A, profile_id="morningstar-mc8", label="MC8", x_mm=20, y_mm=160, rotation=0, midi_channel=16),
        DeviceInstance(
            id=PSU,
            profile_id="generic-isolated-psu",
            label="Power supply",
            x_mm=300,
            y_mm=190,
            rotation=0,
            off_board=True,
            notes="Mounted under the board; drawn off-board.",
        ),
        DeviceInstance(id=G, profile_id="generic-guitar", label="Guitar", x_mm=0, y_mm=0, off_board=True),
        DeviceInstance(id=AMP, profile_id="generic-amp", label="Amp", x_mm=0, y_mm=0, off_board=True),
    ]
    au, mi, po = SignalKind.AUDIO, SignalKind.MIDI, SignalKind.POWER
    connections = [
        _c(au, G, "out", M, "in_tip", "Guitar -> ML10X In", cable_length_cm=300),
        _c(au, M, "send_a_tip", P, "in", "Send A -> Plumes"),
        _c(au, P, "out", M, "return_a_tip", "Plumes -> Return A"),
        _c(au, M, "send_b_tip", S, "in", "Send B -> Sunset"),
        _c(au, S, "out", M, "return_b_tip", "Sunset -> Return B"),
        _c(au, M, "send_c_tip", B, "in_l", "Send C -> BigSky L"),
        _c(au, B, "out_l", M, "return_c_tip", "BigSky L -> Return C"),
        _c(au, M, "out_tip", AMP, "input", "ML10X Out -> Amp", cable_length_cm=500),
        _c(mi, A, "midi_out", M, "midi_in", "MC8 MIDI Out -> ML10X In"),
        _c(mi, M, "midi_thru", B, "midi_in", "ML10X Thru -> BigSky In"),
        _c(
            mi,
            A,
            "omni1",
            S,
            "exp_midi",
            "MC8 Omniport 1 -> Sunset EXP/MIDI",
            notes="Needs a Strymon MIDI EXP cable; see warning.",
        ),
        _c(po, PSU, "out1", M, "dc_in"),
        _c(po, PSU, "out2", P, "dc_in"),
        _c(po, PSU, "out3", S, "dc_in"),
        _c(po, PSU, "out4", B, "dc_in"),
        _c(po, PSU, "out5", A, "dc_in"),
    ]
    scenes = [
        Scene(
            id="scene_clean",
            name="Clean intro",
            song="Demo song",
            section="Intro",
            order=0,
            color="#3b82f6",
            ml10x=Ml10xSceneState(preset_number=0),
            device_states=[
                DeviceSceneState(instance_id=P, enabled=False),
                DeviceSceneState(instance_id=S, program=ProgramSelection(pc=0), enabled=False),
                DeviceSceneState(instance_id=B, program=ProgramSelection(pc=0, bank_msb=0), enabled=True),
            ],
            notes="Dry guitar into a big hall reverb; drives bypassed.",
        ),
        Scene(
            id="scene_heavy",
            name="Heavy verse",
            song="Demo song",
            section="Verse",
            order=1,
            color="#ef4444",
            ml10x=Ml10xSceneState(preset_number=1),
            device_states=[
                DeviceSceneState(instance_id=P, enabled=True, manual_note="Gain at 2 o'clock"),
                DeviceSceneState(instance_id=S, program=ProgramSelection(pc=1), enabled=True),
                DeviceSceneState(instance_id=B, program=ProgramSelection(pc=1, bank_msb=0), enabled=True),
            ],
        ),
        Scene(
            id="scene_solo",
            name="Solo",
            song="Demo song",
            section="Solo",
            order=2,
            color="#f59e0b",
            ml10x=Ml10xSceneState(preset_number=2, loop_states={"3": True}),
            device_states=[
                DeviceSceneState(instance_id=P, enabled=True),
                DeviceSceneState(
                    instance_id=S,
                    program=ProgramSelection(pc=2),
                    enabled=True,
                    cc_values=[CcValue(cc=15, value=127, label="B side on")],
                ),
                DeviceSceneState(instance_id=B, program=ProgramSelection(pc=2, bank_msb=0), enabled=True),
            ],
            manual_steps=["Roll guitar volume to 10."],
        ),
    ]
    controllers = Controllers(
        mc8=Mc8Config(
            instance_id=A,
            firmware_version="3.13.6",
            banks=[
                Mc8Bank(
                    number=1,
                    name="Demo song",
                    presets=[
                        Mc8Preset(position="A", short_name="Clean", scene_id="scene_clean"),
                        Mc8Preset(position="B", short_name="Heavy", scene_id="scene_heavy"),
                        Mc8Preset(position="C", short_name="Solo", scene_id="scene_solo"),
                    ],
                ),
            ],
        ),
        ml10x=Ml10xConfig(
            instance_id=M,
            firmware_version="1.1.2",
            advanced_mode=False,
            loop_assignments=[
                Ml10xLoopAssignment(loop=1, label="Plumes"),
                Ml10xLoopAssignment(loop=3, label="Sunset"),
                Ml10xLoopAssignment(loop=5, label="BigSky MX"),
            ],
            presets=[
                Ml10xPreset(number=0, name="Clean", mode="simple", chain=[1, 3, 5], bypassed_loops=[1, 3]),
                Ml10xPreset(number=1, name="Heavy", mode="simple", chain=[1, 3, 5]),
                Ml10xPreset(number=2, name="Solo", mode="simple", chain=[1, 3, 5]),
            ],
        ),
    )
    return Rig(
        id=DEMO_RIG_ID,
        name="Demo rig: three-scene song",
        description="Sample rig showing a mono ML10X loop chain, MC8 switch mapping and three scenes.",
        board=Board(name="Generic 600 x 300 mm board", width_mm=600, depth_mm=300, grid_mm=5),
        instances=instances,
        connections=connections,
        scenes=scenes,
        controllers=controllers,
        notes="Guitar -> ML10X (loops: Plumes, Sunset, BigSky MX) -> amp. MC8 bank 1 switches A/B/C recall the three scenes.",
    )


def stereo_demo_rig() -> Rig:
    """Mono drive section -> stereo BigSky MX -> two amps, through the ML10X.

    Loop C is used as a stereo pair: Send C (Tip) feeds the BigSky's left input (mono in), the
    BigSky's L/R outputs come back on Return C (Tip) and Return C (Ring). The ML10X Output Tip
    and Ring go to two amps. That requires a TRS-to-dual-TS breakout on Return C and on the
    Output, and an ML10X *Advanced* preset: the Ring return path (loop 6) is "return-only",
    which Simple mode (a single mono chain) cannot express.
    """
    A, M, P, S, B, G, AL, AR, PSU = (
        "inst_mc8",
        "inst_ml10x",
        "inst_plumes",
        "inst_sunset",
        "inst_bigsky",
        "inst_guitar",
        "inst_amp_l",
        "inst_amp_r",
        "inst_psu",
    )
    instances = [
        DeviceInstance(
            id=M, profile_id="morningstar-ml10x", label="ML10X", x_mm=20, y_mm=20, rotation=0, midi_channel=10
        ),
        DeviceInstance(id=P, profile_id="eqd-plumes", label="Plumes", x_mm=210, y_mm=20, rotation=0),
        DeviceInstance(
            id=S, profile_id="strymon-sunset", label="Sunset", x_mm=300, y_mm=20, rotation=0, midi_channel=3
        ),
        DeviceInstance(
            id=B, profile_id="strymon-bigsky-mx", label="BigSky MX", x_mm=410, y_mm=20, rotation=0, midi_channel=2
        ),
        DeviceInstance(id=A, profile_id="morningstar-mc8", label="MC8", x_mm=20, y_mm=160, rotation=0, midi_channel=16),
        DeviceInstance(
            id=PSU,
            profile_id="generic-isolated-psu",
            label="Power supply",
            x_mm=300,
            y_mm=190,
            off_board=True,
            notes="Under the board.",
        ),
        DeviceInstance(id=G, profile_id="generic-guitar", label="Guitar", off_board=True),
        DeviceInstance(id=AL, profile_id="generic-amp", label="Amp L", off_board=True),
        DeviceInstance(id=AR, profile_id="generic-amp", label="Amp R", off_board=True),
    ]
    au, mi, po = SignalKind.AUDIO, SignalKind.MIDI, SignalKind.POWER
    connections = [
        _c(au, G, "out", M, "in_tip", "Guitar -> ML10X In (Tip)", cable_length_cm=300),
        _c(au, M, "send_a_tip", P, "in", "Send A -> Plumes"),
        _c(au, P, "out", M, "return_a_tip", "Plumes -> Return A"),
        _c(au, M, "send_b_tip", S, "in", "Send B -> Sunset"),
        _c(au, S, "out", M, "return_b_tip", "Sunset -> Return B"),
        _c(au, M, "send_c_tip", B, "in_l", "Send C (Tip) -> BigSky In L"),
        _c(au, B, "out_l", M, "return_c_tip", "BigSky Out L -> Return C (Tip)"),
        _c(au, B, "out_r", M, "return_c_ring", "BigSky Out R -> Return C (Ring)"),
        _c(au, M, "out_tip", AL, "input", "ML10X Out (Tip) -> Amp L", cable_length_cm=500),
        _c(au, M, "out_ring", AR, "input", "ML10X Out (Ring) -> Amp R", cable_length_cm=500),
        _c(mi, A, "midi_out", M, "midi_in", "MC8 MIDI Out -> ML10X In"),
        _c(mi, M, "midi_thru", B, "midi_in", "ML10X Thru -> BigSky In"),
        _c(
            mi,
            A,
            "omni1",
            S,
            "exp_midi",
            "MC8 Omniport 1 -> Sunset EXP/MIDI",
            notes="Needs a Strymon MIDI EXP cable; see warning.",
        ),
        _c(po, PSU, "out1", M, "dc_in"),
        _c(po, PSU, "out2", P, "dc_in"),
        _c(po, PSU, "out3", S, "dc_in"),
        _c(po, PSU, "out4", B, "dc_in"),
        _c(po, PSU, "out5", A, "dc_in"),
    ]
    stereo_tail = [["L5", "OUT_TIP"], ["L6", "OUT_RING"]]
    presets = [
        Ml10xPreset(
            number=0,
            name="Clean stereo",
            mode="advanced",
            advanced_edges=[["IN_TIP", "L5"], *stereo_tail],
            notes="Guitar straight into the BigSky; drives routed around, not just bypassed.",
        ),
        Ml10xPreset(
            number=1,
            name="Drive stereo",
            mode="advanced",
            advanced_edges=[["IN_TIP", "L1"], ["L1", "L3"], ["L3", "L5"], *stereo_tail],
        ),
        Ml10xPreset(
            number=2,
            name="Solo stereo",
            mode="advanced",
            advanced_edges=[["IN_TIP", "L3"], ["L3", "L1"], ["L1", "L5"], *stereo_tail],
            notes="Sunset before Plumes for the solo (loop order swapped).",
        ),
    ]
    scenes = [
        Scene(
            id="scene_clean",
            name="Clean intro",
            song="Stereo demo",
            section="Intro",
            order=0,
            color="#3b82f6",
            ml10x=Ml10xSceneState(preset_number=0),
            device_states=[
                DeviceSceneState(instance_id=B, program=ProgramSelection(pc=0, bank_msb=0), enabled=True),
                DeviceSceneState(instance_id=S, enabled=False),
            ],
        ),
        Scene(
            id="scene_heavy",
            name="Heavy verse",
            song="Stereo demo",
            section="Verse",
            order=1,
            color="#ef4444",
            ml10x=Ml10xSceneState(preset_number=1),
            device_states=[
                DeviceSceneState(instance_id=P, enabled=True),
                DeviceSceneState(instance_id=S, program=ProgramSelection(pc=1), enabled=True),
                DeviceSceneState(instance_id=B, program=ProgramSelection(pc=1, bank_msb=0), enabled=True),
            ],
        ),
        Scene(
            id="scene_solo",
            name="Solo",
            song="Stereo demo",
            section="Solo",
            order=2,
            color="#f59e0b",
            ml10x=Ml10xSceneState(preset_number=2),
            device_states=[
                DeviceSceneState(instance_id=P, enabled=True),
                DeviceSceneState(instance_id=S, program=ProgramSelection(pc=2), enabled=True),
                DeviceSceneState(instance_id=B, program=ProgramSelection(pc=2, bank_msb=0), enabled=True),
            ],
            manual_steps=["Roll guitar volume to 10."],
        ),
    ]
    controllers = Controllers(
        mc8=Mc8Config(
            instance_id=A,
            firmware_version="3.13.6",
            banks=[
                Mc8Bank(
                    number=1,
                    name="Stereo demo",
                    presets=[
                        Mc8Preset(position="A", short_name="Clean", scene_id="scene_clean"),
                        Mc8Preset(position="B", short_name="Heavy", scene_id="scene_heavy"),
                        Mc8Preset(position="C", short_name="Solo", scene_id="scene_solo"),
                    ],
                ),
            ],
        ),
        ml10x=Ml10xConfig(
            instance_id=M,
            firmware_version="1.2.0",
            advanced_mode=True,
            loop_assignments=[
                Ml10xLoopAssignment(loop=1, label="Plumes"),
                Ml10xLoopAssignment(loop=3, label="Sunset"),
                Ml10xLoopAssignment(loop=5, label="BigSky MX L", stereo_pair_with=6),
                Ml10xLoopAssignment(loop=6, label="BigSky MX R", stereo_pair_with=5),
            ],
            presets=presets,
        ),
    )
    return Rig(
        id=STEREO_DEMO_RIG_ID,
        name="Stereo demo: drives into a stereo BigSky, two amps",
        description="Mono drives in loops A/B, BigSky MX in loop C as a stereo pair (mono send, stereo return), ML10X Output Tip/Ring to two amps. Advanced presets, firmware 1.2.",
        board=Board(name="Generic 600 x 300 mm board", width_mm=600, depth_mm=300, grid_mm=5),
        instances=instances,
        connections=connections,
        scenes=scenes,
        controllers=controllers,
        notes="Left path: guitar -> drives -> BigSky In L -> Out L -> Return C Tip -> Output Tip -> Amp L. Right path: BigSky Out R -> Return C Ring -> Output Ring -> Amp R.",
    )


def virtual_instrument_rig() -> Rig:
    """The Session 5 synthetic fixture: two Signal Loom virtual pedals and the **Undertow** texture.

    One Bloom macro moves Pedal A's synthetic CC 21 from 100 down to 30 while Pedal B's synthetic
    CC 22 rises from 15 to 110, with a slow triangle over eight beats at 72 BPM. The CC numbers and
    ranges are test-fixture values, not claims about any real pedal; both devices are labelled
    synthetic everywhere. The rig is created on demand (``POST /api/rigs {template:
    "virtual_instrument"}``), never seeded implicitly."""
    PA, PB, G, AMP = "inst_vpedal_a", "inst_vpedal_b", "inst_guitar", "inst_amp"
    instances = [
        DeviceInstance(
            id=PA,
            profile_id="signal-loom-virtual-pedal-a",
            label="Virtual Pedal A (drive)",
            x_mm=40,
            y_mm=40,
            midi_channel=1,
        ),
        DeviceInstance(
            id=PB,
            profile_id="signal-loom-virtual-pedal-b",
            label="Virtual Pedal B (delay)",
            x_mm=220,
            y_mm=40,
            midi_channel=2,
        ),
        DeviceInstance(id=G, profile_id="generic-guitar", label="Guitar", off_board=True),
        DeviceInstance(id=AMP, profile_id="generic-amp", label="Amp", off_board=True),
    ]
    au = SignalKind.AUDIO
    connections = [
        _c(au, G, "out", PA, "in", "Guitar -> Pedal A"),
        _c(au, PA, "out", PB, "in", "Pedal A -> Pedal B"),
        _c(au, PB, "out", AMP, "input", "Pedal B -> Amp"),
    ]
    scenes = [
        Scene(
            id="scene_undertow_start",
            name="Undertow start",
            order=0,
            color="#0ea5e9",
            device_states=[
                DeviceSceneState(instance_id=PA, program=ProgramSelection(pc=0), enabled=True),
                DeviceSceneState(instance_id=PB, program=ProgramSelection(pc=1), enabled=True),
            ],
            notes="Starting point the Undertow texture assumes: both virtual pedals engaged on their first presets.",
        ),
    ]
    textures = [
        Texture(
            id=UNDERTOW_TEXTURE_ID,
            name="Undertow",
            intent="Drive recedes as the delay blooms; a slow tide underneath.",
            notes="Synthetic demo: CC 21 on Pedal A falls 100→30 while CC 22 on Pedal B rises 15→110. Fixture values only.",
            base_scene_id="scene_undertow_start",
            tempo_bpm=72.0,
            macros=[
                Macro(
                    id="macro_bloom",
                    name="Bloom",
                    base=0.35,
                    mappings=[
                        Mapping(
                            id="map_bloom_a",
                            instance_id=PA,
                            cc=21,
                            output_min=100,
                            output_max=30,
                            label="Drive recedes",
                        ),
                        Mapping(
                            id="map_bloom_b",
                            instance_id=PB,
                            cc=22,
                            output_min=15,
                            output_max=110,
                            label="Delay blooms",
                        ),
                    ],
                    lfo=Lfo(enabled=True, shape="triangle", beats_per_cycle=8.0, depth=0.25),
                )
            ],
            function_roles={PA: "drive", PB: "delay"},
            origin="virtual_fixture",
        )
    ]
    return Rig(
        id=VIRTUAL_INSTRUMENT_RIG_ID,
        name="Undertow demo (virtual instrument)",
        description="Synthetic fixture for the whole-rig instrument: two simulated pedals with labelled synthetic continuous CCs, one Texture, one macro, one tempo-related LFO. Nothing here is a real pedal.",
        board=Board(name="Synthetic 400 x 200 mm board", width_mm=400, depth_mm=200, grid_mm=5),
        instances=instances,
        connections=connections,
        scenes=scenes,
        textures=textures,
        notes="Guitar -> Virtual Pedal A -> Virtual Pedal B -> amp. Every MIDI fact of the two pedals is defined by Signal Loom for the simulation.",
    )
