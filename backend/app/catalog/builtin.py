"""Hand-authored example device profiles with explicit provenance.

Nothing here is copied from a third-party dataset. Dimensions and MIDI facts carry the
evidence level recorded in docs/research.md. Where a value could not be sourced it is left
unknown on purpose, so the UI shows the uncertainty instead of a fabricated number.

NOTE on port positions: no manufacturer publishes jack coordinates. Every position below is
an *estimate* (evidence = approximate) chosen only to keep jacks in a plausible order on the
right edge; users can override them per instance in the jack editor.
"""

from __future__ import annotations

from ..models.common import (
    AudioChannel,
    Connector,
    DeviceCategory,
    Edge,
    Evidence,
    MidiTrsType,
    Polarity,
    PortDirection,
    SignalKind,
    TrsRole,
)
from ..models.profile import (
    BypassSpec,
    Capabilities,
    CcDef,
    DeviceProfile,
    Footprint,
    Measure,
    MidiSpec,
    PortDef,
    PowerSpec,
    ProgramChangeSpec,
    Provenance,
)

IN_TO_MM = 25.4


def _m(value_mm: float | None, ev: Evidence, note: str | None = None) -> Measure:
    return Measure(value_mm=value_mm, evidence=ev, note=note)


def _audio(
    pid: str,
    label: str,
    direction: PortDirection,
    edge: Edge,
    pos: float | None,
    *,
    channel: AudioChannel = AudioChannel.MONO,
    connector: Connector = Connector.TS_1_4,
    trs_role: TrsRole | None = None,
    role: str | None = None,
    loop: int | None = None,
    pair_group: str | None = None,
    ev: Evidence = Evidence.APPROXIMATE,
    notes: str | None = None,
) -> PortDef:
    return PortDef(
        id=pid,
        label=label,
        kind=SignalKind.AUDIO,
        direction=direction,
        connector=connector,
        audio_channel=channel,
        trs_role=trs_role,
        edge=edge,
        position=pos,
        position_evidence=ev if pos is not None else Evidence.UNKNOWN,
        role=role,
        loop=loop,
        pair_group=pair_group,
        notes=notes,
        plug_clearance_mm=38.0,
    )


def _dc_in(edge: Edge = Edge.TOP, pos: float | None = 0.5, connector: Connector = Connector.DC_BARREL_2_1) -> PortDef:
    return PortDef(
        id="dc_in",
        label="DC in",
        kind=SignalKind.POWER,
        direction=PortDirection.IN,
        connector=connector,
        edge=edge,
        position=pos,
        position_evidence=Evidence.APPROXIMATE if pos is not None else Evidence.UNKNOWN,
        role="supply_in",
        plug_clearance_mm=25.0,
    )


def mc8() -> DeviceProfile:
    ports = [
        PortDef(
            id="midi_in",
            label="MIDI In",
            kind=SignalKind.MIDI,
            direction=PortDirection.IN,
            connector=Connector.DIN5,
            midi_trs_type=MidiTrsType.DIN,
            edge=Edge.TOP,
            position=0.08,
            position_evidence=Evidence.APPROXIMATE,
            plug_clearance_mm=40.0,
        ),
        PortDef(
            id="midi_out",
            label="MIDI Out/Thru",
            kind=SignalKind.MIDI,
            direction=PortDirection.OUT,
            connector=Connector.DIN5,
            midi_trs_type=MidiTrsType.DIN,
            edge=Edge.TOP,
            position=0.18,
            position_evidence=Evidence.APPROXIMATE,
            role="controller_out",
            plug_clearance_mm=40.0,
            notes="7-pin socket (phantom power on pins 6/7), 5-pin compatible.",
        ),
        PortDef(
            id="omni1",
            label="Omniport 1 (TRS MIDI out)",
            kind=SignalKind.MIDI,
            direction=PortDirection.OUT,
            connector=Connector.TRS_1_4,
            midi_trs_type=MidiTrsType.TYPE_A,
            trs_role=TrsRole.MIDI,
            edge=Edge.TOP,
            position=0.40,
            position_evidence=Evidence.APPROXIMATE,
            role="controller_out",
            plug_clearance_mm=38.0,
            notes="Configurable per port: MIDI out (Standard = tip active, or Type B = ring active), expression in, or aux switch in. Modelled here as MIDI out, Standard/Type A.",
        ),
        PortDef(
            id="omni2",
            label="Omniport 2 (TRS MIDI out)",
            kind=SignalKind.MIDI,
            direction=PortDirection.OUT,
            connector=Connector.TRS_1_4,
            midi_trs_type=MidiTrsType.TYPE_A,
            trs_role=TrsRole.MIDI,
            edge=Edge.TOP,
            position=0.52,
            position_evidence=Evidence.APPROXIMATE,
            role="controller_out",
            plug_clearance_mm=38.0,
            notes="Configurable; modelled as MIDI out Standard/Type A. Omniports cannot send SysEx.",
        ),
        PortDef(
            id="omni3",
            label="Omniport 3 (expression in)",
            kind=SignalKind.EXPRESSION,
            direction=PortDirection.IN,
            connector=Connector.TRS_1_4,
            trs_role=TrsRole.EXPRESSION,
            edge=Edge.TOP,
            position=0.64,
            position_evidence=Evidence.APPROXIMATE,
            role="exp_in",
            plug_clearance_mm=38.0,
            notes="Configurable; modelled as expression pedal input.",
        ),
        PortDef(
            id="omni4",
            label="Omniport 4 (expression in)",
            kind=SignalKind.EXPRESSION,
            direction=PortDirection.IN,
            connector=Connector.TRS_1_4,
            trs_role=TrsRole.EXPRESSION,
            edge=Edge.TOP,
            position=0.76,
            position_evidence=Evidence.APPROXIMATE,
            role="exp_in",
            plug_clearance_mm=38.0,
            notes="Configurable; modelled as expression pedal input.",
        ),
        PortDef(
            id="usb",
            label="USB-B",
            kind=SignalKind.USB,
            direction=PortDirection.BIDIRECTIONAL,
            connector=Connector.USB_B,
            edge=Edge.TOP,
            position=0.88,
            position_evidence=Evidence.APPROXIMATE,
            plug_clearance_mm=30.0,
        ),
        _dc_in(Edge.TOP, 0.96),
    ]
    return DeviceProfile(
        id="morningstar-mc8",
        manufacturer="Morningstar",
        model="MC8",
        category=DeviceCategory.CONTROLLER,
        revision="original (not Pro)",
        builtin=True,
        provenance=Provenance(
            source="hand_authored",
            url="https://www.morningstar.io/mc8-midi-controller",
            evidence=Evidence.DOCUMENTED,
            retrieved="2026-10-15 (search excerpts; vendor host unreachable from build sandbox)",
        ),
        footprint=Footprint(
            width=_m(224, Evidence.DOCUMENTED, "224 x 125 x 50 mm per morningstar.io spec"),
            depth=_m(125, Evidence.DOCUMENTED),
            height=_m(50, Evidence.DOCUMENTED),
            includes_jacks=None,
        ),
        ports=ports,
        power=PowerSpec(
            voltage_v=9,
            polarity=Polarity.CENTER_NEGATIVE,
            ac_dc="dc",
            current_ma_min=250,
            connector=Connector.DC_BARREL_2_1,
            evidence=Evidence.DOCUMENTED,
            note="9 VDC centre negative, min 250 mA; can also be USB bus powered.",
        ),
        midi=MidiSpec(
            interfaces=["din_in", "din_out", "trs_out", "usb"],
            default_channel=None,
            channel_configurable=True,
            program_change=ProgramChangeSpec(
                supported=True,
                min=0,
                max=127,
                display_numbering="zero_based",
                note="Incoming PC n jumps to bank n+1.",
                evidence=Evidence.DOCUMENTED,
            ),
            source_url="https://help.morningstar.io/en/article/mc8-user-manual-1fzlzjx/",
            evidence=Evidence.DOCUMENTED,
        ),
        capabilities=Capabilities(
            bypass_method="n/a",
            patch_selection="n/a",
            params_via_midi=True,
            notes="30 banks x 22 switch presets + 4 expression presets; 16 messages per preset.",
        ),
        declared_unknowns=[
            "footprint.includes_jacks",
            "jack positions (estimated)",
            "own receive MIDI channel default",
        ],
        tags=["controller", "morningstar"],
    )


def ml10x() -> DeviceProfile:
    pairs = ["A", "B", "C", "D", "E"]
    ports: list[PortDef] = [
        _audio(
            "in_tip",
            "Input (Tip)",
            PortDirection.IN,
            Edge.TOP,
            0.04,
            channel=AudioChannel.LEFT,
            connector=Connector.TRS_1_4,
            trs_role=TrsRole.STEREO,
            role="main_in",
            pair_group="input",
            notes="One stereo TRS jack: Tip and Ring are independent mono channels. Mono guitar: use a TS cable into the Tip.",
        ),
        _audio(
            "in_ring",
            "Input (Ring)",
            PortDirection.IN,
            Edge.TOP,
            0.07,
            channel=AudioChannel.RIGHT,
            connector=Connector.TRS_1_4,
            trs_role=TrsRole.STEREO,
            role="main_in",
            pair_group="input",
            notes="Second conductor of the Input jack; needs a TRS-to-dual-TS splitter to use separately.",
        ),
    ]
    x = 0.14
    for i, p in enumerate(pairs):
        tip, ring = 2 * i + 1, 2 * i + 2
        ports.append(
            _audio(
                f"send_{p.lower()}_tip",
                f"Send {p} (Tip)",
                PortDirection.OUT,
                Edge.TOP,
                x,
                channel=AudioChannel.LEFT,
                connector=Connector.TRS_1_4,
                trs_role=TrsRole.STEREO,
                role="loop_send",
                loop=tip,
                pair_group=f"send_{p.lower()}",
                notes=f"Loop {tip} = {p} Tip. Send Tip -> pedal input.",
            )
        )
        ports.append(
            _audio(
                f"send_{p.lower()}_ring",
                f"Send {p} (Ring)",
                PortDirection.OUT,
                Edge.TOP,
                x + 0.03,
                channel=AudioChannel.RIGHT,
                connector=Connector.TRS_1_4,
                trs_role=TrsRole.STEREO,
                role="loop_send",
                loop=ring,
                pair_group=f"send_{p.lower()}",
                notes=f"Loop {ring} = {p} Ring. Needs splitter cable when used alongside the Tip.",
            )
        )
        ports.append(
            _audio(
                f"return_{p.lower()}_tip",
                f"Return {p} (Tip)",
                PortDirection.IN,
                Edge.TOP,
                x + 0.08,
                channel=AudioChannel.LEFT,
                connector=Connector.TRS_1_4,
                trs_role=TrsRole.STEREO,
                role="loop_return",
                loop=tip,
                pair_group=f"return_{p.lower()}",
                notes=f"Loop {tip} = {p} Tip. Pedal output -> Return Tip.",
            )
        )
        ports.append(
            _audio(
                f"return_{p.lower()}_ring",
                f"Return {p} (Ring)",
                PortDirection.IN,
                Edge.TOP,
                x + 0.11,
                channel=AudioChannel.RIGHT,
                connector=Connector.TRS_1_4,
                trs_role=TrsRole.STEREO,
                role="loop_return",
                loop=ring,
                pair_group=f"return_{p.lower()}",
                notes=f"Loop {ring} = {p} Ring.",
            )
        )
        x += 0.16
    ports += [
        _audio(
            "out_tip",
            "Output (Tip)",
            PortDirection.OUT,
            Edge.TOP,
            0.94,
            channel=AudioChannel.LEFT,
            connector=Connector.TRS_1_4,
            trs_role=TrsRole.STEREO,
            role="main_out",
            pair_group="output",
            notes="Mono rig: TS cable from the Tip to the amp.",
        ),
        _audio(
            "out_ring",
            "Output (Ring)",
            PortDirection.OUT,
            Edge.TOP,
            0.97,
            channel=AudioChannel.RIGHT,
            connector=Connector.TRS_1_4,
            trs_role=TrsRole.STEREO,
            role="main_out",
            pair_group="output",
        ),
        PortDef(
            id="midi_in",
            label="MIDI In",
            kind=SignalKind.MIDI,
            direction=PortDirection.IN,
            connector=Connector.DIN5,
            midi_trs_type=MidiTrsType.DIN,
            edge=Edge.BOTTOM,
            position=0.2,
            position_evidence=Evidence.APPROXIMATE,
            plug_clearance_mm=40.0,
        ),
        PortDef(
            id="midi_thru",
            label="MIDI Thru",
            kind=SignalKind.MIDI,
            direction=PortDirection.OUT,
            connector=Connector.DIN5,
            midi_trs_type=MidiTrsType.DIN,
            edge=Edge.BOTTOM,
            position=0.35,
            position_evidence=Evidence.APPROXIMATE,
            role="thru",
            plug_clearance_mm=40.0,
            notes="Hardware Thru: passes incoming MIDI; the ML10X has no MIDI Out of its own.",
        ),
        PortDef(
            id="usb",
            label="USB-C",
            kind=SignalKind.USB,
            direction=PortDirection.BIDIRECTIONAL,
            connector=Connector.USB_C,
            edge=Edge.BOTTOM,
            position=0.6,
            position_evidence=Evidence.APPROXIMATE,
            plug_clearance_mm=25.0,
            notes="Editor/firmware/backups. USB alone does not power the switching relays.",
        ),
        _dc_in(Edge.BOTTOM, 0.85),
    ]
    cc_map = [
        CcDef(cc=0, name="Change Bank", value_semantics="0-3 = Banks 1-4", evidence=Evidence.DOCUMENTED),
        CcDef(
            cc=4,
            name="Engage/Bypass all loops (Simple)",
            value_semantics="0-63 bypass, 64-127 engage",
            evidence=Evidence.DOCUMENTED,
        ),
        CcDef(cc=5, name="Scroll preset up", evidence=Evidence.DOCUMENTED),
        CcDef(cc=6, name="Scroll preset down", evidence=Evidence.DOCUMENTED),
        CcDef(cc=7, name="Mute", evidence=Evidence.DOCUMENTED),
        CcDef(cc=8, name="Unmute", evidence=Evidence.DOCUMENTED),
        CcDef(cc=9, name="Toggle mute", evidence=Evidence.DOCUMENTED),
    ]
    for i in range(10):
        nm = f"{pairs[i // 2]} {'Tip' if i % 2 == 0 else 'Ring'}"
        cc_map.append(
            CcDef(
                cc=10 + i,
                name=f"Engage/Bypass loop {i + 1} ({nm})",
                value_semantics="0-63 bypass, 64-127 engage; Simple presets only",
                evidence=Evidence.DOCUMENTED if i == 0 else Evidence.THIRD_PARTY,
            )
        )
        cc_map.append(
            CcDef(
                cc=20 + i,
                name=f"Toggle loop {i + 1} ({nm})",
                value_semantics="any value toggles; Simple presets only",
                evidence=Evidence.DOCUMENTED if i == 0 else Evidence.THIRD_PARTY,
            )
        )
    return DeviceProfile(
        id="morningstar-ml10x",
        manufacturer="Morningstar",
        model="ML10X",
        category=DeviceCategory.SWITCHER,
        builtin=True,
        provenance=Provenance(
            source="hand_authored",
            url="https://www.morningstar.io/ml10x",
            evidence=Evidence.DOCUMENTED,
            retrieved="2026-10-15 (search excerpts; vendor host unreachable from build sandbox)",
        ),
        footprint=Footprint(
            width=_m(169, Evidence.DOCUMENTED, "Enclosure 169 x 58 x 58 mm per morningstar.io"),
            depth=_m(58, Evidence.DOCUMENTED),
            height=_m(58, Evidence.DOCUMENTED),
            includes_jacks=False,
        ),
        ports=ports,
        power=PowerSpec(
            voltage_v=9,
            polarity=Polarity.CENTER_NEGATIVE,
            ac_dc="dc",
            current_ma_min=160,
            connector=Connector.DC_BARREL_2_1,
            evidence=Evidence.DOCUMENTED,
            note="9-18 VDC centre negative, min 160 mA (9 V assumed here; 18 V raises headroom).",
        ),
        midi=MidiSpec(
            interfaces=["din_in", "din_thru", "usb"],
            default_channel=None,
            channel_configurable=True,
            program_change=ProgramChangeSpec(
                supported=True,
                min=0,
                max=127,
                display_numbering="zero_based",
                bank_select_supported=True,
                note="PC 0-127 recalls presets 0-127 of the current bank; send CC#0 (0-3) first to choose the bank.",
                evidence=Evidence.DOCUMENTED,
            ),
            cc_map=cc_map,
            bypass=BypassSpec(
                method="none",
                note="Loops are bypassed per preset or per-loop CC; the unit itself has no bypass.",
                evidence=Evidence.DOCUMENTED,
            ),
            source_url="https://help.morningstar.io/en/article/ml10x-user-manual-262ann/",
            evidence=Evidence.DOCUMENTED,
        ),
        capabilities=Capabilities(
            bypass_method="per-loop",
            patch_selection="pc",
            params_via_midi=True,
            is_stereo=True,
            notes="5 stereo TRS loops = 10 mono loops (Tip/Ring). 4 banks x 128 presets. Simple presets: mono series chain; Advanced presets: split/merge (editor only).",
        ),
        declared_unknowns=[
            "factory default MIDI channel",
            "jack positions (estimated)",
            "weight (official figures conflict: 439 g vs 450 g)",
        ],
        tags=["switcher", "morningstar", "stereo"],
    )


def strymon_sunset() -> DeviceProfile:
    return DeviceProfile(
        id="strymon-sunset",
        manufacturer="Strymon",
        model="Sunset",
        category=DeviceCategory.EFFECT,
        builtin=True,
        provenance=Provenance(
            source="hand_authored",
            url="https://www.strymon.net/product/sunset/",
            evidence=Evidence.THIRD_PARTY,
            retrieved="2026-10-15 (dimensions only seen on retailer copies of Strymon spec text)",
        ),
        footprint=Footprint(
            width=_m(4.0 * IN_TO_MM, Evidence.THIRD_PARTY, '4" wide per retailer copies of Strymon spec'),
            depth=_m(4.5 * IN_TO_MM, Evidence.THIRD_PARTY, '4.5" deep'),
            height=_m(1.75 * IN_TO_MM, Evidence.THIRD_PARTY),
            includes_jacks=None,
        ),
        ports=[
            _audio("in", "IN", PortDirection.IN, Edge.TOP, 0.15, notes='Mono 1/4" input.'),
            _audio("out", "OUT", PortDirection.OUT, Edge.TOP, 0.35, notes='Mono 1/4" output.'),
            PortDef(
                id="fav",
                label="FAV",
                kind=SignalKind.EXPRESSION,
                direction=PortDirection.IN,
                connector=Connector.TRS_1_4,
                trs_role=TrsRole.EXPRESSION,
                edge=Edge.TOP,
                position=0.55,
                position_evidence=Evidence.APPROXIMATE,
                role="exp_in",
                plug_clearance_mm=38.0,
                notes="Favorite switch; can take an expression pedal when EXP is used for MIDI.",
            ),
            PortDef(
                id="exp_midi",
                label="EXP / MIDI",
                kind=SignalKind.MIDI,
                direction=PortDirection.IN,
                connector=Connector.TRS_1_4,
                trs_role=TrsRole.MIDI,
                midi_trs_type=MidiTrsType.PROPRIETARY,
                edge=Edge.TOP,
                position=0.75,
                position_evidence=Evidence.APPROXIMATE,
                plug_clearance_mm=38.0,
                notes="MIDI arrives on the EXP jack only via a Strymon MIDI EXP cable, Strymon Conduit, or compatible 5-pin-to-TRS interface (firmware 1.20+, EXP jack set to MIDI mode). A generic TRS MIDI cable is not guaranteed to work.",
            ),
            _dc_in(Edge.TOP, 0.92),
        ],
        power=PowerSpec(
            voltage_v=9,
            polarity=Polarity.CENTER_NEGATIVE,
            ac_dc="dc",
            current_ma_min=250,
            connector=Connector.DC_BARREL_2_1,
            evidence=Evidence.DOCUMENTED,
            note="9 VDC centre negative, 250 mA minimum (manual).",
        ),
        midi=MidiSpec(
            interfaces=["trs_in"],
            default_channel=1,
            channel_configurable=True,
            program_change=ProgramChangeSpec(
                supported=True,
                min=0,
                max=127,
                display_numbering="zero_based",
                bank_select_supported=True,
                note="300 preset locations; MIDI bank 0 at power-up; CC#0 bank select for presets beyond 127. PC does not change bypass state.",
                evidence=Evidence.DOCUMENTED,
            ),
            cc_map=[
                CcDef(
                    cc=10,
                    name="Bypass/engage A side",
                    value_semantics="0 = bypass, 1-127 = engage",
                    evidence=Evidence.DOCUMENTED,
                ),
                CcDef(
                    cc=15,
                    name="Bypass/engage B side",
                    value_semantics="0 = bypass, 1-127 = engage",
                    evidence=Evidence.DOCUMENTED,
                ),
                CcDef(
                    cc=100,
                    name="Expression (unverified for Sunset)",
                    value_semantics="0 heel - 127 toe",
                    evidence=Evidence.UNKNOWN,
                ),
            ],
            bypass=BypassSpec(
                method="cc",
                cc=10,
                on_value=127,
                off_value=0,
                deterministic=True,
                evidence=Evidence.DOCUMENTED,
                note="A side; B side uses CC#15 and is controlled separately",
            ),
            source_url="https://www.strymon.net/faq/control-sunset-with-midi/",
            evidence=Evidence.DOCUMENTED,
        ),
        capabilities=Capabilities(
            bypass_method="relay true bypass or buffered (selectable)",
            patch_selection="pc",
            params_via_midi=True,
            is_stereo=False,
            notes="Two drive circuits (A/B) with independent bypass; full knob CC chart not retrieved.",
        ),
        declared_unknowns=[
            "official dimensions on strymon.net (retailer copies only)",
            "weight",
            "full CC chart (knobs)",
            "jack positions (estimated)",
        ],
        tags=["drive", "strymon", "midi"],
    )


def strymon_bigsky_mx() -> DeviceProfile:
    return DeviceProfile(
        id="strymon-bigsky-mx",
        manufacturer="Strymon",
        model="BigSky MX",
        category=DeviceCategory.EFFECT,
        builtin=True,
        provenance=Provenance(
            source="hand_authored",
            url="https://www.strymon.net/product/bigsky-mx/",
            evidence=Evidence.DOCUMENTED,
            retrieved="2026-10-15 (search excerpts; manual pp. 70+ not read)",
        ),
        footprint=Footprint(
            width=_m(7.0 * IN_TO_MM, Evidence.DOCUMENTED, '5" deep x 7" wide x 1.87" tall per strymon.net'),
            depth=_m(5.0 * IN_TO_MM, Evidence.DOCUMENTED),
            height=_m(1.87 * IN_TO_MM, Evidence.DOCUMENTED),
            includes_jacks=None,
        ),
        ports=[
            _audio(
                "in_l",
                "IN L",
                PortDirection.IN,
                Edge.TOP,
                0.08,
                channel=AudioChannel.LEFT,
                pair_group="in",
                notes="Stereo input; whether the jacks are TS pairs or TRS is not confirmed in retrieved material.",
            ),
            _audio("in_r", "IN R", PortDirection.IN, Edge.TOP, 0.16, channel=AudioChannel.RIGHT, pair_group="in"),
            _audio("out_l", "OUT L", PortDirection.OUT, Edge.TOP, 0.26, channel=AudioChannel.LEFT, pair_group="out"),
            _audio("out_r", "OUT R", PortDirection.OUT, Edge.TOP, 0.34, channel=AudioChannel.RIGHT, pair_group="out"),
            PortDef(
                id="exp",
                label="EXP",
                kind=SignalKind.EXPRESSION,
                direction=PortDirection.IN,
                connector=Connector.TRS_1_4,
                trs_role=TrsRole.EXPRESSION,
                edge=Edge.TOP,
                position=0.46,
                position_evidence=Evidence.APPROXIMATE,
                role="exp_in",
                plug_clearance_mm=38.0,
                notes="Modes: Preset / Bank / MIDI (TRS MIDI type unknown).",
            ),
            PortDef(
                id="midi_in",
                label="MIDI IN",
                kind=SignalKind.MIDI,
                direction=PortDirection.IN,
                connector=Connector.DIN5,
                midi_trs_type=MidiTrsType.DIN,
                edge=Edge.TOP,
                position=0.58,
                position_evidence=Evidence.APPROXIMATE,
                plug_clearance_mm=40.0,
            ),
            PortDef(
                id="midi_out",
                label="MIDI OUT",
                kind=SignalKind.MIDI,
                direction=PortDirection.OUT,
                connector=Connector.DIN5,
                midi_trs_type=MidiTrsType.DIN,
                edge=Edge.TOP,
                position=0.68,
                position_evidence=Evidence.APPROXIMATE,
                role="thru",
                plug_clearance_mm=40.0,
                notes="MIDI THRU setting: Thru/Merge.",
            ),
            PortDef(
                id="usb",
                label="USB-C",
                kind=SignalKind.USB,
                direction=PortDirection.BIDIRECTIONAL,
                connector=Connector.USB_C,
                edge=Edge.TOP,
                position=0.80,
                position_evidence=Evidence.APPROXIMATE,
                plug_clearance_mm=25.0,
            ),
            _dc_in(Edge.TOP, 0.92),
        ],
        power=PowerSpec(
            voltage_v=9,
            polarity=Polarity.CENTER_NEGATIVE,
            ac_dc="dc",
            current_ma_min=500,
            connector=Connector.DC_BARREL_2_1,
            evidence=Evidence.DOCUMENTED,
            note="9 VDC centre negative 2.1 mm, 500 mA minimum.",
        ),
        midi=MidiSpec(
            interfaces=["din_in", "din_out", "usb", "trs_in"],
            default_channel=1,
            channel_configurable=True,
            program_change=ProgramChangeSpec(
                supported=True,
                min=0,
                max=127,
                display_numbering="zero_based",
                bank_select_supported=True,
                note="300 presets (100 banks x A/B/C): PC 0 -> 00A, 1 -> 00B ...; CC#0 = 0/1/2 selects presets 0-127/128-255/256-299. Documented for the original BigSky, unverified for MX.",
                evidence=Evidence.THIRD_PARTY,
            ),
            cc_map=[
                CcDef(
                    cc=102,
                    name="Bypass/engage",
                    value_semantics="0 = bypass, 127 = engage (BigSky family; unverified for MX)",
                    evidence=Evidence.THIRD_PARTY,
                ),
                CcDef(cc=100, name="Expression", value_semantics="0 heel - 127 toe", evidence=Evidence.DOCUMENTED),
            ],
            bypass=BypassSpec(
                method="cc",
                cc=102,
                on_value=127,
                off_value=0,
                deterministic=True,
                evidence=Evidence.THIRD_PARTY,
                note="CC#102 documented for the BigSky family; not confirmed in the MX manual",
            ),
            source_url="https://www.strymon.net/manuals/BigSky_MX_UserManual_RevB.pdf",
            evidence=Evidence.THIRD_PARTY,
        ),
        capabilities=Capabilities(
            bypass_method="selectable", patch_selection="pc", params_via_midi=True, is_stereo=True
        ),
        declared_unknowns=[
            "weight",
            "stereo jack format (TRS vs dual TS)",
            "TRS MIDI type on EXP",
            "MX-specific bypass CC and bank mapping",
            "jack positions (estimated)",
        ],
        tags=["reverb", "strymon", "midi", "stereo"],
    )


def eqd_plumes() -> DeviceProfile:
    return DeviceProfile(
        id="eqd-plumes",
        manufacturer="EarthQuaker Devices",
        model="Plumes",
        category=DeviceCategory.EFFECT,
        builtin=True,
        provenance=Provenance(
            source="hand_authored",
            url="https://www.earthquakerdevices.com/plumes",
            evidence=Evidence.DOCUMENTED,
            retrieved="2026-10-15 (search excerpts of the official tech specs)",
        ),
        footprint=Footprint(
            width=_m(64, Evidence.DOCUMENTED, "4.75 x 2.50 x 2.25 in (121 x 64 x 57 mm) with knobs per EQD tech specs"),
            depth=_m(121, Evidence.DOCUMENTED),
            height=_m(57, Evidence.DOCUMENTED, "includes knobs"),
            includes_jacks=None,
        ),
        # Jack positions deliberately unknown: the official jack list was not retrieved.
        ports=[
            _audio(
                "in",
                "Input",
                PortDirection.IN,
                Edge.RIGHT,
                None,
                notes='Side-mounted 1/4" input (position not documented).',
            ),
            _audio(
                "out",
                "Output",
                PortDirection.OUT,
                Edge.LEFT,
                None,
                notes='Side-mounted 1/4" output (position not documented).',
            ),
            _dc_in(Edge.TOP, None),
        ],
        power=PowerSpec(
            voltage_v=9,
            polarity=Polarity.CENTER_NEGATIVE,
            ac_dc="dc",
            current_ma_min=25,
            connector=Connector.DC_BARREL_2_1,
            evidence=Evidence.DOCUMENTED,
            note="9 VDC 2.1 mm centre negative, 25 mA; no battery.",
        ),
        midi=MidiSpec(interfaces=[], evidence=Evidence.DOCUMENTED, note="No MIDI."),
        capabilities=Capabilities(
            bypass_method="relay true bypass (Flexi-Switch)",
            patch_selection="none",
            params_via_midi=False,
            is_stereo=False,
        ),
        declared_unknowns=["jack positions (not documented)", "weight", "whether dimensions include jacks"],
        tags=["drive", "analog", "no-midi"],
    )


def generic_mono_effect() -> DeviceProfile:
    return DeviceProfile(
        id="generic-mono-effect",
        manufacturer="Generic",
        model="Mono effect (1590B-size)",
        category=DeviceCategory.EFFECT,
        builtin=True,
        provenance=Provenance(
            source="hand_authored",
            evidence=Evidence.APPROXIMATE,
            attribution="Placeholder silhouette sized like a Hammond 1590B enclosure; edit to match your pedal.",
        ),
        footprint=Footprint(
            width=_m(60, Evidence.APPROXIMATE, "1590B-class enclosure, approx."),
            depth=_m(112, Evidence.APPROXIMATE),
            height=_m(31, Evidence.APPROXIMATE),
            includes_jacks=False,
        ),
        ports=[
            _audio("in", "In", PortDirection.IN, Edge.RIGHT, 0.3, ev=Evidence.USER),
            _audio("out", "Out", PortDirection.OUT, Edge.LEFT, 0.3, ev=Evidence.USER),
            _dc_in(Edge.TOP, 0.5),
        ],
        power=PowerSpec(evidence=Evidence.UNKNOWN, note="Fill in from the pedal's manual."),
        midi=MidiSpec(interfaces=[], evidence=Evidence.UNKNOWN),
        capabilities=Capabilities(bypass_method=None, patch_selection="none", params_via_midi=False, is_stereo=False),
        declared_unknowns=["power requirements"],
        tags=["generic", "placeholder"],
    )


def generic_stereo_effect() -> DeviceProfile:
    return DeviceProfile(
        id="generic-stereo-effect",
        manufacturer="Generic",
        model="Stereo effect (1590BB-size)",
        category=DeviceCategory.EFFECT,
        builtin=True,
        provenance=Provenance(
            source="hand_authored",
            evidence=Evidence.APPROXIMATE,
            attribution="Placeholder silhouette sized like a Hammond 1590BB enclosure.",
        ),
        footprint=Footprint(
            width=_m(94, Evidence.APPROXIMATE),
            depth=_m(119, Evidence.APPROXIMATE),
            height=_m(34, Evidence.APPROXIMATE),
            includes_jacks=False,
        ),
        ports=[
            _audio(
                "in_l",
                "In L",
                PortDirection.IN,
                Edge.TOP,
                0.2,
                channel=AudioChannel.LEFT,
                pair_group="in",
                ev=Evidence.USER,
            ),
            _audio(
                "in_r",
                "In R",
                PortDirection.IN,
                Edge.TOP,
                0.35,
                channel=AudioChannel.RIGHT,
                pair_group="in",
                ev=Evidence.USER,
            ),
            _audio(
                "out_l",
                "Out L",
                PortDirection.OUT,
                Edge.TOP,
                0.65,
                channel=AudioChannel.LEFT,
                pair_group="out",
                ev=Evidence.USER,
            ),
            _audio(
                "out_r",
                "Out R",
                PortDirection.OUT,
                Edge.TOP,
                0.8,
                channel=AudioChannel.RIGHT,
                pair_group="out",
                ev=Evidence.USER,
            ),
            _dc_in(Edge.TOP, 0.5),
        ],
        power=PowerSpec(evidence=Evidence.UNKNOWN),
        midi=MidiSpec(interfaces=[], evidence=Evidence.UNKNOWN),
        capabilities=Capabilities(is_stereo=True, patch_selection="none"),
        declared_unknowns=["power requirements"],
        tags=["generic", "placeholder", "stereo"],
    )


def generic_power_supply() -> DeviceProfile:
    ports = []
    for i in range(1, 9):
        ports.append(
            PortDef(
                id=f"out{i}",
                label=f"Outlet {i} (9 V)",
                kind=SignalKind.POWER,
                direction=PortDirection.OUT,
                connector=Connector.DC_BARREL_2_1,
                edge=Edge.TOP,
                position=(i - 0.5) / 9,
                position_evidence=Evidence.USER,
                role="supply_out",
                exclusive=False,
                supply_voltage_v=9,
                supply_polarity=Polarity.CENTER_NEGATIVE,
                supply_current_ma_max=500,
                plug_clearance_mm=25.0,
            )
        )
    ports.append(
        PortDef(
            id="out9",
            label="Outlet 9 (18 V)",
            kind=SignalKind.POWER,
            direction=PortDirection.OUT,
            connector=Connector.DC_BARREL_2_1,
            edge=Edge.TOP,
            position=8.5 / 9,
            position_evidence=Evidence.USER,
            role="supply_out",
            exclusive=False,
            supply_voltage_v=18,
            supply_polarity=Polarity.CENTER_NEGATIVE,
            supply_current_ma_max=500,
            plug_clearance_mm=25.0,
        )
    )
    return DeviceProfile(
        id="generic-isolated-psu",
        manufacturer="Generic",
        model="Isolated power supply (8 x 9 V + 1 x 18 V)",
        category=DeviceCategory.POWER_SUPPLY,
        builtin=True,
        provenance=Provenance(
            source="hand_authored",
            evidence=Evidence.USER,
            attribution="Editable stand-in; outlet ratings are assumptions, not a real product's spec.",
        ),
        footprint=Footprint(
            width=_m(170, Evidence.APPROXIMATE),
            depth=_m(90, Evidence.APPROXIMATE),
            height=_m(35, Evidence.APPROXIMATE),
            includes_jacks=False,
        ),
        ports=ports,
        power=PowerSpec(evidence=Evidence.UNKNOWN, note="Mains input not modelled."),
        midi=MidiSpec(interfaces=[]),
        capabilities=Capabilities(),
        tags=["power", "generic"],
    )


def electric_guitar() -> DeviceProfile:
    return DeviceProfile(
        id="generic-guitar",
        manufacturer="Generic",
        model="Electric guitar",
        category=DeviceCategory.INSTRUMENT,
        builtin=True,
        provenance=Provenance(source="hand_authored", evidence=Evidence.USER),
        footprint=Footprint(
            width=_m(120, Evidence.USER, "symbolic tile; not on the board"),
            depth=_m(60, Evidence.USER),
            includes_jacks=False,
        ),
        ports=[_audio("out", "Output", PortDirection.OUT, Edge.RIGHT, 0.5, ev=Evidence.USER)],
        midi=MidiSpec(interfaces=[]),
        tags=["instrument"],
    )


def generic_amp() -> DeviceProfile:
    return DeviceProfile(
        id="generic-amp",
        manufacturer="Generic",
        model="Guitar amplifier",
        category=DeviceCategory.AMP,
        builtin=True,
        provenance=Provenance(source="hand_authored", evidence=Evidence.USER),
        footprint=Footprint(
            width=_m(140, Evidence.USER, "symbolic tile; not on the board"),
            depth=_m(60, Evidence.USER),
            includes_jacks=False,
        ),
        ports=[
            _audio("input", "Input", PortDirection.IN, Edge.LEFT, 0.3, ev=Evidence.USER),
            _audio("fx_send", "FX send", PortDirection.OUT, Edge.LEFT, 0.6, ev=Evidence.USER),
            _audio("fx_return", "FX return", PortDirection.IN, Edge.LEFT, 0.8, ev=Evidence.USER),
        ],
        midi=MidiSpec(interfaces=[]),
        tags=["amp"],
    )


def builtin_profiles() -> list[DeviceProfile]:
    return [
        mc8(),
        ml10x(),
        strymon_sunset(),
        strymon_bigsky_mx(),
        eqd_plumes(),
        generic_mono_effect(),
        generic_stereo_effect(),
        generic_power_supply(),
        electric_guitar(),
        generic_amp(),
    ]
