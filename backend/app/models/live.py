"""Live-control models (Session 4).

Everything here is *workstation-local*: an endpoint name such as ``Morningstar MC8 1`` means
something only on the computer that enumerated it. ``LiveBindings`` is therefore stored in its own
table keyed by rig and is never part of a project file. The rig document itself does not change:
physical cables stay ordinary ``Connection``s and a binding only says which enumerated endpoint is
plugged into which device's USB jack.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from .common import StrictModel

TransportMode = Literal["virtual", "rtmidi"]

# Evidence for a route hop or capability: how we know a message kind traverses it.
RouteEvidence = Literal["published", "unknown", "simulation_tested", "hardware_verified"]
CapabilityStatus = Literal["supported", "unsupported", "unknown"]
MessageKind = Literal["pc", "cc", "clock", "sysex_read"]
MESSAGE_KINDS: tuple[MessageKind, ...] = ("pc", "cc", "clock", "sysex_read")


class EndpointBinding(StrictModel):
    """An enumerated MIDI endpoint plugged into one device's USB (or other computer-facing) jack.

    One endpoint can reach several pedals (through the device's forwarding and the rig's MIDI
    cables); the per-pedal route and channel are derived, never stored here."""

    endpoint_id: str = Field(min_length=1, max_length=200)
    instance_id: str
    port_id: str
    # Which direction(s) this binding covers on the computer side.
    direction: Literal["out", "in", "both"] = "out"
    note: str | None = None
    # Number of same-named endpoints present when this binding was saved (filled in by the server).
    # Identically named ports are told apart by ordinal only, so when the count changes the
    # ordinal may now point at a different device: the binding is held (not opened) until the
    # user re-saves it, and an armed session is disarmed.
    peer_count: int | None = None


class ChannelGroup(StrictModel):
    """A deliberate shared channel: these devices are meant to react together. Declaring it turns
    the collision warning into an informational note; nothing is rejected either way."""

    channel: int = Field(ge=1, le=16)
    instance_ids: list[str] = Field(min_length=2)
    note: str | None = None


class LiveBindings(StrictModel):
    rig_id: str
    transport_mode: TransportMode = "virtual"
    bindings: list[EndpointBinding] = Field(default_factory=list)
    channel_groups: list[ChannelGroup] = Field(default_factory=list)
    # Conservative inter-message delay for auditions (ms). Kept per rig and per workstation.
    send_delay_ms: int = Field(default=20, ge=0, le=2000)
    # Hardware verification claims the user has recorded for routes (hop key -> note). Only the
    # user can raise a hop to "hardware_verified"; the app never does it on its own.
    verified_hops: dict[str, str] = Field(default_factory=dict)
    updated_at: str | None = None
