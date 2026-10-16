"""Cable kit: turn logical port-to-port connections into the physical cables a user must buy.

The important case is the ML10X: its Send/Return/Input/Output jacks are TRS sockets whose
Tip and Ring are independent mono conductors. Using both conductors of one jack needs a
TRS-to-dual-TS breakout; using only the Tip works with a plain TS cable; using only the Ring
still needs a breakout (a TS plug cannot reach the ring).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from ..models.common import AudioChannel, Connector, Diagnostic, Severity, SignalKind, TrsRole
from ..models.profile import PortDef
from .wiring import ResolvedConnection, ResolvedEnd, WiringContext


@dataclass
class CableItem:
    kind: str  # "ts" | "trs" | "trs_breakout" | "midi_din" | "trs_midi" | "midi_adapter" | "dc" | "usb" | "other"
    description: str
    ends: list[str]
    connection_ids: list[str] = field(default_factory=list)
    length_cm: float | None = None
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def _is_conductor_of_shared_trs(end: ResolvedEnd, ctx: WiringContext) -> bool:
    """A port that is one conductor (Tip or Ring) of a TRS jack shared with a sibling port."""
    p = end.port
    if p.connector != Connector.TRS_1_4 or not p.pair_group or p.trs_role != TrsRole.STEREO:
        return False
    siblings = [q for q in ctx.ports[end.instance.id].values() if q.pair_group == p.pair_group and q.id != p.id]
    return bool(siblings) and p.audio_channel in (AudioChannel.LEFT, AudioChannel.RIGHT)


def _conductor_name(p: PortDef) -> str:
    return "Tip" if p.audio_channel == AudioChannel.LEFT else "Ring" if p.audio_channel == AudioChannel.RIGHT else "?"


def cable_kit(ctx: WiringContext) -> tuple[list[CableItem], list[Diagnostic]]:
    items: list[CableItem] = []
    diags: list[Diagnostic] = []
    # Group audio connections by the shared TRS jack they touch (instance:pair_group).
    by_jack: dict[str, list[tuple[ResolvedConnection, str]]] = defaultdict(list)
    handled: set[str] = set()
    for rc in ctx.resolved:
        if rc.connection.kind != SignalKind.AUDIO:
            continue
        for side, end in (("source", rc.source), ("target", rc.target)):
            if _is_conductor_of_shared_trs(end, ctx):
                by_jack[f"{end.instance.id}:{end.port.pair_group}"].append((rc, side))
    for key, uses in by_jack.items():
        inst_id, group = key.split(":", 1)
        inst = ctx.instances[inst_id]
        conns = {rc.connection.id: (rc, side) for rc, side in uses}
        conductors = {}
        for rc, side in uses:
            end = rc.source if side == "source" else rc.target
            conductors[_conductor_name(end.port)] = (rc, side, end)
        jack_label = next(iter(conductors.values()))[2].port.label.split(" (")[0]
        if len(conductors) == 2:
            far = []
            for cond in ("Tip", "Ring"):
                rc, side, end = conductors[cond]
                other = rc.target if side == "source" else rc.source
                far.append(f"{cond} → {other.instance.label}: {other.port.label}")
            items.append(
                CableItem(
                    kind="trs_breakout",
                    description=f"TRS-to-dual-TS breakout at {inst.label} {jack_label}",
                    ends=[f"{inst.label}: {jack_label} (TRS plug)", *far],
                    connection_ids=list(conns),
                    notes=[
                        "Tip lead (usually black) = left/first signal; Ring lead (usually red) = right/second signal."
                    ],
                )
            )
            handled.update(conns)
        else:
            cond, (rc, side, end) = next(iter(conductors.items()))
            other = rc.target if side == "source" else rc.source
            if cond == "Ring":
                items.append(
                    CableItem(
                        kind="trs_breakout",
                        description=f"TRS-to-dual-TS breakout at {inst.label} {jack_label} (Ring lead only)",
                        ends=[
                            f"{inst.label}: {jack_label} (TRS plug)",
                            f"Ring → {other.instance.label}: {other.port.label}",
                            "Tip lead unused",
                        ],
                        connection_ids=[rc.connection.id],
                        notes=[
                            "A plain TS plug cannot reach the Ring conductor; a breakout (or a TRS-to-TS cable wired to the ring) is required."
                        ],
                    )
                )
                diags.append(
                    Diagnostic(
                        code="cable.ring_only_breakout",
                        severity=Severity.INFO,
                        message=f"'{inst.label}: {jack_label}' uses only the Ring conductor; this needs a breakout cable, not a TS cable.",
                        subject_type="connection",
                        subject_id=rc.connection.id,
                    )
                )
            else:
                other_is_trs_conductor = _is_conductor_of_shared_trs(other, ctx)
                items.append(
                    CableItem(
                        kind="ts",
                        description=f"TS cable {inst.label} {jack_label} (Tip only) ↔ {other.instance.label} {other.port.label}",
                        ends=[f"{inst.label}: {jack_label}", f"{other.instance.label}: {other.port.label}"],
                        connection_ids=[rc.connection.id],
                        length_cm=rc.connection.cable_length_cm,
                        notes=["A TS plug in a TRS socket uses the Tip and grounds the Ring; fine for mono use."]
                        + (
                            ["The far end is also a TRS conductor jack: use Tip-to-Tip."]
                            if other_is_trs_conductor
                            else []
                        ),
                    )
                )
            handled.add(rc.connection.id)
    for rc in ctx.resolved:
        c = rc.connection
        if c.id in handled:
            continue
        s, t = rc.source.port, rc.target.port
        ends = [f"{rc.source.instance.label}: {s.label}", f"{rc.target.instance.label}: {t.label}"]
        if c.kind == SignalKind.AUDIO:
            if (
                s.connector == Connector.TRS_1_4
                and t.connector == Connector.TRS_1_4
                and s.audio_channel == AudioChannel.STEREO_TRS
            ):
                items.append(
                    CableItem(
                        kind="trs",
                        description="TRS (stereo) cable",
                        ends=ends,
                        connection_ids=[c.id],
                        length_cm=c.cable_length_cm,
                    )
                )
            else:
                items.append(
                    CableItem(
                        kind="ts",
                        description="TS instrument cable",
                        ends=ends,
                        connection_ids=[c.id],
                        length_cm=c.cable_length_cm,
                    )
                )
        elif c.kind == SignalKind.MIDI:
            s_trs = s.connector in (Connector.TRS_1_4, Connector.TRS_1_8)
            t_trs = t.connector in (Connector.TRS_1_4, Connector.TRS_1_8)
            if s_trs and t_trs:
                items.append(
                    CableItem(
                        kind="trs_midi",
                        description=f"TRS MIDI cable ({s.midi_trs_type.value if s.midi_trs_type else 'type ?'} → {t.midi_trs_type.value if t.midi_trs_type else 'type ?'})",
                        ends=ends,
                        connection_ids=[c.id],
                        length_cm=c.cable_length_cm,
                    )
                )
            elif s_trs or t_trs:
                items.append(
                    CableItem(
                        kind="midi_adapter",
                        description="5-pin DIN to TRS MIDI adapter cable",
                        ends=ends,
                        connection_ids=[c.id],
                        length_cm=c.cable_length_cm,
                        notes=["Match the TRS end's Type A/B wiring."],
                    )
                )
            else:
                items.append(
                    CableItem(
                        kind="midi_din",
                        description="5-pin DIN MIDI cable",
                        ends=ends,
                        connection_ids=[c.id],
                        length_cm=c.cable_length_cm,
                    )
                )
        elif c.kind == SignalKind.POWER:
            items.append(
                CableItem(
                    kind="dc",
                    description=f"DC power lead ({t.connector.value.replace('_', ' ')})",
                    ends=ends,
                    connection_ids=[c.id],
                    length_cm=c.cable_length_cm,
                )
            )
        elif c.kind == SignalKind.USB:
            items.append(CableItem(kind="usb", description="USB cable", ends=ends, connection_ids=[c.id]))
        else:
            items.append(
                CableItem(
                    kind="other",
                    description=f"{c.kind.value} cable ({s.connector.value} ↔ {t.connector.value})",
                    ends=ends,
                    connection_ids=[c.id],
                    length_cm=c.cable_length_cm,
                )
            )
    return items, diags
