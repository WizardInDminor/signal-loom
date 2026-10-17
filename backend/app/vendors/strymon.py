"""Strymon route facts: Sunset (MIDI over EXP only), BigSky MX (DIN/USB/TRS, MIDI OUT thru setting).
Volante/Zelzah are not shipped profiles yet; the generic rules apply to user-made ones. Links in
docs/research.md §8 (Nixie 2 support list, Sunset MIDI FAQ)."""

from __future__ import annotations

from ..models.common import PortDirection, SignalKind
from ..models.profile import DeviceProfile, PortDef
from . import Capability, Caps, Forwarding, caps

SUNSET_IDS = {"strymon-sunset"}
BIGSKY_MX_IDS = {"strymon-bigsky-mx"}

SUNSET_PREREQS = (
    "Sunset firmware 1.20+ with the EXP jack set to MIDI mode",
    "Strymon MIDI EXP cable, Conduit, or a compatible 5-pin-to-TRS interface (a generic TRS MIDI cable is not guaranteed)",
)
BIGSKY_THRU = "BigSky MX: MIDI OUT set to THRU (or MERGE) in the MIDI settings"


def entry(profile: DeviceProfile, port: PortDef) -> Caps | None:
    if profile.id in SUNSET_IDS:
        if port.kind == SignalKind.USB:
            no = Capability(
                "unsupported",
                "published",
                "Sunset's USB is for firmware updates; Strymon documents MIDI control over the EXP jack only, and Nixie 2 does not list Sunset.",
            )
            return {"pc": no, "cc": no, "clock": no, "sysex_read": no}
        if port.id == "exp_midi" or (port.kind == SignalKind.MIDI and port.direction == PortDirection.IN):
            return caps(
                Capability(
                    "supported",
                    "published",
                    "Strymon FAQ: Sunset accepts PC and CC over the EXP jack with a MIDI EXP cable or Conduit (firmware 1.20+).",
                    SUNSET_PREREQS,
                ),
                sysex_read=Capability(
                    "unknown", "unknown", "No read-only SysEx documented for Sunset; nothing is sent."
                ),
            )
    if profile.id in BIGSKY_MX_IDS:
        if port.kind == SignalKind.USB:
            return caps(
                Capability(
                    "supported",
                    "published",
                    "BigSky MX documents USB-C MIDI (class compliant) alongside 5-pin MIDI; the MX-specific CC/PC map is third-party until the MX manual is read.",
                ),
                sysex_read=Capability(
                    "unknown",
                    "unknown",
                    "No read-only SysEx query modelled; Nixie's protocol is not assumed available.",
                ),
            )
        if port.kind == SignalKind.MIDI and port.direction == PortDirection.IN:
            trs = " (TRS MIDI type on the EXP jack unknown)" if port.id == "exp" else ""
            return caps(
                Capability(
                    "supported",
                    "published",
                    f"BigSky MX receives PC/CC on MIDI IN{trs}.",
                    () if not trs else ("EXP jack set to MIDI",),
                )
            )
    return None


def reception(profile: DeviceProfile, port: PortDef) -> Caps | None:
    return entry(profile, port)


def forwardings(profile: DeviceProfile, ports: list[PortDef], in_port_id: str) -> list[Forwarding] | None:
    if profile.id in SUNSET_IDS:
        return []  # no MIDI output of any kind
    if profile.id in BIGSKY_MX_IDS:
        inp = next((p for p in ports if p.id == in_port_id), None)
        out_port = next((p for p in ports if p.kind == SignalKind.MIDI and p.direction == PortDirection.OUT), None)
        if inp is None or out_port is None:
            return []
        if inp.kind == SignalKind.MIDI:
            return [
                Forwarding(
                    in_port_id,
                    out_port.id,
                    caps(
                        Capability(
                            "supported",
                            "published",
                            "BigSky MX MIDI OUT repeats MIDI IN when set to THRU (or MERGE) per the manual's MIDI settings.",
                            (BIGSKY_THRU,),
                        ),
                        clock=Capability("supported", "published", "THRU repeats clock as well.", (BIGSKY_THRU,)),
                        sysex_read=Capability(
                            "unknown", "unknown", "SysEx through THRU is not documented; not assumed."
                        ),
                    ),
                    note="BigSky MX MIDI IN → MIDI OUT (THRU setting)",
                )
            ]
        return [
            Forwarding(
                in_port_id,
                out_port.id,
                {
                    k: Capability(
                        "unknown",
                        "unknown",
                        "Whether USB-received MIDI is repeated on the BigSky MX's MIDI OUT is not documented; not assumed.",
                    )
                    for k in ("pc", "cc", "clock", "sysex_read")
                },
                note="BigSky MX USB → MIDI OUT (not documented)",
            )
        ]
    return None
