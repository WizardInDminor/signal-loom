"""Typed physical wiring validation and audio/MIDI topology diagnostics.

Four distinct networks (audio, MIDI, expression, power) with their own rules. A cable is a
physical fact; a route *through* a switcher preset is virtual and handled in ``ml10x``.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from ..models.common import (
    AudioChannel,
    Connector,
    DeviceCategory,
    Diagnostic,
    MidiTrsType,
    Polarity,
    PortDirection,
    Severity,
    SignalKind,
)
from ..models.profile import DeviceProfile, PortDef
from ..models.rig import Connection, DeviceInstance, Rig
from .geometry import effective_ports


@dataclass
class ResolvedEnd:
    instance: DeviceInstance
    profile: DeviceProfile | None
    port: PortDef


@dataclass
class ResolvedConnection:
    connection: Connection
    source: ResolvedEnd
    target: ResolvedEnd


@dataclass
class WiringContext:
    rig: Rig
    profiles: dict[str, DeviceProfile]
    instances: dict[str, DeviceInstance] = field(default_factory=dict)
    ports: dict[str, dict[str, PortDef]] = field(default_factory=dict)  # instance_id -> port_id -> port
    resolved: list[ResolvedConnection] = field(default_factory=list)
    diagnostics: list[Diagnostic] = field(default_factory=list)

    def profile_of(self, inst: DeviceInstance) -> DeviceProfile | None:
        return self.profiles.get(inst.profile_id)

    def category_of(self, inst: DeviceInstance) -> DeviceCategory:
        p = self.profile_of(inst)
        return p.category if p else DeviceCategory.OTHER


def build_context(rig: Rig, profiles: dict[str, DeviceProfile]) -> WiringContext:
    ctx = WiringContext(rig=rig, profiles=profiles)
    for inst in rig.instances:
        ctx.instances[inst.id] = inst
        ctx.ports[inst.id] = {p.id: p for p in effective_ports(inst, profiles.get(inst.profile_id))}
    return ctx


def _diag(
    ctx: WiringContext, code: str, sev: Severity, msg: str, subject_type="connection", subject_id=None, related=None
):
    ctx.diagnostics.append(
        Diagnostic(
            code=code,
            severity=sev,
            message=msg,
            subject_type=subject_type,
            subject_id=subject_id,
            related_ids=related or [],
        )
    )


def _resolve_end(ctx: WiringContext, conn: Connection, which: str) -> ResolvedEnd | None:
    ref = conn.source if which == "source" else conn.target
    inst = ctx.instances.get(ref.instance_id)
    if inst is None:
        _diag(
            ctx,
            "connection.instance_missing",
            Severity.ERROR,
            f"Cable '{conn.label or conn.id}' {which} refers to a device that is not on this rig.",
            subject_id=conn.id,
        )
        return None
    port = ctx.ports.get(inst.id, {}).get(ref.port_id)
    if port is None:
        _diag(
            ctx,
            "connection.port_missing",
            Severity.ERROR,
            f"Cable '{conn.label or conn.id}' {which} refers to port '{ref.port_id}' which does not exist on '{inst.label}'.",
            subject_id=conn.id,
            related=[inst.id],
        )
        return None
    return ResolvedEnd(instance=inst, profile=ctx.profile_of(inst), port=port)


def validate_connections(ctx: WiringContext) -> None:
    """Per-cable rules: existence, signal domain, direction, exclusivity, channel/connector sanity."""
    seen_pairs: set[tuple[str, str, str, str]] = set()
    inbound: dict[str, list[Connection]] = defaultdict(list)
    outbound: dict[str, list[Connection]] = defaultdict(list)
    for conn in ctx.rig.connections:
        src = _resolve_end(ctx, conn, "source")
        tgt = _resolve_end(ctx, conn, "target")
        if src is None or tgt is None:
            continue
        label = conn.label or f"{src.instance.label}:{src.port.label} -> {tgt.instance.label}:{tgt.port.label}"
        if conn.source.key() == conn.target.key():
            _diag(
                ctx,
                "connection.self_loop",
                Severity.ERROR,
                f"Cable '{label}' connects a port to itself.",
                subject_id=conn.id,
            )
            continue
        key = (conn.source.instance_id, conn.source.port_id, conn.target.instance_id, conn.target.port_id)
        if key in seen_pairs:
            _diag(
                ctx, "connection.duplicate", Severity.WARNING, f"Cable '{label}' is defined twice.", subject_id=conn.id
            )
        seen_pairs.add(key)
        # Signal domain
        if src.port.kind != tgt.port.kind:
            _diag(
                ctx,
                "connection.kind_mismatch",
                Severity.ERROR,
                f"Cable '{label}' joins a {src.port.kind.value} port to a {tgt.port.kind.value} port. Different signal domains cannot be cabled together.",
                subject_id=conn.id,
            )
            continue
        if conn.kind != src.port.kind:
            _diag(
                ctx,
                "connection.kind_label_mismatch",
                Severity.ERROR,
                f"Cable '{label}' is typed {conn.kind.value} but both ports are {src.port.kind.value}.",
                subject_id=conn.id,
            )
            continue
        # Direction
        if src.port.direction == PortDirection.IN:
            _diag(
                ctx,
                "connection.direction",
                Severity.ERROR,
                f"Cable '{label}' starts at '{src.port.label}', which is an input. Cables run from an output to an input.",
                subject_id=conn.id,
            )
            continue
        if tgt.port.direction == PortDirection.OUT:
            _diag(
                ctx,
                "connection.direction",
                Severity.ERROR,
                f"Cable '{label}' ends at '{tgt.port.label}', which is an output. Cables run from an output to an input.",
                subject_id=conn.id,
            )
            continue
        inbound[conn.target.key()].append(conn)
        outbound[conn.source.key()].append(conn)
        ctx.resolved.append(ResolvedConnection(connection=conn, source=src, target=tgt))
        _validate_pair_details(ctx, conn, src, tgt, label)
    # Exclusive inputs: one cable per input jack.
    for key, conns in inbound.items():
        if len(conns) <= 1:
            continue
        inst_id, port_id = key.split(":", 1)
        port = ctx.ports[inst_id][port_id]
        inst = ctx.instances[inst_id]
        if port.is_exclusive():
            _diag(
                ctx,
                "connection.input_shared",
                Severity.ERROR,
                f"{len(conns)} cables feed '{inst.label}:{port.label}'. A jack accepts one plug; use a mixer/switcher or remove one cable.",
                subject_id=conns[0].id,
                related=[c.id for c in conns[1:]],
            )
    for key, conns in outbound.items():
        if len(conns) <= 1:
            continue
        inst_id, port_id = key.split(":", 1)
        port = ctx.ports[inst_id][port_id]
        inst = ctx.instances[inst_id]
        if port.kind == SignalKind.AUDIO and not any(c.intentional for c in conns):
            _diag(
                ctx,
                "connection.output_split",
                Severity.WARNING,
                f"'{inst.label}:{port.label}' feeds {len(conns)} cables. A passive split needs a Y-cable or buffer; mark it intentional if planned.",
                subject_id=conns[0].id,
                related=[c.id for c in conns[1:]],
            )
        elif (
            port.kind == SignalKind.POWER
            and port.direction == PortDirection.OUT
            and not any(c.intentional for c in conns)
        ):
            _diag(
                ctx,
                "connection.power_daisy_chain",
                Severity.WARNING,
                f"Power outlet '{inst.label}:{port.label}' feeds {len(conns)} devices (daisy chain). Check the outlet's current rating and isolation.",
                subject_id=conns[0].id,
                related=[c.id for c in conns[1:]],
            )


def _validate_pair_details(
    ctx: WiringContext, conn: Connection, src: ResolvedEnd, tgt: ResolvedEnd, label: str
) -> None:
    kind = src.port.kind
    sev_soft = Severity.INFO if conn.intentional else Severity.WARNING
    if kind == SignalKind.AUDIO:
        sc, tc = src.port.audio_channel, tgt.port.audio_channel
        if sc == AudioChannel.STEREO_TRS and tc in (AudioChannel.MONO, AudioChannel.LEFT, AudioChannel.RIGHT):
            _diag(
                ctx,
                "audio.stereo_into_mono",
                sev_soft,
                f"Cable '{label}': a TRS stereo output feeds a mono jack; the ring channel is lost or shorted. Use a TRS-to-dual-TS splitter.",
                subject_id=conn.id,
            )
        elif tc == AudioChannel.STEREO_TRS and sc in (AudioChannel.MONO, AudioChannel.LEFT, AudioChannel.RIGHT):
            _diag(
                ctx,
                "audio.mono_into_stereo_trs",
                sev_soft,
                f"Cable '{label}': a mono output feeds a TRS stereo input; only one side will carry signal unless the device sums TS plugs.",
                subject_id=conn.id,
            )
        elif (
            sc == AudioChannel.LEFT and tc == AudioChannel.RIGHT or sc == AudioChannel.RIGHT and tc == AudioChannel.LEFT
        ):
            _diag(
                ctx,
                "audio.channels_crossed",
                Severity.INFO,
                f"Cable '{label}' connects {sc.value} to {tc.value}. Fine if deliberate (channel swap).",
                subject_id=conn.id,
            )
        if (sc is None or sc == AudioChannel.UNKNOWN) or (tc is None or tc == AudioChannel.UNKNOWN):
            _diag(
                ctx,
                "audio.channel_unknown",
                Severity.INFO,
                f"Cable '{label}': mono/stereo behaviour of one jack is not documented; verify against the manual.",
                subject_id=conn.id,
            )
    elif kind == SignalKind.MIDI:
        st, tt = src.port.midi_trs_type, tgt.port.midi_trs_type
        s_trs = src.port.connector in (Connector.TRS_1_8, Connector.TRS_1_4)
        t_trs = tgt.port.connector in (Connector.TRS_1_8, Connector.TRS_1_4)
        if s_trs and t_trs:
            if st in (None, MidiTrsType.UNKNOWN) or tt in (None, MidiTrsType.UNKNOWN):
                _diag(
                    ctx,
                    "midi.trs_type_unknown",
                    Severity.WARNING,
                    f"Cable '{label}': TRS MIDI wiring (Type A/B) of one end is unknown; a wrong cable sends nothing. Verify before buying cables.",
                    subject_id=conn.id,
                )
            elif st != tt:
                _diag(
                    ctx,
                    "midi.trs_type_mismatch",
                    sev_soft,
                    f"Cable '{label}': TRS MIDI {st.value} to {tt.value}. Needs a crossover/adapter cable or a switchable output.",
                    subject_id=conn.id,
                )
        elif s_trs != t_trs:
            _diag(
                ctx,
                "midi.din_trs_adapter",
                Severity.INFO,
                f"Cable '{label}': DIN to TRS MIDI needs an adapter cable of the right TRS type.",
                subject_id=conn.id,
            )
    elif kind == SignalKind.POWER:
        _validate_power(ctx, conn, src, tgt, label)


def _validate_power(ctx: WiringContext, conn: Connection, src: ResolvedEnd, tgt: ResolvedEnd, label: str) -> None:
    need = tgt.profile.power if tgt.profile else None
    sv = src.port.supply_voltage_v
    sp = src.port.supply_polarity
    smax = src.port.supply_current_ma_max
    if need is None or need.voltage_v is None:
        _diag(
            ctx,
            "power.requirement_unknown",
            Severity.WARNING,
            f"'{tgt.instance.label}' has no documented voltage requirement; cannot confirm outlet '{src.port.label}' is safe.",
            subject_id=conn.id,
            related=[tgt.instance.id],
        )
    elif sv is None:
        _diag(
            ctx,
            "power.supply_unknown",
            Severity.WARNING,
            f"Outlet '{src.instance.label}:{src.port.label}' has no documented voltage; cannot confirm it matches {need.voltage_v:g} V for '{tgt.instance.label}'.",
            subject_id=conn.id,
        )
    elif abs(sv - need.voltage_v) > 0.01:
        _diag(
            ctx,
            "power.voltage_mismatch",
            Severity.ERROR,
            f"Outlet '{src.port.label}' supplies {sv:g} V but '{tgt.instance.label}' requires {need.voltage_v:g} V.",
            subject_id=conn.id,
            related=[tgt.instance.id],
        )
    if need is not None and need.voltage_v is not None:
        if need.polarity == Polarity.UNKNOWN or sp in (None, Polarity.UNKNOWN):
            _diag(
                ctx,
                "power.polarity_unknown",
                Severity.WARNING,
                f"Polarity of '{tgt.instance.label}' or outlet '{src.port.label}' is unknown; verify centre-negative/positive before plugging in.",
                subject_id=conn.id,
            )
        elif sp != need.polarity:
            _diag(
                ctx,
                "power.polarity_mismatch",
                Severity.ERROR,
                f"Outlet '{src.port.label}' is {sp.value.replace('_', ' ')} but '{tgt.instance.label}' needs {need.polarity.value.replace('_', ' ')}.",
                subject_id=conn.id,
                related=[tgt.instance.id],
            )
        if need.current_ma_min is None:
            _diag(
                ctx,
                "power.current_unknown",
                Severity.WARNING,
                f"Current draw of '{tgt.instance.label}' is unknown; cannot confirm outlet '{src.port.label}' can supply it.",
                subject_id=conn.id,
            )
        elif smax is None:
            _diag(
                ctx,
                "power.outlet_current_unknown",
                Severity.WARNING,
                f"Outlet '{src.port.label}' has no documented current rating; '{tgt.instance.label}' needs at least {need.current_ma_min} mA.",
                subject_id=conn.id,
            )
        elif smax < need.current_ma_min:
            _diag(
                ctx,
                "power.current_insufficient",
                Severity.ERROR,
                f"Outlet '{src.port.label}' supplies {smax} mA but '{tgt.instance.label}' needs at least {need.current_ma_min} mA.",
                subject_id=conn.id,
                related=[tgt.instance.id],
            )


# -- audio topology ---------------------------------------------------------------------


def _audio_node(ctx: WiringContext, inst: DeviceInstance, port: PortDef) -> str:
    """Map a port to a graph node. Switchers are split into an input side and an output side
    so that send -> pedal -> return is a path, not a cycle."""
    if ctx.category_of(inst) == DeviceCategory.SWITCHER:
        if (
            port.role == "loop_send"
            or port.role == "main_in"
            or (port.direction == PortDirection.IN and port.role != "loop_return")
        ):
            return f"{inst.id}#in_side"
        return f"{inst.id}#out_side"
    return inst.id


def audio_graph(ctx: WiringContext) -> dict[str, set[str]]:
    g: dict[str, set[str]] = defaultdict(set)
    for inst in ctx.instances.values():
        if ctx.category_of(inst) == DeviceCategory.SWITCHER:
            g[f"{inst.id}#in_side"].add(f"{inst.id}#out_side")  # a bypassed-all preset
            g[f"{inst.id}#out_side"]
        else:
            g[inst.id]
    for rc in ctx.resolved:
        if rc.connection.kind != SignalKind.AUDIO:
            continue
        a = _audio_node(ctx, rc.source.instance, rc.source.port)
        b = _audio_node(ctx, rc.target.instance, rc.target.port)
        g[a].add(b)
    return g


def find_cycle(g: dict[str, set[str]]) -> list[str] | None:
    WHITE, GREY, BLACK = 0, 1, 2
    color: dict[str, int] = dict.fromkeys(g, WHITE)
    stack: list[str] = []

    def dfs(u: str) -> list[str] | None:
        color[u] = GREY
        stack.append(u)
        for v in g.get(u, ()):
            if color.get(v, WHITE) == GREY:
                return stack[stack.index(v) :] + [v]
            if color.get(v, WHITE) == WHITE:
                r = dfs(v)
                if r:
                    return r
        stack.pop()
        color[u] = BLACK
        return None

    for n in list(g):
        if color[n] == WHITE:
            r = dfs(n)
            if r:
                return r
    return None


def reachable(g: dict[str, set[str]], start: str) -> set[str]:
    seen = {start}
    todo = [start]
    while todo:
        u = todo.pop()
        for v in g.get(u, ()):
            if v not in seen:
                seen.add(v)
                todo.append(v)
    return seen


def topology_diagnostics(ctx: WiringContext) -> None:
    g = audio_graph(ctx)
    cyc = find_cycle(g)
    if cyc:
        labels = [ctx.instances[n.split("#")[0]].label for n in cyc]
        _diag(
            ctx,
            "audio.cycle",
            Severity.ERROR,
            "Audio feedback loop: "
            + " -> ".join(labels)
            + ". Break the loop unless it is a deliberate feedback patch (mark a cable intentional).",
            subject_type="rig",
        )
    audio_in: dict[str, list[ResolvedConnection]] = defaultdict(list)
    audio_out: dict[str, list[ResolvedConnection]] = defaultdict(list)
    for rc in ctx.resolved:
        if rc.connection.kind == SignalKind.AUDIO:
            audio_in[rc.target.instance.id].append(rc)
            audio_out[rc.source.instance.id].append(rc)
    instruments = [i for i in ctx.instances.values() if ctx.category_of(i) == DeviceCategory.INSTRUMENT]
    amps = [i for i in ctx.instances.values() if ctx.category_of(i) == DeviceCategory.AMP]
    for inst in ctx.instances.values():
        cat = ctx.category_of(inst)
        ports = ctx.ports[inst.id].values()
        has_audio_in = any(p.kind == SignalKind.AUDIO and p.direction == PortDirection.IN for p in ports)
        has_audio_out = any(p.kind == SignalKind.AUDIO and p.direction == PortDirection.OUT for p in ports)
        if cat == DeviceCategory.SWITCHER:
            _switcher_loop_diagnostics(ctx, inst)
            continue
        if cat in (DeviceCategory.POWER_SUPPLY, DeviceCategory.CONTROLLER):
            continue
        if has_audio_in and has_audio_out and cat not in (DeviceCategory.INSTRUMENT, DeviceCategory.AMP):
            if audio_in[inst.id] and not audio_out[inst.id]:
                _diag(
                    ctx,
                    "audio.dead_end",
                    Severity.WARNING,
                    f"'{inst.label}' receives audio but its output goes nowhere.",
                    subject_type="instance",
                    subject_id=inst.id,
                )
            elif audio_out[inst.id] and not audio_in[inst.id]:
                _diag(
                    ctx,
                    "audio.no_source",
                    Severity.WARNING,
                    f"'{inst.label}' sends audio but nothing feeds its input.",
                    subject_type="instance",
                    subject_id=inst.id,
                )
            elif not audio_in[inst.id] and not audio_out[inst.id]:
                _diag(
                    ctx,
                    "audio.unconnected",
                    Severity.INFO,
                    f"'{inst.label}' is not in the audio chain.",
                    subject_type="instance",
                    subject_id=inst.id,
                )
    for a in amps:
        if not audio_in[a.id]:
            _diag(
                ctx,
                "audio.amp_no_input",
                Severity.WARNING,
                f"Amp '{a.label}' has no audio input connected.",
                subject_type="instance",
                subject_id=a.id,
            )
    for s in instruments:
        if not audio_out[s.id]:
            _diag(
                ctx,
                "audio.instrument_no_output",
                Severity.WARNING,
                f"'{s.label}' output is not connected.",
                subject_type="instance",
                subject_id=s.id,
            )
    if instruments and amps:
        for s in instruments:
            reach = reachable(g, s.id)
            ok = [a for a in amps if a.id in reach]
            if not ok:
                _diag(
                    ctx,
                    "audio.path_broken",
                    Severity.ERROR,
                    f"No complete physical audio path from '{s.label}' to any amp. Check each cable in the chain.",
                    subject_type="instance",
                    subject_id=s.id,
                    related=[a.id for a in amps],
                )


def _switcher_loop_diagnostics(ctx: WiringContext, sw: DeviceInstance) -> None:
    ports = ctx.ports[sw.id]
    g = audio_graph(ctx)
    connected: dict[str, list[ResolvedConnection]] = defaultdict(list)
    for rc in ctx.resolved:
        if rc.connection.kind != SignalKind.AUDIO:
            continue
        if rc.source.instance.id == sw.id:
            connected[rc.source.port.id].append(rc)
        if rc.target.instance.id == sw.id:
            connected[rc.target.port.id].append(rc)
    sends = {p.loop: p for p in ports.values() if p.role == "loop_send" and p.loop is not None}
    returns = {p.loop: p for p in ports.values() if p.role == "loop_return" and p.loop is not None}
    for loop in sorted(set(sends) | set(returns)):
        s, r = sends.get(loop), returns.get(loop)
        s_conn = connected.get(s.id) if s else None
        r_conn = connected.get(r.id) if r else None
        if s_conn and not r_conn:
            _diag(
                ctx,
                "switcher.loop_open",
                Severity.ERROR,
                f"'{sw.label}' loop {loop}: Send is cabled but Return is not. Engaging this loop in any preset breaks the signal path.",
                subject_type="port",
                subject_id=f"{sw.id}:{r.id if r else ''}",
                related=[sw.id],
            )
        elif r_conn and not s_conn:
            # Documented ML10X pattern: mono send / stereo return uses the sibling conductor's
            # Return only. It needs an Advanced preset that treats the loop as return-only; a
            # Simple chain through this loop is flagged by the preset check instead.
            _diag(
                ctx,
                "switcher.loop_return_only",
                Severity.INFO,
                f"'{sw.label}' loop {loop}: only the Return is cabled (return-only loop). Valid for a stereo return in an Advanced preset; a Simple chain through loop {loop} would break.",
                subject_type="port",
                subject_id=f"{sw.id}:{s.id if s else ''}",
                related=[sw.id],
            )
        elif s_conn and r_conn:
            # Send must reach Return through pedals (not via the switcher's own core).
            sub = {k: set(v) for k, v in g.items()}
            sub.pop(f"{sw.id}#in_side", None)
            start_nodes = {rc.target.instance.id for rc in s_conn}
            reach: set[str] = set()
            for n in start_nodes:
                reach |= reachable(sub, n)
            src_of_return = {rc.source.instance.id for rc in r_conn}
            if not (reach & src_of_return):
                _diag(
                    ctx,
                    "switcher.loop_path_broken",
                    Severity.ERROR,
                    f"'{sw.label}' loop {loop}: the devices between Send {loop} and Return {loop} are not fully cabled.",
                    subject_type="port",
                    subject_id=f"{sw.id}:{s.id}",
                    related=[sw.id],
                )
    main_in = [p for p in ports.values() if p.role == "main_in"]
    main_out = [p for p in ports.values() if p.role == "main_out"]
    if main_in and not any(connected.get(p.id) for p in main_in):
        _diag(
            ctx,
            "switcher.no_input",
            Severity.WARNING,
            f"'{sw.label}' has nothing cabled into its input.",
            subject_type="instance",
            subject_id=sw.id,
        )
    if main_out and not any(connected.get(p.id) for p in main_out):
        _diag(
            ctx,
            "switcher.no_output",
            Severity.WARNING,
            f"'{sw.label}' output is not cabled anywhere.",
            subject_type="instance",
            subject_id=sw.id,
        )


def power_diagnostics(ctx: WiringContext) -> None:
    powered: set[str] = set()
    for rc in ctx.resolved:
        if rc.connection.kind == SignalKind.POWER:
            powered.add(rc.target.instance.id)
    for inst in ctx.instances.values():
        ports = ctx.ports[inst.id].values()
        needs_power = any(p.kind == SignalKind.POWER and p.direction == PortDirection.IN for p in ports)
        prof = ctx.profile_of(inst)
        if needs_power and inst.id not in powered:
            req = ""
            if prof and prof.power.voltage_v is not None:
                req = f" (needs {prof.power.voltage_v:g} V"
                req += f", {prof.power.current_ma_min} mA+)" if prof.power.current_ma_min else ")"
            _diag(
                ctx,
                "power.unpowered",
                Severity.WARNING,
                f"'{inst.label}' has no power cable{req}.",
                subject_type="instance",
                subject_id=inst.id,
            )


def midi_reachability(ctx: WiringContext, controller_id: str) -> set[str]:
    """Instances that receive MIDI from the controller via cables (MIDI Thru passes through)."""
    g: dict[str, set[str]] = defaultdict(set)
    for rc in ctx.resolved:
        if rc.connection.kind != SignalKind.MIDI:
            continue
        g[rc.source.instance.id].add(rc.target.instance.id)
    reach = reachable(g, controller_id)
    reach.discard(controller_id)
    return reach


def wiring_diagnostics(rig: Rig, profiles: dict[str, DeviceProfile]) -> tuple[WiringContext, list[Diagnostic]]:
    ctx = build_context(rig, profiles)
    validate_connections(ctx)
    topology_diagnostics(ctx)
    power_diagnostics(ctx)
    return ctx, ctx.diagnostics
