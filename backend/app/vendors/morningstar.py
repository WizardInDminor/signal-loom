"""Morningstar MC8 (original) and ML10X route facts. Links: docs/research.md §8."""

from __future__ import annotations

from ..models.common import PortDirection, SignalKind
from ..models.live import MESSAGE_KINDS
from ..models.profile import DeviceProfile, PortDef
from . import Capability, Caps, Forwarding, caps

MC8_IDS = {"morningstar-mc8"}
ML10X_IDS = {"morningstar-ml10x"}

CROSS_THRU = "MC8: enable Cross MIDI Thru (USB → MIDI Out / Omniports) in the controller settings"
OMNI_MODE = "MC8: set this Omniport to a MIDI Out mode (Standard = tip active, or Type B) matching the cable"


def _mc8_entry_usb() -> Caps:
    return caps(
        Capability(
            "supported",
            "published",
            "The MC8 receives PC (bank jump), CC and clock over USB per the MC8 manual; its own channel is the instance's channel.",
        ),
        clock=Capability("supported", "published", "The MC8 receives MIDI Clock (tempo) per its manual."),
        sysex_read=Capability(
            "unknown",
            "unknown",
            "The editor talks SysEx over USB; no documented read-only query is modelled. Nothing is sent.",
        ),
    )


def entry(profile: DeviceProfile, port: PortDef) -> Caps | None:
    if profile.id in MC8_IDS and port.kind == SignalKind.USB:
        return _mc8_entry_usb()
    if profile.id in MC8_IDS and port.kind == SignalKind.MIDI and port.direction == PortDirection.IN:
        return caps(Capability("supported", "published", "The MC8 receives PC/CC on MIDI In per its manual."))
    if profile.id in ML10X_IDS and port.kind == SignalKind.USB:
        return caps(
            Capability(
                "supported",
                "published",
                "Morningstar lists USB MIDI among the ML10X's control inputs (product page/manual); confirm on your unit — it needs external DC power for the relays.",
                ("ML10X powered from its DC inlet (USB alone does not switch relays)",),
            ),
        )
    if profile.id in ML10X_IDS and port.kind == SignalKind.MIDI and port.direction == PortDirection.IN:
        return caps(Capability("supported", "published", "The ML10X receives PC and CC on its 5-pin MIDI In (manual)."))
    return None


def reception(profile: DeviceProfile, port: PortDef) -> Caps | None:
    return entry(profile, port)


def forwardings(profile: DeviceProfile, ports: list[PortDef], in_port_id: str) -> list[Forwarding] | None:
    if profile.id in MC8_IDS:
        inp = next((p for p in ports if p.id == in_port_id), None)
        if inp is None or inp.kind != SignalKind.USB:
            # DIN In → outputs (the MC8's "MIDI Thru" setting) is not needed for computer-origin routes.
            return []
        out: list[Forwarding] = []
        for p in ports:
            if p.kind != SignalKind.MIDI or p.direction != PortDirection.OUT:
                continue
            if p.connector.value == "din5":
                out.append(
                    Forwarding(
                        in_port_id,
                        p.id,
                        caps(
                            Capability(
                                "supported",
                                "published",
                                "Cross MIDI Thru forwards USB-in PC, CC, Note and Clock to the MIDI Out (Morningstar help: 'Does the MC pass MIDI messages through…'). This exact chain is unverified on your hardware.",
                                (CROSS_THRU,),
                            ),
                            clock=Capability(
                                "supported", "published", "Cross MIDI Thru includes MIDI Clock.", (CROSS_THRU,)
                            ),
                            sysex_read=Capability(
                                "unknown",
                                "unknown",
                                "SysEx is not in the published Cross MIDI Thru list; not assumed, not sent.",
                            ),
                        ),
                        note="MC8 USB → MIDI Out (DIN)",
                    )
                )
            else:
                out.append(
                    Forwarding(
                        in_port_id,
                        p.id,
                        caps(
                            Capability(
                                "supported",
                                "published",
                                "Cross MIDI Thru forwards USB-in PC/CC to Omniports set to MIDI Out. Unverified on your hardware.",
                                (CROSS_THRU, OMNI_MODE),
                            ),
                            clock=Capability(
                                "supported",
                                "published",
                                "Cross MIDI Thru includes MIDI Clock.",
                                (CROSS_THRU, OMNI_MODE),
                            ),
                            sysex_read=Capability(
                                "unsupported",
                                "published",
                                "Omniports cannot send SysEx and are output-only: no SysEx and no return path over an Omniport.",
                            ),
                        ),
                        note="MC8 USB → Omniport (TRS MIDI out)",
                    )
                )
        return out
    if profile.id in ML10X_IDS:
        inp = next((p for p in ports if p.id == in_port_id), None)
        thru = next((p for p in ports if p.role == "thru"), None)
        if inp is None or thru is None:
            return []
        if inp.kind == SignalKind.MIDI:
            return [
                Forwarding(
                    in_port_id,
                    thru.id,
                    {
                        k: Capability(
                            "supported",
                            "published",
                            "The ML10X MIDI Thru is a hardware copy of its 5-pin MIDI In (manual); every message kind passes.",
                        )
                        for k in MESSAGE_KINDS
                    },
                    note="ML10X MIDI In → MIDI Thru (hardware)",
                )
            ]
        return [
            Forwarding(
                in_port_id,
                thru.id,
                {
                    k: Capability(
                        "unknown",
                        "unknown",
                        "Whether the ML10X repeats USB-received MIDI on its physical Thru is not documented; the Thru is a DIN-input copy. Not assumed.",
                    )
                    for k in MESSAGE_KINDS
                },
                note="ML10X USB → MIDI Thru (not documented)",
            )
        ]
    return None
