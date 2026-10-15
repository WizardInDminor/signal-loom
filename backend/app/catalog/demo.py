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

DEMO_RIG_ID = "rig_demo_signal_loom"


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
