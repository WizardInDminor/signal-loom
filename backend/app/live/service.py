"""The live service: one per process, owner of the transports, the sender, the monitor and the
simulated world. FastAPI endpoints call it; nothing else sends MIDI.

Invariants: disarmed at construction, after ``connect``, ``disconnect``, a mode switch, a bindings
change, a lost endpoint and a transport error. ``refresh`` only detects and rebinds. The virtual
transport is used only when the user selected ``virtual`` mode; an unavailable real transport is
reported, never substituted.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field

from ..db import Database
from ..domain.compiler import compile_rig, compile_scene
from ..domain.geometry import effective_ports
from ..domain.wiring import wiring_diagnostics
from ..models.common import DeviceCategory, SignalKind
from ..models.live import LiveBindings, TransportMode
from ..models.profile import DeviceProfile
from ..models.rig import Rig
from ..repo import ProfileRepository, RigRepository
from .bindings import LiveBindingsRepository
from .monitor import LiveMonitor
from .routes import RouteGraph, build_route_graph
from .rtmidi import RtMidiTransport
from .sender import LiveRefused, LiveSender, Resolved
from .transport import EndpointInfo, PortBusyError, Transport, TransportError, encode
from .virtual import VirtualPedal, VirtualTransport


@dataclass
class EndpointState:
    endpoint_id: str
    name: str
    direction: str
    open: bool = False
    busy: bool = False
    missing: bool = False
    released: bool = False
    error: str | None = None
    bound_to: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return self.__dict__.copy()


class LiveService:
    def __init__(self, db: Database):
        self.db = db
        self.bindings_repo = LiveBindingsRepository(db)
        self.virtual = VirtualTransport()
        self.rtmidi = RtMidiTransport()
        self.sender = LiveSender()
        self.monitor = LiveMonitor()
        self._lock = threading.RLock()
        self.mode: TransportMode = "virtual"
        self.connected_rig_id: str | None = None
        self._released: set[str] = set()
        self._endpoint_states: dict[str, EndpointState] = {}
        self._last_change: list[str] = []

    # -- helpers ----------------------------------------------------------------------
    def transport(self) -> Transport:
        return self.virtual if self.mode == "virtual" else self.rtmidi

    def _load(self, rig_id: str) -> tuple[Rig, dict[str, DeviceProfile]]:
        rig = RigRepository(self.db).get(rig_id)
        if rig is None:
            raise LiveRefused("live.rig_not_found", f"Rig '{rig_id}' not found.")
        profiles = ProfileRepository(self.db).get_many([i.profile_id for i in rig.instances])
        return rig, profiles

    def _virtual_endpoints(self, rig: Rig, profiles: dict[str, DeviceProfile]) -> list[EndpointInfo]:
        """One simulated USB endpoint per device whose profile lists USB MIDI; controllers also get
        a simulated input (the device talking to the computer)."""
        out: list[EndpointInfo] = []
        for inst in rig.instances:
            prof = profiles.get(inst.profile_id)
            if not prof:
                continue
            usb = next((p for p in effective_ports(inst, prof) if p.kind == SignalKind.USB), None)
            if usb is None or "usb" not in prof.midi.interfaces:
                continue
            out.append(
                EndpointInfo(f"virt:{inst.id}:out", f"Virtual USB — {inst.label}", "out", "virtual", note="simulated")
            )
            if prof.category == DeviceCategory.CONTROLLER:
                out.append(
                    EndpointInfo(
                        f"virt:{inst.id}:in",
                        f"Virtual USB — {inst.label} (to computer)",
                        "in",
                        "virtual",
                        note="simulated",
                    )
                )
        return out

    def _enumerate(
        self, rig: Rig | None = None, profiles: dict[str, DeviceProfile] | None = None
    ) -> list[EndpointInfo]:
        if self.mode == "virtual" and rig is not None and profiles is not None and self.connected_rig_id != rig.id:
            # Not connected to this rig: show what the simulation would offer for it.
            return [
                *self._virtual_endpoints(rig, profiles),
                *[e for e in self.virtual.enumerate() if e.id.startswith("virt:generic")],
            ]
        try:
            return self.transport().enumerate()
        except TransportError as e:
            self._last_change.append(str(e))
            return []

    def graph(self, rig_id: str) -> tuple[Rig, dict[str, DeviceProfile], RouteGraph]:
        rig, profiles = self._load(rig_id)
        ctx, _ = wiring_diagnostics(rig, profiles)
        bindings = self.bindings_repo.get(rig_id)
        g = build_route_graph(rig, profiles, ctx, bindings, self._enumerate(rig, profiles))
        return rig, profiles, g

    # -- status -----------------------------------------------------------------------
    def status(self) -> dict:
        with self._lock:
            rt_ok, rt_reason = self.rtmidi.available()
            return {
                "mode": self.mode,
                "transports": {
                    "virtual": {"available": True, "reason": None, "label": "Virtual (simulation, no hardware)"},
                    "rtmidi": {"available": rt_ok, "reason": rt_reason, "label": "Real MIDI ports (python-rtmidi)"},
                },
                "connected_rig_id": self.connected_rig_id,
                "endpoints": [e.as_dict() for e in self._endpoint_states.values()],
                "released": sorted(self._released),
                "notes": self._last_change[-5:],
                **self.sender.status(),
            }

    def endpoints(self, rig_id: str | None = None) -> list[dict]:
        with self._lock:
            if rig_id:
                rig, profiles = self._load(rig_id)
                return [e.as_dict() for e in self._enumerate(rig, profiles)]
            return [e.as_dict() for e in self._enumerate()]

    def set_mode(self, mode: TransportMode) -> dict:
        with self._lock:
            if mode == "rtmidi":
                ok, reason = self.rtmidi.available()
                if not ok:
                    raise LiveRefused(
                        "live.transport_unavailable",
                        f"Real MIDI ports are unavailable on this computer: {reason}. The virtual simulation is a separate, explicit choice.",
                    )
            if mode != self.mode:
                self.disconnect()
                self.mode = mode
                self._last_change.append(f"mode set to {mode}")
            return self.status()

    # -- bindings ---------------------------------------------------------------------
    def get_bindings(self, rig_id: str) -> LiveBindings:
        return self.bindings_repo.get(rig_id)

    def save_bindings(self, rig_id: str, bindings: LiveBindings) -> LiveBindings:
        with self._lock:
            bindings.rig_id = rig_id
            saved = self.bindings_repo.save(bindings)
            if self.connected_rig_id == rig_id:
                # Routes changed under a connected rig: rebuild the world and re-open, disarmed.
                self.sender.disarm("bindings changed")
                self._apply_world(rig_id)
            return saved

    def suggest_bindings(self, rig_id: str) -> LiveBindings:
        """Virtual mode only: bind each simulated USB endpoint to its device. A deliberate click."""
        rig, profiles = self._load(rig_id)
        current = self.bindings_repo.get(rig_id)
        if self.mode != "virtual":
            raise LiveRefused(
                "live.not_virtual", "Automatic suggestions exist only for the simulation; bind real ports by hand."
            )
        from ..models.live import EndpointBinding

        existing = {(b.endpoint_id, b.instance_id) for b in current.bindings}
        candidates = self._virtual_endpoints(rig, profiles)
        # Prefer the charter's reference configuration: one cable to the controller, everything
        # else reached through its forwarding and the rig's MIDI cables. Only when no controller
        # offers USB are the pedals' own simulated USB endpoints bound (the "powered hub" picture).
        controller_eps = [
            e
            for e in candidates
            if (i := rig.instance(e.id.split(":")[1]))
            and profiles.get(i.profile_id)
            and profiles[i.profile_id].category == DeviceCategory.CONTROLLER
        ]
        if controller_eps:
            candidates = controller_eps
        for e in candidates:
            inst_id = e.id.split(":")[1]
            inst = rig.instance(inst_id)
            prof = profiles.get(inst.profile_id) if inst else None
            if not inst or not prof or (e.id, inst_id) in existing:
                continue
            usb = next((p for p in effective_ports(inst, prof) if p.kind == SignalKind.USB), None)
            if usb is None:
                continue
            current.bindings.append(
                EndpointBinding(
                    endpoint_id=e.id,
                    instance_id=inst_id,
                    port_id=usb.id,
                    direction="in" if e.direction == "in" else "out",
                )
            )
        return self.save_bindings(rig_id, current)

    # -- connection ------------------------------------------------------------------------
    def _apply_world(self, rig_id: str) -> None:
        rig, profiles = self._load(rig_id)
        bindings = self.bindings_repo.get(rig_id)
        transport = self.transport()
        if self.mode == "virtual":
            endpoints = self._virtual_endpoints(rig, profiles)
            self.virtual.set_world(endpoints, {})
        ctx, _ = wiring_diagnostics(rig, profiles)
        graph = build_route_graph(rig, profiles, ctx, bindings, transport.enumerate())
        if self.mode == "virtual":
            networks: dict[str, list[VirtualPedal]] = {}
            pedals: dict[str, VirtualPedal] = {}
            for t in graph.targets.values():
                inst = rig.instance(t.instance_id)
                prof = profiles.get(inst.profile_id) if inst else None
                if inst is None or prof is None or t.channel is None:
                    continue
                for route in t.routes:
                    cov_pc, cov_cc = route.coverage["pc"], route.coverage["cc"]
                    if cov_pc.status == "unsupported" and cov_cc.status == "unsupported":
                        continue
                    pedal = pedals.get(t.instance_id)
                    if pedal is None:
                        bp = prof.midi.bypass
                        pedal = VirtualPedal(
                            instance_id=t.instance_id,
                            label=t.label,
                            channel=t.channel,
                            bypass_cc=bp.cc if bp.method == "cc" else None,
                            bypass_on=bp.on_value,
                            bypass_off=bp.off_value,
                            bypass_deterministic=bp.deterministic,
                            pc_supported=prof.midi.program_change.supported,
                        )
                        pedals[t.instance_id] = pedal
                    pedal.routes[route.endpoint_id] = "simulation_tested" if cov_pc.status == "supported" else "unknown"
                    networks.setdefault(route.endpoint_id, [])
                    if pedal not in networks[route.endpoint_id]:
                        networks[route.endpoint_id].append(pedal)
            self.virtual.set_world(endpoints, networks)
        # Open every bound endpoint (all at once; UI selection never churns ports).
        present = {e.id: e for e in transport.enumerate()}
        states: dict[str, EndpointState] = {}
        labels = {i.id: i.label for i in rig.instances}
        for b in bindings.bindings:
            st = states.setdefault(
                b.endpoint_id,
                EndpointState(
                    b.endpoint_id,
                    present[b.endpoint_id].name if b.endpoint_id in present else b.endpoint_id,
                    b.direction,
                ),
            )
            st.bound_to.append(labels.get(b.instance_id, b.instance_id))
            if b.endpoint_id not in present:
                st.missing = True
                continue
            if b.endpoint_id in self._released:
                st.released = True
                continue
            try:
                if present[b.endpoint_id].direction == "out":
                    transport.open_output(b.endpoint_id)
                else:
                    self.monitor.name_endpoint(b.endpoint_id, present[b.endpoint_id].name)
                    transport.open_input(b.endpoint_id, self.monitor.on_receive)
                st.open = True
            except PortBusyError as e:
                st.busy = True
                st.error = str(e)
            except TransportError as e:
                st.error = str(e)
        self._endpoint_states = states

    def connect(self, rig_id: str) -> dict:
        with self._lock:
            if self.connected_rig_id and self.connected_rig_id != rig_id:
                self.disconnect()
            self.sender.attach_transport(None)  # disarms + drops queue, always
            self._load(rig_id)
            self.transport().close_all()
            if self.sender.rig_id != rig_id:
                self.sender.last_sent = {}  # another rig's "last sent" says nothing about this one
            self.monitor.clear()  # observations belong to one connection session
            self.sender.rig_id = rig_id
            self._apply_world(rig_id)
            self.connected_rig_id = rig_id
            self.sender.attach_transport(self.transport())
            self._last_change.append(f"connected rig {rig_id} on {self.mode} (disarmed)")
            return self.status()

    def disconnect(self) -> dict:
        with self._lock:
            self.sender.disarm("disconnected")
            self.sender.attach_transport(None)
            try:
                self.transport().close_all()
            except TransportError:
                pass
            self._endpoint_states = {}
            self.connected_rig_id = None
            self.sender.rig_id = None
            return self.status()

    def refresh(self) -> dict:
        """Hot-plug check: detect lost/returned endpoints and rebind. Never re-arms."""
        with self._lock:
            if not self.connected_rig_id:
                return self.status()
            before = {k: (v.open, v.missing) for k, v in self._endpoint_states.items()}
            was_armed = self.sender.armed
            self._apply_world(self.connected_rig_id)
            lost = [
                k for k, v in self._endpoint_states.items() if v.missing and before.get(k, (False, False))[1] is False
            ]
            if lost and was_armed:
                self.sender.disarm(f"endpoint lost: {', '.join(lost)}")
            returned = [k for k, v in self._endpoint_states.items() if v.open and before.get(k) == (False, True)]
            if returned:
                self._last_change.append(f"rebound {', '.join(returned)} (still disarmed)")
            return self.status()

    def release(self, endpoint_id: str) -> dict:
        """Give a port to another application on purpose (e.g. the Morningstar editor)."""
        with self._lock:
            self._released.add(endpoint_id)
            if self.sender.armed:
                self.sender.disarm(f"released {endpoint_id}")
            try:
                self.transport().close(endpoint_id)
            except TransportError:
                pass
            if self.connected_rig_id:
                self._apply_world(self.connected_rig_id)
            return self.status()

    def reacquire(self, endpoint_id: str) -> dict:
        with self._lock:
            self._released.discard(endpoint_id)
            if self.connected_rig_id:
                self._apply_world(self.connected_rig_id)  # stays disarmed
            return self.status()

    # -- resolving messages -------------------------------------------------------------
    def _resolve(
        self, graph: RouteGraph, msg: dict, deterministic: bool, explanation: str, source_kind: str
    ) -> Resolved:
        t = graph.targets.get(msg["target_instance_id"])
        kind = msg["type"]
        route = t.route_for(kind) if t else None
        cov = t.coverage(kind) if t else None
        ep = graph.endpoints.get(route.endpoint_id) if route else None
        data = b""
        try:
            data = encode(kind, msg["channel"], msg["number"], msg.get("value"))
        except (ValueError, TypeError):
            pass
        return Resolved(
            type=kind,
            channel=msg["channel"],
            number=msg["number"],
            value=msg.get("value"),
            target_instance_id=msg["target_instance_id"],
            target_label=msg.get("target_label") or (t.label if t else msg["target_instance_id"]),
            endpoint_id=route.endpoint_id
            if route and cov and cov.status not in ("unsupported", "unreachable")
            else None,
            endpoint_name=ep.name if ep else None,
            data=data,
            route_status=cov.status if cov else "unreachable",
            route_evidence=cov.evidence if cov else None,
            route_reason=cov.reason if cov else "This device is not a live target.",
            deterministic=deterministic,
            explanation=explanation,
            source_kind=source_kind,
            coalesce_key=f"{msg['target_instance_id']}:cc:{msg['number']}" if kind == "cc" else None,
        )

    def resolve_scene(self, rig_id: str, scene_id: str) -> tuple[list[Resolved], dict]:
        rig, profiles, graph = self.graph(rig_id)
        scene = rig.scene(scene_id)
        if scene is None:
            raise LiveRefused("live.scene_not_found", f"Scene '{scene_id}' not found.")
        ctx, _ = wiring_diagnostics(rig, profiles)
        plan = compile_scene(rig, scene, profiles, ctx)  # the existing compiler; no second planner
        resolved = [
            self._resolve(graph, m.as_dict(), m.deterministic, m.explanation, m.source_kind) for m in plan.messages
        ]
        return resolved, plan.as_dict()

    def dry_run(self, rig_id: str, scene_id: str) -> dict:
        resolved, plan = self.resolve_scene(rig_id, scene_id)
        return {
            "scene_id": scene_id,
            "scene_name": plan["scene_name"],
            "messages": LiveSender.dry_run(resolved),
            "manual_steps": plan["manual_steps"],
            "diagnostics": plan["diagnostics"],
            "sent": False,
            "note": "Dry run: these are the exact bytes an audition would send, in this order. Nothing was transmitted.",
        }

    def _require_connected(self, rig_id: str) -> None:
        if self.connected_rig_id != rig_id:
            raise LiveRefused("live.not_connected", "Connect this rig to a transport first (then arm).")

    def audition(self, rig_id: str, scene_id: str, delay_ms: int | None, confirm_nondeterministic: bool) -> dict:
        with self._lock:
            self._require_connected(rig_id)
            resolved, plan = self.resolve_scene(rig_id, scene_id)
            delay = delay_ms if delay_ms is not None else self.bindings_repo.get(rig_id).send_delay_ms
            job, warnings = self.sender.audition(
                f"audition '{plan['scene_name']}'", resolved, delay, confirm_nondeterministic
            )
            return {
                "job": job.as_dict(),
                "warnings": warnings,
                "messages": [r.as_dict() for r in resolved],
                "delay_ms": delay,
            }

    def send(
        self,
        rig_id: str,
        instance_id: str,
        type_: str,
        number: int,
        value: int | None,
        confirm_nondeterministic: bool,
        coalesce: bool,
        label: str | None,
        deterministic: bool | None,
    ) -> dict:
        with self._lock:
            self._require_connected(rig_id)
            rig, profiles, graph = self.graph(rig_id)
            t = graph.targets.get(instance_id)
            if t is None:
                raise LiveRefused("live.not_a_target", "This device has no MIDI the live layer can address.")
            if t.channel is None:
                raise LiveRefused(
                    "live.channel_unknown", f"'{t.label}' has no MIDI channel set; set it on the instance."
                )
            det = deterministic if deterministic is not None else True
            r = self._resolve(
                graph,
                {
                    "type": type_,
                    "channel": t.channel,
                    "number": number,
                    "value": value,
                    "target_instance_id": instance_id,
                    "target_label": t.label,
                },
                det,
                label
                or f"Live panel: {type_.upper()} {number}{'' if value is None else ' = ' + str(value)} on {t.label}",
                "panel",
            )
            job, warnings = self.sender.send_one(r, confirm_nondeterministic, coalesce)
            return {"job": job.as_dict(), "warnings": warnings, "message": r.as_dict()}

    # -- panels and state categories ----------------------------------------------------------
    def panels(self, rig_id: str) -> dict:
        rig, profiles, graph = self.graph(rig_id)
        observed = self.monitor.last_per_channel()
        simulated = self.virtual.pedals() if self.mode == "virtual" and self.connected_rig_id == rig_id else {}
        out = []
        for t in graph.targets.values():
            inst = rig.instance(t.instance_id)
            prof = profiles.get(inst.profile_id) if inst else None
            if inst is None or prof is None:
                continue
            m = prof.midi
            controls: dict = {
                "program": None
                if m.program_change.supported is False
                else {
                    "min": m.program_change.min if m.program_change.min is not None else 0,
                    "max": m.program_change.max if m.program_change.max is not None else 127,
                    "display_numbering": m.program_change.display_numbering,
                    "bank_select_supported": m.program_change.bank_select_supported,
                    "supported": m.program_change.supported,
                    "evidence": m.program_change.evidence.value,
                    "note": m.program_change.note,
                },
                "bypass": {
                    "cc": m.bypass.cc,
                    "on_value": m.bypass.on_value if m.bypass.on_value is not None else 127,
                    "off_value": m.bypass.off_value if m.bypass.off_value is not None else 0,
                    "deterministic": m.bypass.deterministic,
                    "evidence": m.bypass.evidence.value,
                    "note": m.bypass.note,
                }
                if m.bypass.method == "cc" and m.bypass.cc is not None
                else None,
                "cc": [
                    {"cc": c.cc, "name": c.name, "value_semantics": c.value_semantics, "evidence": c.evidence.value}
                    for c in m.cc_map
                    if not (m.bypass.method == "cc" and c.cc == m.bypass.cc)
                ],
                "commands": [c.model_dump(mode="json") for c in m.commands],
            }
            sim = simulated.get(t.instance_id)
            out.append(
                {
                    "instance_id": t.instance_id,
                    "label": t.label,
                    "profile": prof.display_name,
                    "category": t.category,
                    "channel": t.channel,
                    "coverage": {k: t.coverage(k).as_dict() for k in ("pc", "cc")},
                    "controls": controls,
                    "last_sent": self.sender.last_sent.get(t.instance_id),
                    "observed": observed.get(t.channel) if t.channel is not None else None,
                    "simulated": sim.as_dict() if sim else None,
                }
            )
        return {"rig_id": rig_id, "mode": self.mode, "connected": self.connected_rig_id == rig_id, "panels": out}

    def follower(self, rig_id: str) -> dict:
        rig, profiles = self._load(rig_id)
        ctx, _ = wiring_diagnostics(rig, profiles)
        compiled = compile_rig(rig, profiles, ctx)
        result = self.monitor.follow(compiled["scenes"])
        inputs = [e.as_dict() for e in self._endpoint_states.values() if e.direction == "in"]
        result["inputs"] = inputs
        result["listening"] = any(i["open"] for i in inputs)
        if not result["listening"]:
            result["text"] = "No MIDI input is bound and open for this rig; nothing can be observed. " + (
                "Bind the controller's USB input to observe what it sends."
                if self.connected_rig_id == rig_id
                else "Connect the rig first."
            )
        return result

    def events(self, since_log: int = 0, since_observed: int = 0, rig_id: str | None = None) -> dict:
        return {
            "status": self.status(),
            "log": [e.as_dict() for e in self.sender.log(since_log, rig_id=rig_id)],
            "observed": [o.as_dict() for o in self.monitor.observed(since_observed)],
            "log_seq": self.sender.seq,
            "observed_seq": self.monitor.seq,
            "last_sent": self.sender.last_sent if rig_id in (None, self.sender.rig_id) else {},
            "simulated": {k: v.as_dict() for k, v in self.virtual.pedals().items()} if self.mode == "virtual" else {},
        }

    def inject(self, endpoint_id: str, type_: str, channel: int, number: int, value: int | None) -> dict:
        """Virtual mode: pretend the device on a simulated input sent this (an MC8 stomp echoing to USB)."""
        with self._lock:
            if self.mode != "virtual":
                raise LiveRefused("live.not_virtual", "Injection exists only in the simulation.")
            data = encode(type_, channel, number, value)
            delivered = self.virtual.inject(endpoint_id, data)
            if not delivered:
                raise LiveRefused(
                    "live.input_not_open", f"No open virtual input '{endpoint_id}'; bind and connect it first."
                )
            return {"delivered": True, "hex": data.hex(" ").upper()}

    def close(self) -> None:
        with self._lock:
            self.sender.close()
            for t in (self.virtual, self.rtmidi):
                try:
                    t.close_all()
                except Exception:
                    pass
