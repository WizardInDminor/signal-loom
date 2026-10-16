"""ML10X topology: physical loop occupancy (from cables) vs virtual routing (from presets).

Three things are kept apart on purpose:
1. Which real cables are patched into Send/Return jacks  -> ``loop_occupancy``.
2. Which virtual audio path a preset establishes        -> ``preset_path`` / ``preset_diagnostics``.
3. Which MIDI commands select that preset                -> ``app.domain.compiler``.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..models.common import AudioChannel, DeviceCategory, Diagnostic, Severity, SignalKind
from ..models.rig import DeviceInstance, Ml10xPreset, Rig
from ..morningstar import specs
from .wiring import WiringContext


@dataclass
class LoopOccupancy:
    loop: int
    name: str
    send_port_id: str | None = None
    return_port_id: str | None = None
    send_to_instance_id: str | None = None  # device whose input the Send feeds
    send_to_label: str | None = None
    return_from_instance_id: str | None = None  # device whose output feeds the Return
    return_from_label: str | None = None
    complete: bool = False  # both send and return cabled
    partner_loop: int | None = None  # the other conductor of the same TRS jack

    @property
    def occupied(self) -> bool:
        return bool(self.send_to_instance_id or self.return_from_instance_id)


@dataclass
class Ml10xTopology:
    instance_id: str
    label: str
    loops: list[LoopOccupancy] = field(default_factory=list)
    stereo_pairs: list[tuple[int, int, str]] = field(default_factory=list)  # (tip loop, ring loop, label)
    input_cabled: bool = False
    output_cabled: bool = False
    # Which devices feed the Input conductors and which the Output conductors drive (from cables).
    input_from: dict[str, str] = field(default_factory=dict)  # "IN_TIP" / "IN_RING" -> device label
    output_to: dict[str, str] = field(default_factory=dict)  # "OUT_TIP" / "OUT_RING" -> device label
    diagnostics: list[Diagnostic] = field(default_factory=list)

    def loop(self, n: int) -> LoopOccupancy | None:
        for lp in self.loops:
            if lp.loop == n:
                return lp
        return None


def find_switchers(rig: Rig, ctx: WiringContext) -> list[DeviceInstance]:
    return [i for i in rig.instances if ctx.category_of(i) == DeviceCategory.SWITCHER]


def loop_occupancy(ctx: WiringContext, sw: DeviceInstance) -> Ml10xTopology:
    ports = ctx.ports[sw.id]
    topo = Ml10xTopology(instance_id=sw.id, label=sw.label)
    sends = {p.loop: p for p in ports.values() if p.role == "loop_send" and p.loop}
    returns = {p.loop: p for p in ports.values() if p.role == "loop_return" and p.loop}
    for n, name in specs.ML10X_LOOPS:
        lp = LoopOccupancy(loop=n, name=name, partner_loop=n + 1 if n % 2 == 1 else n - 1)
        if n in sends:
            lp.send_port_id = sends[n].id
        if n in returns:
            lp.return_port_id = returns[n].id
        topo.loops.append(lp)
    for rc in ctx.resolved:
        if rc.connection.kind != SignalKind.AUDIO:
            continue
        if rc.source.instance.id == sw.id:
            p = rc.source.port
            if p.role == "loop_send" and p.loop:
                lp = topo.loop(p.loop)
                if lp:
                    lp.send_to_instance_id = rc.target.instance.id
                    lp.send_to_label = rc.target.instance.label
            elif p.role == "main_out":
                topo.output_cabled = True
                key = "OUT_RING" if p.audio_channel == AudioChannel.RIGHT else "OUT_TIP"
                topo.output_to[key] = rc.target.instance.label
        if rc.target.instance.id == sw.id:
            p = rc.target.port
            if p.role == "loop_return" and p.loop:
                lp = topo.loop(p.loop)
                if lp:
                    lp.return_from_instance_id = rc.source.instance.id
                    lp.return_from_label = rc.source.instance.label
            elif p.role == "main_in":
                topo.input_cabled = True
                key = "IN_RING" if p.audio_channel == AudioChannel.RIGHT else "IN_TIP"
                topo.input_from[key] = rc.source.instance.label
    for lp in topo.loops:
        lp.complete = bool(lp.send_to_instance_id and lp.return_from_instance_id)
    # Stereo pair detection: Tip and Ring of one jack feeding the same device = stereo pedal.
    for tip in range(1, 10, 2):
        a, b = topo.loop(tip), topo.loop(tip + 1)
        if a and b and a.send_to_instance_id and a.send_to_instance_id == b.send_to_instance_id:
            topo.stereo_pairs.append((tip, tip + 1, a.send_to_label or ""))
        if a and b and a.occupied and b.occupied:
            topo.diagnostics.append(
                Diagnostic(
                    code="ml10x.splitter_cable_needed",
                    severity=Severity.INFO,
                    message=(
                        f"'{sw.label}' loop {specs.ML10X_LOOP_PAIRS[tip // 2]}: both Tip and Ring are used, so each "
                        "Send/Return jack needs a TRS-to-dual-TS splitter cable (Tip = black/L, Ring = red/R)."
                    ),
                    subject_type="instance",
                    subject_id=sw.id,
                )
            )
    return topo


def preset_path(preset: Ml10xPreset) -> list[str]:
    """Human-readable node list of the virtual path for a preset."""
    if preset.mode == "advanced" and preset.advanced_edges:
        return [f"{a}->{b}" for a, b in preset.advanced_edges]
    return ["IN", *[f"L{n}" for n in preset.chain], "OUT"]


def preset_diagnostics(topo: Ml10xTopology, preset: Ml10xPreset, firmware_version: str | None) -> list[Diagnostic]:
    """Does this virtual preset make sense given the physical cabling? Independent of scenes."""
    diags: list[Diagnostic] = []
    gate = specs.ml10x_feature_gate(firmware_version)
    subj = f"ml10x-preset-{preset.number}"
    if preset.number < 0 or preset.number >= specs.ML10X_BANKS * specs.ML10X_PRESETS_PER_BANK:
        diags.append(
            Diagnostic(
                code="ml10x.preset_out_of_range",
                severity=Severity.ERROR,
                message=f"ML10X preset {preset.number} is outside 0-{specs.ML10X_BANKS * specs.ML10X_PRESETS_PER_BANK - 1}.",
                subject_type="preset",
                subject_id=subj,
            )
        )
    if len(preset.name) > specs.ML10X_PRESET_NAME_MAX:
        diags.append(
            Diagnostic(
                code="ml10x.preset_name_long",
                severity=Severity.WARNING,
                message=f"ML10X preset name '{preset.name}' exceeds {specs.ML10X_PRESET_NAME_MAX} characters (limit unverified; 12 bytes on the wire per one source).",
                subject_type="preset",
                subject_id=subj,
            )
        )
    loops_used: list[int] = []
    if preset.mode == "advanced":
        if not preset.advanced_edges:
            diags.append(
                Diagnostic(
                    code="ml10x.advanced_empty",
                    severity=Severity.WARNING,
                    message=f"ML10X preset {preset.number} is Advanced but has no routing edges.",
                    subject_type="preset",
                    subject_id=subj,
                )
            )
        nodes: set[str] = set()
        for edge in preset.advanced_edges:
            if len(edge) != 2:
                diags.append(
                    Diagnostic(
                        code="ml10x.advanced_edge_malformed",
                        severity=Severity.ERROR,
                        message=f"ML10X preset {preset.number}: edge {edge} must be [from, to].",
                        subject_type="preset",
                        subject_id=subj,
                    )
                )
                continue
            nodes.update(edge)
        for n in nodes:
            if n.startswith("L") and n[1:].isdigit():
                loops_used.append(int(n[1:]))
            elif n not in ("IN", "OUT", "IN_TIP", "IN_RING", "OUT_TIP", "OUT_RING"):
                diags.append(
                    Diagnostic(
                        code="ml10x.advanced_node_unknown",
                        severity=Severity.ERROR,
                        message=f"ML10X preset {preset.number}: unknown node '{n}'. Use IN, OUT, IN_TIP, IN_RING, OUT_TIP, OUT_RING or L1-L10.",
                        subject_type="preset",
                        subject_id=subj,
                    )
                )
        diags.append(
            Diagnostic(
                code="ml10x.advanced_mode_note",
                severity=Severity.INFO,
                message="Advanced presets can only be authored in the Morningstar web editor (the device itself only programs Simple presets). "
                + gate.note,
                subject_type="preset",
                subject_id=subj,
            )
        )
    else:
        loops_used = list(preset.chain)
        if len(set(loops_used)) != len(loops_used):
            diags.append(
                Diagnostic(
                    code="ml10x.chain_duplicate",
                    severity=Severity.ERROR,
                    message=f"ML10X preset {preset.number} lists a loop twice in its chain.",
                    subject_type="preset",
                    subject_id=subj,
                )
            )
    if preset.mode == "advanced":
        from .paths import advanced_cabling_diagnostics  # local import: paths depends on this module

        diags.extend(advanced_cabling_diagnostics(topo, preset))
        for n in loops_used:
            if n < 1 or n > 10:
                diags.append(
                    Diagnostic(
                        code="ml10x.loop_out_of_range",
                        severity=Severity.ERROR,
                        message=f"ML10X preset {preset.number} references loop {n}; loops are 1-10 (A Tip .. E Ring).",
                        subject_type="preset",
                        subject_id=subj,
                    )
                )
        return diags
    for n in loops_used:
        if n < 1 or n > 10:
            diags.append(
                Diagnostic(
                    code="ml10x.loop_out_of_range",
                    severity=Severity.ERROR,
                    message=f"ML10X preset {preset.number} references loop {n}; loops are 1-10 (A Tip .. E Ring).",
                    subject_type="preset",
                    subject_id=subj,
                )
            )
            continue
        lp = topo.loop(n)
        if lp is None:
            continue
        if not lp.complete:
            what = (
                "nothing is cabled"
                if not lp.occupied
                else ("Return is not cabled" if lp.send_to_instance_id else "Send is not cabled")
            )
            diags.append(
                Diagnostic(
                    code="ml10x.preset_loop_not_cabled",
                    severity=Severity.ERROR,
                    message=f"ML10X preset {preset.number} '{preset.name}' routes through loop {n} ({lp.name}) but {what}. A preset cannot fix a missing cable.",
                    subject_type="preset",
                    subject_id=subj,
                    related_ids=[topo.instance_id],
                )
            )
    return diags
