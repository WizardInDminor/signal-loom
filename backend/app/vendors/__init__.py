"""Per-family MIDI *route* capabilities with evidence (Session 4).

The compiler and the scene model never import this package. It answers three questions the
live route graph asks about a device, each per message kind (PC, CC, clock, read-only SysEx):

- ``entry_capabilities``: can the computer address this device directly through this jack (USB,
  or a DIN/TRS input fed by a computer interface), and what does the device itself receive there?
- ``reception_capabilities``: what does the device receive on a MIDI input reached by cable?
- ``forwardings``: which of the device's MIDI outputs repeat what arrives on an input, under which
  prerequisites (MC8 Cross MIDI Thru, Omniport MIDI-out mode, BigSky MIDI OUT = THRU, …).

Evidence levels are the charter's: ``published`` (manufacturer material; see docs/research.md
for the links and the fact that the sandbox could not open most vendor hosts), ``unknown``,
``simulation_tested`` (the virtual transport delivered it) and ``hardware_verified`` (the user's
own recorded test — only the user can set it). Nothing here claims more than its source.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..models.common import Evidence, PortDirection, SignalKind
from ..models.live import MESSAGE_KINDS, CapabilityStatus, MessageKind, RouteEvidence
from ..models.profile import DeviceProfile, PortDef


@dataclass(frozen=True)
class Capability:
    status: CapabilityStatus
    evidence: RouteEvidence
    reason: str
    prerequisites: tuple[str, ...] = ()

    def as_dict(self) -> dict:
        return {
            "status": self.status,
            "evidence": self.evidence,
            "reason": self.reason,
            "prerequisites": list(self.prerequisites),
        }


@dataclass(frozen=True)
class Forwarding:
    """Messages arriving on ``in_port_id`` are repeated on ``out_port_id`` (per kind)."""

    in_port_id: str
    out_port_id: str
    caps: dict[MessageKind, Capability]
    note: str | None = None


Caps = dict[MessageKind, Capability]


def caps(
    pc: Capability, cc: Capability | None = None, clock: Capability | None = None, sysex_read: Capability | None = None
) -> Caps:
    return {"pc": pc, "cc": cc or pc, "clock": clock or UNKNOWN_CLOCK, "sysex_read": sysex_read or UNKNOWN_SYSEX}


UNKNOWN_CLOCK = Capability(
    "unknown", "unknown", "MIDI Clock handling on this hop is not documented in the sources read."
)
UNKNOWN_SYSEX = Capability(
    "unknown", "unknown", "Read-only SysEx (identity/query) on this hop is not documented; nothing is sent."
)
UNKNOWN_ALL: Caps = {
    "pc": Capability("unknown", "unknown", "Not documented in the sources read."),
    "cc": Capability("unknown", "unknown", "Not documented in the sources read."),
    "clock": UNKNOWN_CLOCK,
    "sysex_read": UNKNOWN_SYSEX,
}


def _evidence_of(profile_evidence: Evidence) -> RouteEvidence:
    return "published" if profile_evidence == Evidence.DOCUMENTED else "unknown"


SYNTHETIC_SOURCE = "synthetic_fixture"


def _generic_reception(profile: DeviceProfile, port: PortDef) -> Caps:
    """What a profile's own MIDI facts say about receiving PC/CC on this input."""
    midi = profile.midi
    if profile.provenance.source == SYNTHETIC_SOURCE and midi.interfaces:
        # A Signal Loom synthetic fixture: its reception is *defined* by the simulation, so the
        # honest evidence is "simulation_tested", never "published" and never hardware.
        ok = Capability(
            "supported",
            "simulation_tested",
            f"{profile.display_name} is a synthetic fixture; it receives whatever the simulation delivers on {port.label}.",
        )
        return caps(ok, ok)
    ev = _evidence_of(midi.evidence)
    status: CapabilityStatus = "supported" if ev == "published" and midi.interfaces else "unknown"
    reason = (
        f"{profile.display_name} lists MIDI interfaces {', '.join(midi.interfaces)} ({midi.evidence.value})."
        if midi.interfaces
        else f"{profile.display_name} has no MIDI interface in its profile."
    )
    if not midi.interfaces:
        no = Capability("unsupported", "published" if ev == "published" else "unknown", reason)
        return {"pc": no, "cc": no, "clock": no, "sysex_read": no}
    pc_status = status
    if midi.program_change.supported is False:
        pc = Capability(
            "unsupported", ev, f"{profile.display_name} does not respond to Program Change per its profile."
        )
    else:
        pc = Capability(pc_status, ev, reason)
    cc = Capability(status, ev, reason)
    return caps(pc, cc)


def _port_is_computer_facing(port: PortDef) -> bool:
    return port.kind == SignalKind.USB or (port.kind == SignalKind.MIDI and port.direction == PortDirection.IN)


def entry_capabilities(profile: DeviceProfile, port: PortDef) -> Caps | None:
    """Direct reach from the computer through ``port``. None = this jack cannot face the computer."""
    if not _port_is_computer_facing(port):
        return None
    from . import morningstar, strymon  # local import: small tables, no cycles

    for mod in (morningstar, strymon):
        hit = mod.entry(profile, port)
        if hit is not None:
            return hit
    if port.kind == SignalKind.USB:
        if "usb" not in profile.midi.interfaces:
            no = Capability(
                "unsupported",
                _evidence_of(profile.midi.evidence),
                f"{profile.display_name}'s USB jack is not listed as a MIDI interface in its profile (firmware/editor use only is assumed until documented otherwise).",
            )
            return {"pc": no, "cc": no, "clock": no, "sysex_read": no}
        return _generic_reception(profile, port)
    return _generic_reception(profile, port)


def reception_capabilities(profile: DeviceProfile, port: PortDef) -> Caps:
    from . import morningstar, strymon

    for mod in (morningstar, strymon):
        hit = mod.reception(profile, port)
        if hit is not None:
            return hit
    return _generic_reception(profile, port)


def forwardings(profile: DeviceProfile, ports: list[PortDef], in_port_id: str) -> list[Forwarding]:
    """Outputs that repeat what arrives on ``in_port_id``. Vendor tables first; otherwise a port
    with ``role == "thru"`` is assumed to be a hardware Thru of the device's DIN input with *unknown*
    evidence (a MIDI Out is never assumed to be a Thru)."""
    from . import morningstar, strymon

    for mod in (morningstar, strymon):
        hit = mod.forwardings(profile, ports, in_port_id)
        if hit is not None:
            return hit
    out: list[Forwarding] = []
    inp = next((p for p in ports if p.id == in_port_id), None)
    for p in ports:
        if p.kind == SignalKind.MIDI and p.direction == PortDirection.OUT and p.role == "thru":
            if inp is not None and inp.kind == SignalKind.MIDI:
                reason = f"'{p.label}' is marked as a Thru on {profile.display_name}; whether it repeats '{inp.label}' is not documented in the sources read."
                out.append(
                    Forwarding(in_port_id, p.id, {k: Capability("unknown", "unknown", reason) for k in MESSAGE_KINDS})
                )
            else:
                reason = f"USB → '{p.label}' forwarding on {profile.display_name} is not documented; never inferred from a physical Thru."
                out.append(
                    Forwarding(in_port_id, p.id, {k: Capability("unknown", "unknown", reason) for k in MESSAGE_KINDS})
                )
    return out
