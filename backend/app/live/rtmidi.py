"""Real MIDI backend on top of ``python-rtmidi`` (optional dependency, ``pip install -e ".[live]"``).

Status: **written against the python-rtmidi API, not exercised on hardware in this repository.**
The build sandbox has no MIDI devices and cannot compile the library, so this module is guarded:
when the import fails the transport reports itself unavailable with the reason, and nothing in
Signal Loom substitutes the virtual transport for it silently. Port names are whatever the OS
reports (``Morningstar MC8 1`` on Windows); they are workstation-local by nature.

What the user should expect on Windows: the class-compliant USB MIDI driver lets one process own a
port at a time. If the Morningstar editor, Nixie or Neuro has the port, ``open_output`` raises
``PortBusyError`` with that explanation; closing it there (or releasing it here) is the remedy.
"""

from __future__ import annotations

import threading

from .transport import EndpointInfo, OpenState, PortBusyError, ReceiveCallback, RecordingMixin, TransportError

try:  # pragma: no cover - exercised only where the library is installed
    import rtmidi as _rtmidi

    _IMPORT_ERROR: str | None = None
except Exception as e:  # ImportError or a native load failure
    _rtmidi = None
    _IMPORT_ERROR = f"{type(e).__name__}: {e}"


class RtMidiTransport(RecordingMixin):
    kind = "rtmidi"

    def __init__(self) -> None:
        super().__init__()
        self._outs: dict[str, object] = {}
        self._ins: dict[str, object] = {}
        self._open = OpenState()
        self._cb_lock = threading.Lock()

    def available(self) -> tuple[bool, str | None]:
        if _rtmidi is None:
            return False, f'python-rtmidi is not installed ({_IMPORT_ERROR}); install with: pip install -e ".[live]"'
        return True, None

    @staticmethod
    def _id(direction: str, name: str) -> str:
        return f"rtmidi:{direction}:{name}"

    def enumerate(self) -> list[EndpointInfo]:  # pragma: no cover - needs the native library
        if _rtmidi is None:
            return []
        out: list[EndpointInfo] = []
        try:
            mo = _rtmidi.MidiOut()
            for name in mo.get_ports():
                out.append(EndpointInfo(self._id("out", name), name, "out", "rtmidi"))
            del mo
            mi = _rtmidi.MidiIn()
            for name in mi.get_ports():
                out.append(EndpointInfo(self._id("in", name), name, "in", "rtmidi"))
            del mi
        except Exception as e:
            raise TransportError(f"MIDI enumeration failed: {e}") from e
        return out

    @staticmethod
    def _index(ports: list[str], name: str) -> int:
        try:
            return ports.index(name)
        except ValueError as e:
            raise TransportError(f"MIDI port '{name}' is not present any more (unplugged?)") from e

    def open_output(self, endpoint_id: str) -> None:  # pragma: no cover - needs the native library
        if _rtmidi is None:
            raise TransportError("python-rtmidi is not installed")
        with self._lock:
            if endpoint_id in self._outs:
                return
            name = endpoint_id.split(":", 2)[2]
            mo = _rtmidi.MidiOut()
            try:
                mo.open_port(self._index(mo.get_ports(), name))
            except Exception as e:
                del mo
                text = str(e)
                if "busy" in text.lower() or "in use" in text.lower() or "could not open" in text.lower():
                    raise PortBusyError(
                        f"'{name}' could not be opened: another application (an editor such as Morningstar, Nixie or Neuro) "
                        f"probably owns it. Close it there, then try again. ({text})"
                    ) from e
                raise TransportError(f"could not open '{name}': {text}") from e
            self._outs[endpoint_id] = mo
            self._open.outputs.add(endpoint_id)

    def open_input(self, endpoint_id: str, on_receive: ReceiveCallback) -> None:  # pragma: no cover
        if _rtmidi is None:
            raise TransportError("python-rtmidi is not installed")
        with self._lock:
            if endpoint_id in self._ins:
                return
            name = endpoint_id.split(":", 2)[2]
            mi = _rtmidi.MidiIn()
            try:
                mi.open_port(self._index(mi.get_ports(), name))
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

    def close(self, endpoint_id: str) -> None:  # pragma: no cover
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

    def send(self, endpoint_id: str, data: bytes) -> None:  # pragma: no cover
        with self._lock:
            mo = self._outs.get(endpoint_id)
            if mo is None:
                raise TransportError(f"'{endpoint_id}' is not open for output")
            try:
                mo.send_message(list(data))
            except Exception as e:
                raise TransportError(f"send on '{endpoint_id}' failed: {e}") from e
            self._record(endpoint_id, data)
