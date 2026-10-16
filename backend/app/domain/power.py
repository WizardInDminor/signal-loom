"""Power planning: what each supply outlet provides, what hangs off it, and what is left.

The physical facts stay where they already live: an outlet is a ``PortDef`` with ``supply_*``
fields, a device's need is its profile's ``PowerSpec``, and an assignment *is* a typed power
``Connection`` from the outlet to the device's power inlet. This module only reads them and
derives the plan the UI shows; it never keeps a second allocation model.

Every current figure is a documented rating or a documented minimum requirement, not a
measurement. Capacities of separate outlets are never pooled: an outlet either carries its
devices or it does not.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..models.common import Polarity, PortDirection, SignalKind
from ..models.profile import DeviceProfile, PortDef, PowerSpec
from ..models.rig import DeviceInstance

EXPANSION_ROLE = "expansion_out"
CURRENT_NOTE = (
    "Current figures are documented outlet ratings and documented minimum requirements, not "
    "measured draw. Passing these checks does not make an installation safe; verify against the manuals."
)


def is_outlet(port: PortDef) -> bool:
    return port.kind == SignalKind.POWER and port.direction == PortDirection.OUT


def is_inlet(port: PortDef) -> bool:
    return port.kind == SignalKind.POWER and port.direction == PortDirection.IN


@dataclass
class Outlet:
    """One power outlet as it is set up in this rig."""

    port: PortDef
    voltage_v: float | None
    current_ma_max: int | None
    polarity: Polarity | None
    ac_dc: str | None
    selectable: bool
    selected_voltage_v: float | None  # the rig's choice, None when fixed or left at default
    setting_valid: bool  # False when the rig's choice is not one of the outlet's options
    expansion: bool
    isolated: bool | None
    shared_group: str | None

    def as_dict(self) -> dict:
        return {
            "port_id": self.port.id,
            "label": self.port.label,
            "voltage_v": self.voltage_v,
            "current_ma_max": self.current_ma_max,
            "polarity": self.polarity.value if self.polarity else None,
            "ac_dc": self.ac_dc,
            "connector": self.port.connector.value,
            "selectable": self.selectable,
            "options": [
                {"voltage_v": o.voltage_v, "current_ma_max": o.current_ma_max} for o in self.port.supply_options
            ],
            "selected_voltage_v": self.selected_voltage_v,
            "setting_valid": self.setting_valid,
            "expansion": self.expansion,
            "isolated": self.isolated,
            "shared_group": self.shared_group,
            "evidence": self.port.evidence.value if self.port.evidence else None,
        }


def effective_outlet(port: PortDef, inst: DeviceInstance) -> Outlet:
    """The outlet's voltage and capacity after the rig's setting is applied.

    A fixed outlet is what the profile says. A selectable outlet defaults to the profile's
    ``supply_voltage_v``/``supply_current_ma_max``; a rig setting that matches one of the options
    replaces both (capacity follows voltage). A setting that matches nothing is reported invalid
    and the default is used, so the plan never shows an invented capacity."""
    options = port.supply_options
    selected = inst.supply_settings.get(port.id)
    voltage, current = port.supply_voltage_v, port.supply_current_ma_max
    valid = True
    if selected is not None:
        match = next((o for o in options if abs(o.voltage_v - selected) < 0.01), None)
        if match is None and not (voltage is not None and abs(voltage - selected) < 0.01):
            valid = False
        elif match is not None:
            voltage, current = match.voltage_v, match.current_ma_max
    return Outlet(
        port=port,
        voltage_v=voltage,
        current_ma_max=current,
        polarity=port.supply_polarity,
        ac_dc=port.supply_ac_dc
        or ("dc" if port.supply_polarity in (Polarity.CENTER_NEGATIVE, Polarity.CENTER_POSITIVE) else None),
        selectable=bool(options),
        selected_voltage_v=selected,
        setting_valid=valid,
        expansion=port.role == EXPANSION_ROLE,
        isolated=port.supply_isolated,
        shared_group=port.supply_shared_group,
    )


def voltage_accepted(need: PowerSpec, voltage_v: float) -> bool:
    """Is the outlet's voltage within what the device documents (a point or a range)?"""
    if need.voltage_v is None:
        return True
    hi = need.voltage_max_v if need.voltage_max_v is not None else need.voltage_v
    return need.voltage_v - 0.01 <= voltage_v <= hi + 0.01


def requirement_dict(inst: DeviceInstance, prof: DeviceProfile | None) -> dict:
    need = prof.power if prof else None
    return {
        "instance_id": inst.id,
        "label": inst.label,
        "surface": inst.mount,
        "voltage_v": need.voltage_v if need else None,
        "voltage_max_v": need.voltage_max_v if need else None,
        "polarity": need.polarity.value if need else None,
        "ac_dc": need.ac_dc if need else None,
        "current_ma_min": need.current_ma_min if need else None,
        "requirement_known": bool(need and need.voltage_v is not None),
        "current_known": bool(need and need.current_ma_min is not None),
        "evidence": need.evidence.value if need else None,
    }


@dataclass
class OutletLoad:
    outlet: Outlet
    connections: list = field(default_factory=list)  # ResolvedConnection
    required_known_ma: int = 0
    unknown_count: int = 0

    @property
    def remaining_ma(self) -> int | None:
        if self.outlet.current_ma_max is None or self.unknown_count:
            return None
        return self.outlet.current_ma_max - self.required_known_ma


def outlet_loads(ctx) -> dict[str, OutletLoad]:
    """Every outlet in the rig (used or not) with the devices cabled to it, keyed instance:port."""
    loads: dict[str, OutletLoad] = {}
    for inst in ctx.instances.values():
        for port in ctx.ports[inst.id].values():
            if is_outlet(port):
                loads[f"{inst.id}:{port.id}"] = OutletLoad(outlet=effective_outlet(port, inst))
    for rc in ctx.resolved:
        if rc.connection.kind != SignalKind.POWER:
            continue
        key = f"{rc.source.instance.id}:{rc.source.port.id}"
        load = loads.get(key)
        if load is None:
            continue
        load.connections.append(rc)
        need = rc.target.profile.power if rc.target.profile else None
        if need is not None and need.current_ma_min is not None:
            load.required_known_ma += need.current_ma_min
        else:
            load.unknown_count += 1
    return loads


def power_plan(ctx, diagnostics) -> dict:
    """The planner view: supplies with their outlets and loads, devices still unpowered, devices
    whose requirement is not documented. Statuses come from the wiring diagnostics so the plan and
    the diagnostics list never disagree."""
    by_conn: dict[str, list] = {}
    for d in diagnostics:
        if d.subject_type == "connection" and d.subject_id:
            by_conn.setdefault(d.subject_id, []).append(d)
            for rid in d.related_ids:
                if rid.startswith("conn"):
                    by_conn.setdefault(rid, []).append(d)
    loads = outlet_loads(ctx)
    supplies = []
    for inst in ctx.instances.values():
        outlets = [p for p in ctx.ports[inst.id].values() if is_outlet(p)]
        if not outlets:
            continue
        prof = ctx.profile_of(inst)
        rows = []
        for port in outlets:
            load = loads[f"{inst.id}:{port.id}"]
            issues: dict[str, str] = {}
            for rc in load.connections:
                for d in by_conn.get(rc.connection.id, []):
                    if d.code.startswith("power.") or d.code == "connection.power_daisy_chain":
                        issues[d.code] = d.severity.value
            assigned = []
            for rc in load.connections:
                req = requirement_dict(rc.target.instance, rc.target.profile)
                req["connection_id"] = rc.connection.id
                req["port_id"] = rc.target.port.id
                assigned.append(req)
            sev = set(issues.values())
            # error > unknown (an undocumented requirement can never be approved) > warning > ok.
            if load.outlet.expansion:
                status = "expansion"
            elif "error" in sev:
                status = "error"
            elif not load.connections:
                status = "unused"
            elif load.unknown_count:
                status = "unknown"
            elif "warning" in sev:
                status = "warning"
            else:
                status = "ok"
            rows.append(
                {
                    **load.outlet.as_dict(),
                    "assigned": assigned,
                    "required_known_ma": load.required_known_ma,
                    "unknown_count": load.unknown_count,
                    "remaining_ma": load.remaining_ma,
                    "status": status,
                    "issues": issues,
                }
            )
        supplies.append(
            {
                "instance_id": inst.id,
                "label": inst.label,
                "profile": prof.display_name if prof else inst.profile_id,
                "surface": inst.mount,
                "evidence": prof.provenance.evidence.value if prof else None,
                "outputs": rows,
            }
        )
    powered = {rc.target.instance.id for rc in ctx.resolved if rc.connection.kind == SignalKind.POWER}
    consumers = []
    for inst in ctx.instances.values():
        inlets = [p for p in ctx.ports[inst.id].values() if is_inlet(p)]
        if not inlets:
            continue
        req = requirement_dict(inst, ctx.profile_of(inst))
        req["inlet_port_id"] = inlets[0].id
        req["powered"] = inst.id in powered
        consumers.append(req)
    return {
        "supplies": supplies,
        "consumers": consumers,
        "unpowered": [c["instance_id"] for c in consumers if not c["powered"]],
        "unknown_requirements": [
            c["instance_id"] for c in consumers if not c["requirement_known"] or not c["current_known"]
        ],
        "note": CURRENT_NOTE,
    }
