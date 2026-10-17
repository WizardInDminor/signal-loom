"""Real MIDI backend on top of ``python-rtmidi`` (optional dependency, ``pip install -e ".[live]"``).

Status: **written against the python-rtmidi API and tested against a fake of that API**
(``tests/test_live_rtmidi.py``: enumerate, duplicate names, open/close, send, input callback,
busy ports, disappearance). It has not been run on hardware in this repository: the build sandbox
has no MIDI devices and cannot compile the library. When the import fails the transport reports
itself unavailable with the reason, and nothing in Signal Loom substitutes the virtual transport
for it silently.

Endpoint identity. The OS reports only names, and Windows lists two identical devices under one
name. An endpoint id is therefore ``rtmidi:<dir>:<name>#<k>`` where ``k`` is the ordinal among the
same-named ports of that direction in enumeration order (``#0`` for a unique name). The ordinal is
stable while the set of same-named ports does not change; when it changes, the service compares the
``peer_count`` recorded on the binding with the one enumerated now and refuses to open the port
until the user re-saves the binding (see ``LiveService._open_binding``).

Port contention on Windows: the class-compliant USB MIDI driver lets one process own a port at a
time. If the Morningstar editor, Nixie or Neuro has it, ``open_output`` raises ``PortBusyError``
with that explanation; closing it there (or releasing it here) is the remedy.
"""

from __future__ import annotations

import threading
from collections import Counter

from .transport import EndpointInfo, OpenState, PortBusyError, ReceiveCallback, RecordingMixin, TransportError

try:  # pragma: no cover - exercised only where the library is installed
    import rtmidi as _rtmidi

    _IMPORT_ERROR: str | None = None
except Exception as e:  # ImportError or a native load failure
    _rtmidi = None
    _IMPORT_ERROR = f"{type(e).__name__}: {e}"


def _busy(text: str) -> bool:
    t = text.lower()
    return any(k in t for k in ("busy", "in use", "could not open", "already open", "access denied", "error creating"))


def parse_endpoint_id(endpoint_id: str) -> tuple[str, str, int]:
    """``rtmidi:out:Name#2`` → ("out", "Name", 2). A missing ordinal means 0."""
    try:
        _, direction, rest = endpoint_id.split(":", 2)
    except ValueError as e:
        raise TransportError(f"'{endpoint_id}' is not an rtmidi endpoint id") from e
    name, sep, ordinal = rest.rpartition("#")
    if sep and ordinal.isdigit():
        return direction, name, int(ordinal)
    return direction, rest, 0


class RtMidiTransport(RecordingMixin):
    kind = "rtmidi"

    def __init__(self) -> None:
        super().__init__()
        self._outs: dict[str, object] = {}
        self._ins: dict[str, object] = {}
        self._open = OpenState()
        self._cb_lock = threading.Lock()

    @staticmethod
    def _lib():
        if _rtmidi is None:
            raise TransportError(f"python-rtmidi is not installed ({_IMPORT_ERROR})")
        return _rtmidi

    def available(self) -> tuple[bool, str | None]:
        if _rtmidi is None:
            return False, f'python-rtmidi is not installed ({_IMPORT_ERROR}); install with: pip install -e ".[live]"'
        return True, None

    @staticmethod
    def _ids(direction: str, ports: list[str]) -> list[tuple[str, str, int]]:
        """(id, name, peer_count) per port, ordinals assigned in enumeration order."""
        seen: Counter[str] = Counter()
        counts = Counter(ports)
        out = []
        for name in ports:
            k = seen[name]
            seen[name] += 1
            out.append((f"rtmidi:{direction}:{name}#{k}", name, counts[name]))
        return out

    def _ports(self, direction: str) -> list[str]:
        lib = self._lib()
        probe = lib.MidiOut() if direction == "out" else lib.MidiIn()
        try:
            return list(probe.get_ports())
        finally:
            try:
                probe.delete()
            except Exception:
                pass
            del probe

    def enumerate(self) -> list[EndpointInfo]:
        if _rtmidi is None:
            return []
        out: list[EndpointInfo] = []
        try:
            for direction in ("out", "in"):
                for eid, name, peers in self._ids(direction, self._ports(direction)):
                    note = f"{peers} ports share this name; told apart by position only" if peers > 1 else None
                    out.append(EndpointInfo(eid, name, direction, "rtmidi", note=note, peer_count=peers))  # type: ignore[arg-type]
        except TransportError:
            raise
        except Exception as e:
            raise TransportError(f"MIDI enumeration failed: {e}") from e
        return out

    @staticmethod
    def _index(ports: list[str], endpoint_id: str) -> int:
        _, name, ordinal = parse_endpoint_id(endpoint_id)
        matches = [i for i, p in enumerate(ports) if p == name]
        if ordinal >= len(matches):
            if not matches:
                raise TransportError(f"MIDI port '{name}' is not present any more (unplugged?)")
            raise TransportError(
                f"only {len(matches)} port(s) named '{name}' are present now; '{endpoint_id}' refers to position {ordinal + 1}"
            )
        return matches[ordinal]

    def open_output(self, endpoint_id: str) -> None:
        lib = self._lib()
        with self._lock:
            if endpoint_id in self._outs:
                return
            _, name, _ = parse_endpoint_id(endpoint_id)
            mo = lib.MidiOut()
            try:
                mo.open_port(self._index(list(mo.get_ports()), endpoint_id))
            except TransportError:
                del mo
                raise
            except Exception as e:
                del mo
                text = str(e)
                if _busy(text):
                    raise PortBusyError(
                        f"'{name}' could not be opened: another application (an editor such as Morningstar, Nixie or Neuro) "
                        f"probably owns it. Close it there, then try again. ({text})"
                    ) from e
                raise TransportError(f"could not open '{name}': {text}") from e
            self._outs[endpoint_id] = mo
            self._open.outputs.add(endpoint_id)

    def open_input(self, endpoint_id: str, on_receive: ReceiveCallback) -> None:
        lib = self._lib()
        with self._lock:
            if endpoint_id in self._ins:
                return
            _, name, _ = parse_endpoint_id(endpoint_id)
            mi = lib.MidiIn()
            try:
                mi.open_port(self._index(list(mi.get_ports()), endpoint_id))
            except TransportError:
                del mi
                raise
            except Exception as e:
                del mi
                raise PortBusyError(f"'{name}' could not be opened for input: {e}") from e
            # Read-only observation: ignore SysEx, timing and active sensing so they never reach us.
            mi.ignore_types(sysex=True, timing=True, active_sense=True)

            def _cb(event, _data=None, _eid=endpoint_id):
                try:
                    on_receive(_eid, bytes(event[0]))
                except Exception:
                    pass  # never let a callback error propagate into the driver thread

            mi.set_callback(_cb)
            self._ins[endpoint_id] = mi
            self._open.inputs[endpoint_id] = on_receive

    def close(self, endpoint_id: str) -> None:
        with self._lock:
            mo = self._outs.pop(endpoint_id, None)
            if mo is not None:
                try:
                    mo.close_port()
                except Exception:
                    pass
                del mo
            mi = self._ins.pop(endpoint_id, None)
            if mi is not None:
                try:
                    mi.cancel_callback()
                    mi.close_port()
                except Exception:
                    pass
                del mi
            self._open.outputs.discard(endpoint_id)
            self._open.inputs.pop(endpoint_id, None)

    def close_all(self) -> None:
        for eid in list(self._outs) + list(self._ins):
            self.close(eid)

    def is_open(self, endpoint_id: str) -> bool:
        with self._lock:
            return endpoint_id in self._outs or endpoint_id in self._ins

    def send(self, endpoint_id: str, data: bytes) -> None:
        with self._lock:
            mo = self._outs.get(endpoint_id)
            if mo is None:
                raise TransportError(f"'{endpoint_id}' is not open for output")
            try:
                mo.send_message(list(data))
            except Exception as e:
                raise TransportError(f"send on '{endpoint_id}' failed: {e}") from e
            self._record(endpoint_id, data)
