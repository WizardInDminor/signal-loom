"""Route graph and coverage: from the computer, through a bound endpoint, into a device, and on
along the rig's MIDI cables through documented forwarding (Cross MIDI Thru, hardware Thru, …).

Each hop carries per-kind capabilities with evidence and prerequisites; a device's coverage for a
message kind is the weakest link of the best path. *Unknown never shows as reachable*: it is
reported as "unverified" with the hop that is undocumented. Collision scope is one bound
endpoint's downstream receiver network, so two pedals on channel 1 behind two different USB
endpoints are independent, while two pedals on channel 1 behind one MC8 uplink are flagged
(unless the user declared the sharing deliberate).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from ..domain.geometry import effective_ports
from ..domain.wiring import WiringContext
from ..models.common import DeviceCategory, Diagnostic, PortDirection, Severity, SignalKind
from ..models.live import MESSAGE_KINDS, CapabilityStatus, LiveBindings, MessageKind, RouteEvidence
from ..models.profile import DeviceProfile, PortDef
from ..models.rig import DeviceInstance, Rig
from ..vendors import Capability, Caps, entry_capabilities, forwardings, reception_capabilities
from .transport import EndpointInfo

COMPUTER = "computer"
_EVIDENCE_RANK: dict[RouteEvidence, int] = {
    "unknown": 0,
    "published": 1,
    "simulation_tested": 2,
    "hardware_verified": 3,
}
_STATUS_RANK: dict[CapabilityStatus, int] = {"unsupported": 0, "unknown": 1, "supported": 2}


@dataclass
class Hop:
    key: str
    from_node: str
    from_label: str
    from_port_id: str | None
    to_node: str
    to_label: str
    to_port_id: str | None
    medium: str  # usb | din | trs | internal
    connection_id: str | None
    caps: Caps
    note: str | None = None

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "from": {"node": self.from_node, "label": self.from_label, "port_id": self.from_port_id},
            "to": {"node": self.to_node, "label": self.to_label, "port_id": self.to_port_id},
            "medium": self.medium,
            "connection_id": self.connection_id,
            "capabilities": {k: v.as_dict() for k, v in self.caps.items()},
            "note": self.note,
        }


@dataclass
class KindCoverage:
    status: str  # supported | unverified | unsupported | unreachable
    evidence: RouteEvidence | None
    reason: str
    prerequisites: list[str] = field(default_factory=list)
    blocking_hop: str | None = None

    def as_dict(self) -> dict:
        return {
            "status": self.status,
            "evidence": self.evidence,
            "reason": self.reason,
            "prerequisites": self.prerequisites,
            "blocking_hop": self.blocking_hop,
        }


@dataclass
class Route:
    endpoint_id: str
    hops: list[Hop]
    coverage: dict[MessageKind, KindCoverage]

    def as_dict(self) -> dict:
        return {
            "endpoint_id": self.endpoint_id,
            "hops": [h.as_dict() for h in self.hops],
            "coverage": {k: v.as_dict() for k, v in self.coverage.items()},
        }


@dataclass
class Target:
    """One device as the live layer sees it: its channel, the best route per kind, alternatives."""

    instance_id: str
    label: str
    profile_id: str
    category: str
    channel: int | None
    has_midi: bool
    routes: list[Route]
    best: dict[MessageKind, int | None]  # index into routes, per kind
    suggestions: list[str]

    def route_for(self, kind: MessageKind) -> Route | None:
        i = self.best.get(kind)
        return self.routes[i] if i is not None else None

    def coverage(self, kind: MessageKind) -> KindCoverage:
        r = self.route_for(kind)
        if r is None:
            return KindCoverage("unreachable", None, "No bound endpoint reaches this device.", [], None)
        return r.coverage[kind]

    def as_dict(self) -> dict:
        return {
            "instance_id": self.instance_id,
            "label": self.label,
            "profile_id": self.profile_id,
            "category": self.category,
            "channel": self.channel,
            "has_midi": self.has_midi,
            "routes": [r.as_dict() for r in self.routes],
            "best": self.best,
            "coverage": {k: self.coverage(k).as_dict() for k in MESSAGE_KINDS},
            "suggestions": self.suggestions,
        }


@dataclass
class ReceiverNetwork:
    endpoint_id: str
    endpoint_name: str
    members: list[dict]  # {instance_id, label, channel, kinds: [kinds not unsupported]}
    collisions: list[Diagnostic]

    def as_dict(self) -> dict:
        return {
            "endpoint_id": self.endpoint_id,
            "endpoint_name": self.endpoint_name,
            "members": self.members,
            "collisions": [d.model_dump(mode="json") for d in self.collisions],
        }


@dataclass
class RouteGraph:
    targets: dict[str, Target]
    networks: list[ReceiverNetwork]
    diagnostics: list[Diagnostic]
    endpoints: dict[str, EndpointInfo]

    def coverage_rows(self) -> list[dict]:
        rows = []
        for t in self.targets.values():
            for kind in MESSAGE_KINDS:
                cov = t.coverage(kind)
                route = t.route_for(kind)
                ep = self.endpoints.get(route.endpoint_id) if route else None
                rows.append(
                    {
                        "instance_id": t.instance_id,
                        "label": t.label,
                        "kind": kind,
                        "channel": t.channel,
                        "endpoint_id": route.endpoint_id if route else None,
                        "endpoint_name": ep.name if ep else None,
                        "hops": [
                            f"{h.from_label}{':' + h.from_port_id if h.from_port_id else ''} → {h.to_label}{':' + h.to_port_id if h.to_port_id else ''}"
                            for h in route.hops
                        ]
                        if route
                        else [],
                        "hop_keys": [h.key for h in route.hops] if route else [],
                        "status": cov.status,
                        "evidence": cov.evidence,
                        "reason": cov.reason,
                        "prerequisites": cov.prerequisites,
                        "suggestions": t.suggestions if cov.status == "unreachable" else [],
                    }
                )
        return rows

    def as_dict(self) -> dict:
        return {
            "targets": {k: v.as_dict() for k, v in self.targets.items()},
            "networks": [n.as_dict() for n in self.networks],
            "rows": self.coverage_rows(),
            "diagnostics": [d.model_dump(mode="json") for d in self.diagnostics],
        }


def _channel(inst: DeviceInstance, prof: DeviceProfile | None) -> int | None:
    if inst.midi_channel is not None:
        return inst.midi_channel
    return prof.midi.default_channel if prof else None


def _medium(port: PortDef) -> str:
    if port.kind == SignalKind.USB:
        return "usb"
    if port.connector.value == "din5":
        return "din"
    return "trs"


def _combine(hops: list[Hop], kind: MessageKind, verified: dict[str, str]) -> KindCoverage:
    worst_status: CapabilityStatus = "supported"
    evidence: RouteEvidence = "hardware_verified"
    reason = "Every hop documents this message kind."
    prereqs: list[str] = []
    blocking: str | None = None
    blocking_evidence: RouteEvidence = "unknown"
    for h in hops:
        c = h.caps[kind]
        ev: RouteEvidence = "hardware_verified" if h.key in verified else c.evidence
        for p in c.prerequisites:
            if p not in prereqs:
                prereqs.append(p)
        if _STATUS_RANK[c.status] < _STATUS_RANK[worst_status]:
            worst_status = c.status
            reason = c.reason
            blocking = h.key
            blocking_evidence = ev
        if _EVIDENCE_RANK[ev] < _EVIDENCE_RANK[evidence]:
            evidence = ev
    if worst_status == "unsupported":
        return KindCoverage("unsupported", blocking_evidence, reason, prereqs, blocking)
    if worst_status == "unknown":
        return KindCoverage("unverified", "unknown", reason, prereqs, blocking)
    return KindCoverage("supported", evidence, reason, prereqs, None)


def build_route_graph(
    rig: Rig,
    profiles: dict[str, DeviceProfile],
    ctx: WiringContext,
    bindings: LiveBindings,
    endpoints: list[EndpointInfo],
    inactive_output_endpoints: dict[str, str] | None = None,
) -> RouteGraph:
    """Build potential routes; a connected rig may mark bound outputs as non-transmitting.

    An enumerated port is not necessarily open. Inactive output bindings remain stored,
    but cannot compete with usable routes or appear as executable coverage.
    """
    inactive = inactive_output_endpoints or {}
    diags: list[Diagnostic] = []
    ep_by_id = {e.id: e for e in endpoints}
    ports_of: dict[str, list[PortDef]] = {}
    for inst in rig.instances:
        ports_of[inst.id] = effective_ports(inst, profiles.get(inst.profile_id))
    labels = {i.id: i.label for i in rig.instances}

    # MIDI cables by (instance, out port) -> list of (target instance, target port, connection id)
    cables: dict[tuple[str, str], list[tuple[str, str, str]]] = defaultdict(list)
    for rc in ctx.resolved:
        if rc.connection.kind != SignalKind.MIDI:
            continue
        cables[(rc.source.instance.id, rc.source.port.id)].append(
            (rc.target.instance.id, rc.target.port.id, rc.connection.id)
        )

    routes_by_target: dict[str, list[Route]] = defaultdict(list)
    network_members: dict[str, dict[str, set[MessageKind]]] = defaultdict(lambda: defaultdict(set))

    def walk(endpoint_id: str, inst_id: str, in_port_id: str, hops: list[Hop], seen: set[str]) -> None:
        inst = rig.instance(inst_id)
        prof = profiles.get(inst.profile_id) if inst else None
        if inst is None or prof is None:
            return
        ports = ports_of[inst_id]
        in_port = next((p for p in ports if p.id == in_port_id), None)
        if in_port is None:
            return
        # The device itself receives here.
        recv = reception_capabilities(prof, in_port) if hops else entry_capabilities(prof, in_port)
        if recv is None:
            recv = reception_capabilities(prof, in_port)
        recv_hop = Hop(
            key=f"{inst_id}:{in_port_id}:receive",
            from_node=inst_id,
            from_label=inst.label,
            from_port_id=in_port_id,
            to_node=inst_id,
            to_label=inst.label,
            to_port_id=None,
            medium="internal",
            connection_id=None,
            caps=recv,
            note=f"{inst.label} receives on {in_port.label}",
        )
        full = [*hops, recv_hop]
        cov = {k: _combine(full, k, bindings.verified_hops) for k in MESSAGE_KINDS}
        routes_by_target[inst_id].append(Route(endpoint_id, full, cov))
        for k in MESSAGE_KINDS:
            if cov[k].status != "unsupported":
                network_members[endpoint_id][inst_id].add(k)
        # Forwarding to the device's outputs, then along cables.
        for fwd in forwardings(prof, ports, in_port_id):
            out_port = next((p for p in ports if p.id == fwd.out_port_id), None)
            if out_port is None:
                continue
            fwd_hop = Hop(
                key=f"{inst_id}:{in_port_id}->{fwd.out_port_id}",
                from_node=inst_id,
                from_label=inst.label,
                from_port_id=in_port_id,
                to_node=inst_id,
                to_label=inst.label,
                to_port_id=fwd.out_port_id,
                medium="internal",
                connection_id=None,
                caps=fwd.caps,
                note=fwd.note,
            )
            for nxt_id, nxt_port, conn_id in cables.get((inst_id, fwd.out_port_id), []):
                if nxt_id in seen:
                    continue
                nxt_ports = ports_of.get(nxt_id, [])
                nxt_port_def = next((p for p in nxt_ports if p.id == nxt_port), None)
                trs_note = None
                cable_caps: Caps
                if out_port.connector.value != "din5" and (
                    out_port.midi_trs_type is None
                    or out_port.midi_trs_type.value in ("unknown", "proprietary")
                    or (
                        nxt_port_def is not None
                        and nxt_port_def.midi_trs_type is not None
                        and nxt_port_def.midi_trs_type.value in ("unknown",)
                    )
                ):
                    trs_note = "TRS MIDI wiring of this cable is not fully known (see the wiring diagnostics)."
                    cable_caps = {k: Capability("unknown", "unknown", trs_note) for k in MESSAGE_KINDS}
                else:
                    cable_caps = {
                        k: Capability("supported", "published", "A MIDI cable carries every message kind.")
                        for k in MESSAGE_KINDS
                    }
                cable_hop = Hop(
                    key=f"{conn_id}",
                    from_node=inst_id,
                    from_label=inst.label,
                    from_port_id=fwd.out_port_id,
                    to_node=nxt_id,
                    to_label=labels.get(nxt_id, nxt_id),
                    to_port_id=nxt_port,
                    medium=_medium(out_port),
                    connection_id=conn_id,
                    caps=cable_caps,
                    note=trs_note,
                )
                walk(endpoint_id, nxt_id, nxt_port, [*hops, fwd_hop, cable_hop], seen | {nxt_id})

    for b in bindings.bindings:
        if b.direction == "in":
            continue
        ep = ep_by_id.get(b.endpoint_id)
        inst = rig.instance(b.instance_id)
        if inst is None:
            diags.append(
                Diagnostic(
                    code="live.binding_orphaned",
                    severity=Severity.WARNING,
                    message=f"Binding '{b.endpoint_id}' refers to a device that is no longer on the rig.",
                    subject_type="rig",
                )
            )
            continue
        if ep is None:
            diags.append(
                Diagnostic(
                    code="live.endpoint_missing",
                    severity=Severity.WARNING,
                    message=f"Endpoint '{b.endpoint_id}' bound to '{inst.label}' is not present on this computer right now; its routes are unreachable until it reappears (reconnect never re-arms).",
                    subject_type="instance",
                    subject_id=inst.id,
                )
            )
            continue
        if ep.direction != "out":
            continue
        if b.endpoint_id in inactive:
            diags.append(
                Diagnostic(
                    code="live.endpoint_inactive",
                    severity=Severity.WARNING,
                    message=(
                        f"Endpoint '{ep.name}' bound to '{inst.label}' is {inactive[b.endpoint_id]}; "
                        "its saved binding remains, but it cannot be used for transmission until reopened."
                    ),
                    subject_type="instance",
                    subject_id=inst.id,
                )
            )
            continue
        port = next((p for p in ports_of.get(inst.id, []) if p.id == b.port_id), None)
        if port is None:
            diags.append(
                Diagnostic(
                    code="live.binding_port_missing",
                    severity=Severity.WARNING,
                    message=f"Binding to '{inst.label}' names jack '{b.port_id}', which the device does not have.",
                    subject_type="instance",
                    subject_id=inst.id,
                )
            )
            continue
        prof = profiles.get(inst.profile_id)
        entry = entry_capabilities(prof, port) if prof else None
        if entry is None:
            diags.append(
                Diagnostic(
                    code="live.binding_not_computer_facing",
                    severity=Severity.WARNING,
                    message=f"'{inst.label}: {port.label}' is not a jack a computer can feed (USB or a MIDI input).",
                    subject_type="instance",
                    subject_id=inst.id,
                )
            )
            continue
        usb_hop = Hop(
            key=f"{COMPUTER}->{inst.id}:{port.id}",
            from_node=COMPUTER,
            from_label=f"Computer ({ep.name})",
            from_port_id=None,
            to_node=inst.id,
            to_label=inst.label,
            to_port_id=port.id,
            medium=_medium(port),
            connection_id=None,
            caps={
                k: Capability("supported", "published", "The bound endpoint delivers bytes to this jack.")
                for k in MESSAGE_KINDS
            },
            note=f"{ep.name} → {inst.label} {port.label}"
            + (" — busy: owned by another application" if ep.busy else ""),
        )
        if ep.busy:
            diags.append(
                Diagnostic(
                    code="live.endpoint_busy",
                    severity=Severity.WARNING,
                    message=f"'{ep.name}' is owned by another application; Signal Loom cannot send through it until it is released there (or released and reacquired here).",
                    subject_type="instance",
                    subject_id=inst.id,
                )
            )
        walk(b.endpoint_id, inst.id, port.id, [usb_hop], {inst.id})

    # Targets: every device with MIDI (controllers included: the MC8 itself listens on its channel).
    targets: dict[str, Target] = {}
    mc8_id = rig.controllers.mc8.instance_id
    for inst in rig.instances:
        prof = profiles.get(inst.profile_id)
        if prof is None or prof.category in (
            DeviceCategory.INSTRUMENT,
            DeviceCategory.AMP,
            DeviceCategory.POWER_SUPPLY,
        ):
            continue
        has_midi = bool(prof.midi.interfaces) or any(p.kind == SignalKind.MIDI for p in ports_of[inst.id])
        if not has_midi:
            continue
        routes = routes_by_target.get(inst.id, [])
        best: dict[MessageKind, int | None] = {}
        for k in MESSAGE_KINDS:
            idx = None
            for i, r in enumerate(routes):
                if idx is None:
                    idx = i
                    continue
                a, b_ = r.coverage[k], routes[idx].coverage[k]
                rank = {"supported": 3, "unverified": 2, "unsupported": 1}
                if (rank[a.status], _EVIDENCE_RANK.get(a.evidence or "unknown", 0), -len(r.hops)) > (
                    rank[b_.status],
                    _EVIDENCE_RANK.get(b_.evidence or "unknown", 0),
                    -len(routes[idx].hops),
                ):
                    idx = i
            best[k] = idx
        suggestions: list[str] = []
        if not routes:
            suggestions = _suggest(rig, profiles, ports_of, inst, prof, cables, bindings, mc8_id)
        targets[inst.id] = Target(
            instance_id=inst.id,
            label=inst.label,
            profile_id=inst.profile_id,
            category=prof.category.value,
            channel=_channel(inst, prof),
            has_midi=True,
            routes=routes,
            best=best,
            suggestions=suggestions,
        )

    # Receiver networks and collisions.
    networks: list[ReceiverNetwork] = []
    declared = {(g.channel, frozenset(g.instance_ids)): g for g in bindings.channel_groups}
    for ep_id, members in network_members.items():
        ep = ep_by_id.get(ep_id)
        rows = []
        by_channel: dict[int, list[str]] = defaultdict(list)
        for inst_id, kinds in members.items():
            t = targets.get(inst_id)
            ch = t.channel if t else None
            rows.append(
                {"instance_id": inst_id, "label": labels.get(inst_id, inst_id), "channel": ch, "kinds": sorted(kinds)}
            )
            if ch is not None and ("pc" in kinds or "cc" in kinds):
                by_channel[ch].append(inst_id)
        collisions: list[Diagnostic] = []
        for ch, ids in sorted(by_channel.items()):
            if len(ids) < 2:
                continue
            group = next((g for (gch, gids), g in declared.items() if gch == ch and set(ids) <= gids), None)
            names = ", ".join(labels.get(i, i) for i in ids)
            if group:
                collisions.append(
                    Diagnostic(
                        code="live.channel_group",
                        severity=Severity.INFO,
                        message=f"Channel {ch} is deliberately shared by {names} behind '{ep.name if ep else ep_id}'{f' ({group.note})' if group.note else ''}: one message addresses them together.",
                        subject_type="rig",
                        related_ids=ids,
                    )
                )
            else:
                collisions.append(
                    Diagnostic(
                        code="live.channel_collision",
                        severity=Severity.WARNING,
                        message=f"Channel {ch} is shared by {names} on the receiver network behind '{ep.name if ep else ep_id}': a PC or CC meant for one reaches the other(s) too. Change a channel, or declare the sharing deliberate.",
                        subject_type="rig",
                        related_ids=ids,
                    )
                )
        networks.append(ReceiverNetwork(ep_id, ep.name if ep else ep_id, rows, collisions))
        diags.extend(collisions)
    return RouteGraph(targets=targets, networks=networks, diagnostics=diags, endpoints=ep_by_id)


def _suggest(rig, profiles, ports_of, inst, prof, cables, bindings, mc8_id) -> list[str]:
    """The smallest plausible, evidence-based change that would reach an unreachable device."""
    out: list[str] = []
    ports = ports_of[inst.id]
    usb = next((p for p in ports if p.kind == SignalKind.USB), None)
    if usb is not None and "usb" in prof.midi.interfaces:
        out.append(f"Bind a USB endpoint to '{inst.label}: {usb.label}' (its profile lists USB MIDI).")
    midi_ins = [p for p in ports if p.kind == SignalKind.MIDI and p.direction == PortDirection.IN]
    fed = {(t, tp) for (_, _), lst in cables.items() for (t, tp, _) in lst}
    cabled_in = [p for p in midi_ins if (inst.id, p.id) in fed]
    if cabled_in:
        # Reachable by cable from something; that something needs a binding upstream.
        feeders = [src for (src, _), lst in cables.items() for (t, _, _) in lst if t == inst.id]
        names = sorted({rig.instance(s).label for s in feeders if rig.instance(s)})
        if names:
            out.append(
                f"Bind a computer endpoint upstream of {', '.join(names)} (the MIDI cable into '{inst.label}' already exists)."
            )
    elif midi_ins:
        mc8 = rig.instance(mc8_id) if mc8_id else None
        if mc8 is not None:
            free_outs = [
                p
                for p in ports_of[mc8.id]
                if p.kind == SignalKind.MIDI and p.direction == PortDirection.OUT and not cables.get((mc8.id, p.id))
            ]
            if free_outs:
                conn = (
                    "a 5-pin DIN cable"
                    if midi_ins[0].connector.value == "din5" and free_outs[0].connector.value == "din5"
                    else "a TRS MIDI cable of the right type (check the pinout)"
                )
                out.append(
                    f"Cable '{mc8.label}: {free_outs[0].label}' → '{inst.label}: {midi_ins[0].label}' with {conn}, then bind the {mc8.label}'s USB."
                )
        if not out:
            out.append(f"Cable a MIDI output that the computer reaches into '{inst.label}: {midi_ins[0].label}'.")
    if not out:
        out.append(f"'{inst.label}' has no documented MIDI input a computer could reach.")
    return out
