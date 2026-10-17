"""The virtual transport: simulated endpoints, a simulated downstream receiver network per endpoint,
and simulated pedals that keep state when a message reaches them.

This is a *user-selectable simulation mode*, not a stand-in that pretends to be hardware. It needs
no native MIDI library, runs in CI, and records every transmitted byte string so tests can prove
that a dry run sends nothing. A simulated pedal's state is labelled "simulated" everywhere; it is
never presented as the state of a physical device.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

from .transport import (
    EndpointInfo,
    MidiMessage,
    OpenState,
    PortBusyError,
    ReceiveCallback,
    RecordingMixin,
    TransportError,
    decode,
)

GENERIC_OUT = "virt:generic:out"
GENERIC_IN = "virt:generic:in"


@dataclass
class ReceivedNote:
    at: float
    message: MidiMessage
    endpoint_id: str
    evidence: str  # evidence of the simulated route the message travelled


@dataclass
class VirtualPedal:
    """One simulated receiver. Channel-filtered; keeps program, bank, bypass and CC values."""

    instance_id: str
    label: str
    channel: int
    bypass_cc: int | None = None
    bypass_on: int | None = None
    bypass_off: int | None = None
    bypass_deterministic: bool | None = None
    pc_supported: bool | None = None
    # state
    program: int | None = None
    bank_msb: int | None = None
    bank_lsb: int | None = None
    bypassed: bool | None = None  # None = never addressed
    cc: dict[int, int] = field(default_factory=dict)
    received: list[ReceivedNote] = field(default_factory=list)
    # which endpoint networks the pedal sits on and the evidence of each route
    routes: dict[str, str] = field(default_factory=dict)  # endpoint_id -> evidence

    def receive(self, endpoint_id: str, msg: MidiMessage, evidence: str) -> bool:
        """Apply a message if it is on this pedal's channel. Returns True when it changed state."""
        if msg.channel != self.channel or msg.type not in ("pc", "cc"):
            return False
        self.received.append(ReceivedNote(time.time(), msg, endpoint_id, evidence))
        del self.received[:-50]
        if msg.type == "pc":
            if self.pc_supported is False:
                return False
            self.program = msg.number
            return True
        assert msg.number is not None and msg.value is not None
        if msg.number == 0:
            self.bank_msb = msg.value
        elif msg.number == 32:
            self.bank_lsb = msg.value
        elif self.bypass_cc is not None and msg.number == self.bypass_cc:
            if self.bypass_deterministic is False:
                self.bypassed = not self.bypassed if self.bypassed is not None else False
            elif self.bypass_off is not None and msg.value == self.bypass_off:
                self.bypassed = True
            elif self.bypass_on is not None and msg.value == self.bypass_on:
                self.bypassed = False
            elif self.bypass_off is not None and self.bypass_on is not None:
                # Documented "0 = bypass, 1-127 = engage" style ranges.
                self.bypassed = (
                    msg.value < self.bypass_on if self.bypass_off < self.bypass_on else msg.value > self.bypass_on
                )
            else:
                self.cc[msg.number] = msg.value
        else:
            self.cc[msg.number] = msg.value
        return True

    def as_dict(self) -> dict:
        return {
            "instance_id": self.instance_id,
            "label": self.label,
            "channel": self.channel,
            "program": self.program,
            "bank_msb": self.bank_msb,
            "bank_lsb": self.bank_lsb,
            "bypassed": self.bypassed,
            "cc": {str(k): v for k, v in sorted(self.cc.items())},
            "received_count": len(self.received),
            "last_received": self.received[-1].message.summary() if self.received else None,
            "routes": dict(self.routes),
            "simulated": True,
        }


class VirtualTransport(RecordingMixin):
    """Simulated MIDI backend.

    ``set_world`` installs the rig-specific endpoints and the pedals attached to each endpoint's
    receiver network (the service derives both from the rig's bindings and route graph). Two
    generic endpoints always exist so a rig without any USB-capable device can still be bound.
    """

    kind = "virtual"

    def __init__(self) -> None:
        super().__init__()
        self._endpoints: dict[str, EndpointInfo] = {}
        self._networks: dict[str, list[VirtualPedal]] = {}
        self._open = OpenState()
        self._busy: set[str] = set()
        self._unplugged: set[str] = set()
        self._generic()

    def _generic(self) -> None:
        self._endpoints[GENERIC_OUT] = EndpointInfo(
            GENERIC_OUT, "Virtual USB MIDI interface (out)", "out", "virtual", note="simulated generic interface"
        )
        self._endpoints[GENERIC_IN] = EndpointInfo(
            GENERIC_IN, "Virtual USB MIDI interface (in)", "in", "virtual", note="simulated generic interface"
        )

    # -- world -------------------------------------------------------------------------
    def set_world(self, endpoints: list[EndpointInfo], networks: dict[str, list[VirtualPedal]]) -> None:
        with self._lock:
            keep_open = set(self._open.outputs)
            self._endpoints = {}
            self._generic()
            for e in endpoints:
                self._endpoints[e.id] = e
            self._networks = {k: list(v) for k, v in networks.items()}
            # Endpoints that vanished from the world are closed (as an unplug would).
            for eid in keep_open:
                if eid not in self._endpoints:
                    self._open.outputs.discard(eid)
            for eid in list(self._open.inputs):
                if eid not in self._endpoints:
                    del self._open.inputs[eid]

    def pedals(self) -> dict[str, VirtualPedal]:
        with self._lock:
            out: dict[str, VirtualPedal] = {}
            for peds in self._networks.values():
                for p in peds:
                    out[p.instance_id] = p
            return out

    # -- fault injection for tests and demos ----------------------------------------------
    def set_busy(self, endpoint_id: str, busy: bool) -> None:
        with self._lock:
            (self._busy.add if busy else self._busy.discard)(endpoint_id)
            if busy:
                self._open.outputs.discard(endpoint_id)
                self._open.inputs.pop(endpoint_id, None)

    def unplug(self, endpoint_id: str, unplugged: bool = True) -> None:
        with self._lock:
            (self._unplugged.add if unplugged else self._unplugged.discard)(endpoint_id)
            if unplugged:
                self._open.outputs.discard(endpoint_id)
                self._open.inputs.pop(endpoint_id, None)

    # -- Transport protocol ---------------------------------------------------------------
    def available(self) -> tuple[bool, str | None]:
        return True, None

    def enumerate(self) -> list[EndpointInfo]:
        with self._lock:
            out = []
            for e in self._endpoints.values():
                if e.id in self._unplugged:
                    continue
                out.append(EndpointInfo(e.id, e.name, e.direction, e.transport, True, e.id in self._busy, e.note))
            return out

    def _check(self, endpoint_id: str, direction: str) -> EndpointInfo:
        e = self._endpoints.get(endpoint_id)
        if e is None or endpoint_id in self._unplugged:
            raise TransportError(f"virtual endpoint '{endpoint_id}' is not present (unplugged or unknown)")
        if e.direction != direction:
            raise TransportError(f"virtual endpoint '{e.name}' is an {e.direction}put, not an {direction}put")
        if endpoint_id in self._busy:
            raise PortBusyError(
                f"'{e.name}' is owned by another application (simulated). Close it there, or release it here and try again."
            )
        return e

    def open_output(self, endpoint_id: str) -> None:
        with self._lock:
            self._check(endpoint_id, "out")
            self._open.outputs.add(endpoint_id)

    def open_input(self, endpoint_id: str, on_receive: ReceiveCallback) -> None:
        with self._lock:
            self._check(endpoint_id, "in")
            self._open.inputs[endpoint_id] = on_receive

    def close(self, endpoint_id: str) -> None:
        with self._lock:
            self._open.outputs.discard(endpoint_id)
            self._open.inputs.pop(endpoint_id, None)

    def close_all(self) -> None:
        with self._lock:
            self._open = OpenState()

    def is_open(self, endpoint_id: str) -> bool:
        with self._lock:
            return endpoint_id in self._open.outputs or endpoint_id in self._open.inputs

    def send(self, endpoint_id: str, data: bytes) -> None:
        with self._lock:
            if endpoint_id not in self._open.outputs:
                raise TransportError(f"virtual endpoint '{endpoint_id}' is not open for output")
            self._check(endpoint_id, "out")
            self._record(endpoint_id, data)
            msg = decode(data)
            for pedal in self._networks.get(endpoint_id, []):
                pedal.receive(endpoint_id, msg, pedal.routes.get(endpoint_id, "simulation_tested"))

    # -- simulated input ------------------------------------------------------------------
    def inject(self, endpoint_id: str, data: bytes) -> bool:
        """Deliver bytes as if they arrived on a virtual input (e.g. a simulated MC8 footswitch
        echoing to USB). Returns False when nobody is listening."""
        with self._lock:
            cb = self._open.inputs.get(endpoint_id)
        if cb is None:
            return False
        # Like a real driver, call back from another thread so the handoff is exercised.
        t = threading.Thread(target=cb, args=(endpoint_id, bytes(data)), daemon=True)
        t.start()
        t.join(timeout=2.0)
        return True
