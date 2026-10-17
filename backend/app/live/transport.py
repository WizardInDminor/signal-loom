"""Transport protocol: what any MIDI backend (virtual or real) must offer, and the wire format of
the only two message types Signal Loom is allowed to transmit.

The sender never builds bytes for anything but Program Change and Control Change; SysEx, notes,
clock and every other status byte are refused before they reach a transport (``encode`` raises).
Incoming bytes are decoded for display only.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal, Protocol

ALLOWED_OUTPUT_TYPES: frozenset[str] = frozenset({"pc", "cc"})

EndpointDirection = Literal["in", "out"]


class TransportError(RuntimeError):
    """A transport could not do what was asked (port gone, busy, library missing)."""


class PortBusyError(TransportError):
    """Another application owns the endpoint exclusively (typical for USB MIDI on Windows)."""


class ForbiddenMessageError(ValueError):
    """The message type is not one Signal Loom may transmit."""


@dataclass(frozen=True)
class EndpointInfo:
    """An enumerated MIDI endpoint on this computer (or in the simulation)."""

    id: str  # stable within a transport: "virt:mc8-usb-out", "rtmidi:out:Morningstar MC8 1"
    name: str
    direction: EndpointDirection
    transport: str  # "virtual" | "rtmidi"
    available: bool = True
    busy: bool = False  # owned by another application
    note: str | None = None

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "direction": self.direction,
            "transport": self.transport,
            "available": self.available,
            "busy": self.busy,
            "note": self.note,
        }


@dataclass(frozen=True)
class MidiMessage:
    """A channel message as Signal Loom understands it: PC or CC, channel 1–16."""

    type: str  # "pc" | "cc" | "other"
    channel: int | None
    number: int | None
    value: int | None = None
    raw: bytes = b""

    def as_dict(self) -> dict:
        return {
            "type": self.type,
            "channel": self.channel,
            "number": self.number,
            "value": self.value,
            "hex": self.raw.hex(" ").upper(),
        }

    def summary(self) -> str:
        if self.type == "pc":
            return f"PC {self.number} ch {self.channel}"
        if self.type == "cc":
            return f"CC {self.number} = {self.value} ch {self.channel}"
        return f"{self.raw.hex(' ').upper()} (not decoded)"


def encode(type_: str, channel: int, number: int, value: int | None) -> bytes:
    """Bytes for a PC or CC. Anything else is refused: this is the single choke point."""
    if type_ not in ALLOWED_OUTPUT_TYPES:
        raise ForbiddenMessageError(f"message type '{type_}' is not allowed; Signal Loom transmits PC and CC only")
    if not 1 <= channel <= 16:
        raise ValueError(f"MIDI channel {channel} is outside 1-16")
    if not 0 <= number <= 127:
        raise ValueError(f"number {number} is outside 0-127")
    if type_ == "pc":
        return bytes([0xC0 | (channel - 1), number])
    if value is None or not 0 <= value <= 127:
        raise ValueError(f"CC value {value} is outside 0-127")
    return bytes([0xB0 | (channel - 1), number, value])


def decode(data: bytes) -> MidiMessage:
    """Decode a received message for display. Only PC and CC are interpreted."""
    raw = bytes(data)
    if len(raw) == 2 and 0xC0 <= raw[0] <= 0xCF:
        return MidiMessage("pc", (raw[0] & 0x0F) + 1, raw[1], None, raw)
    if len(raw) == 3 and 0xB0 <= raw[0] <= 0xBF:
        return MidiMessage("cc", (raw[0] & 0x0F) + 1, raw[1], raw[2], raw)
    return MidiMessage("other", None, None, None, raw)


ReceiveCallback = Callable[[str, bytes], None]  # (endpoint_id, raw bytes); called from any thread


class Transport(Protocol):
    """One MIDI backend. Methods may be called from the API thread pool; implementations must be
    thread-safe. Receive callbacks run on the transport's own thread and must not block."""

    kind: str

    def available(self) -> tuple[bool, str | None]: ...
    def enumerate(self) -> list[EndpointInfo]: ...
    def open_output(self, endpoint_id: str) -> None: ...
    def open_input(self, endpoint_id: str, on_receive: ReceiveCallback) -> None: ...
    def close(self, endpoint_id: str) -> None: ...
    def close_all(self) -> None: ...
    def is_open(self, endpoint_id: str) -> bool: ...
    def send(self, endpoint_id: str, data: bytes) -> None: ...


@dataclass
class SendRecord:
    endpoint_id: str
    data: bytes
    seq: int


class RecordingMixin:
    """Bookkeeping shared by transports: every transmitted byte string is counted, so a test can
    prove that a dry run made zero sends."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.sent: list[SendRecord] = []
        self._seq = 0

    def _record(self, endpoint_id: str, data: bytes) -> None:
        with self._lock:
            self._seq += 1
            self.sent.append(SendRecord(endpoint_id, bytes(data), self._seq))

    @property
    def send_count(self) -> int:
        with self._lock:
            return len(self.sent)


@dataclass
class OpenState:
    outputs: set[str] = field(default_factory=set)
    inputs: dict[str, ReceiveCallback] = field(default_factory=dict)
