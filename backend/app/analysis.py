"""One entry point that turns a rig into everything the UI needs to show: diagnostics,
placed ports, ML10X topology and the compiled plan."""

from __future__ import annotations

from .domain.cables import cable_kit
from .domain.compiler import compile_rig
from .domain.geometry import board_diagnostics, effective_ports, placed_ports, rotated_size
from .domain.ml10x import loop_occupancy, preset_diagnostics
from .domain.paths import trace_preset
from .domain.wiring import wiring_diagnostics
from .models.common import DeviceCategory, Diagnostic, Severity
from .models.profile import DeviceProfile
from .models.rig import Rig


def analyze(rig: Rig, profiles: dict[str, DeviceProfile]) -> dict:
    board = board_diagnostics(rig, profiles)
    ctx, wiring = wiring_diagnostics(rig, profiles)
    ml10x_topo = None
    ml10x_diags: list[Diagnostic] = []
    preset_paths: list[dict] = []
    ml = rig.controllers.ml10x
    ml_inst = rig.instance(ml.instance_id) if ml.instance_id else None
    if ml_inst is not None:
        topo = loop_occupancy(ctx, ml_inst)
        ml10x_diags.extend(topo.diagnostics)
        for p in sorted(ml.presets, key=lambda x: x.number):
            ml10x_diags.extend(preset_diagnostics(topo, p, ml.firmware_version))
            traced = trace_preset(topo, p)
            ml10x_diags.extend(traced.pop("diagnostics"))
            preset_paths.append(traced)
        ml10x_topo = {
            "instance_id": topo.instance_id,
            "label": topo.label,
            "input_cabled": topo.input_cabled,
            "output_cabled": topo.output_cabled,
            "stereo_pairs": [{"tip": a, "ring": b, "label": lbl} for a, b, lbl in topo.stereo_pairs],
            "loops": [
                {
                    "loop": lp.loop,
                    "name": lp.name,
                    "send_to": lp.send_to_label,
                    "send_to_instance_id": lp.send_to_instance_id,
                    "return_from": lp.return_from_label,
                    "return_from_instance_id": lp.return_from_instance_id,
                    "complete": lp.complete,
                    "occupied": lp.occupied,
                }
                for lp in topo.loops
            ],
        }
    elif any(
        profiles.get(i.profile_id) and profiles[i.profile_id].category == DeviceCategory.SWITCHER for i in rig.instances
    ):
        ml10x_diags.append(
            Diagnostic(
                code="ml10x.instance_unassigned",
                severity=Severity.INFO,
                message="A switcher is on the board but not assigned as the ML10X in controller settings.",
                subject_type="rig",
            )
        )
    # MIDI channel collisions among devices reachable from the MC8.
    chan: dict[int, list[str]] = {}
    for inst in rig.instances:
        prof = profiles.get(inst.profile_id)
        if prof and prof.midi.interfaces and inst.id != rig.controllers.mc8.instance_id:
            ch = inst.midi_channel if inst.midi_channel is not None else prof.midi.default_channel
            if ch is not None:
                chan.setdefault(ch, []).append(inst.label)
    midi_diags = [
        Diagnostic(
            code="midi.channel_shared",
            severity=Severity.WARNING,
            message=f"MIDI channel {ch} is shared by {', '.join(labels)}; a PC or CC meant for one will also reach the other(s) on the same MIDI chain.",
            subject_type="rig",
        )
        for ch, labels in chan.items()
        if len(labels) > 1
    ]
    kit, kit_diags = cable_kit(ctx)
    compiled = compile_rig(rig, profiles, ctx)
    placed = {}
    for inst in rig.instances:
        prof = profiles.get(inst.profile_id)
        w, h, placeholder = rotated_size(prof, inst.rotation)
        placed[inst.id] = {
            "width_mm": w,
            "height_mm": h,
            "placeholder": placeholder,
            "ports": [
                {
                    "port_id": pp.port.id,
                    "label": pp.port.label,
                    "kind": pp.port.kind.value,
                    "direction": pp.port.direction.value,
                    "x_mm": round(pp.x_mm, 2),
                    "y_mm": round(pp.y_mm, 2),
                    "edge": pp.edge.value,
                    "estimated": pp.estimated,
                    "plug_clearance_mm": pp.port.plug_clearance_mm,
                    "role": pp.port.role,
                    "loop": pp.port.loop,
                }
                for pp in placed_ports(inst, prof)
            ],
            "effective_ports": [p.model_dump(mode="json") for p in effective_ports(inst, prof)],
            "unknowns": prof.unknowns() if prof else ["profile missing"],
        }
    all_diags = board + wiring + ml10x_diags + midi_diags + kit_diags
    return {
        "rig_id": rig.id,
        "diagnostics": [d.model_dump(mode="json") for d in all_diags],
        "summary": {
            "errors": sum(1 for d in all_diags if d.severity == Severity.ERROR),
            "warnings": sum(1 for d in all_diags if d.severity == Severity.WARNING),
            "infos": sum(1 for d in all_diags if d.severity == Severity.INFO),
        },
        "board": [d.model_dump(mode="json") for d in board],
        "wiring": [d.model_dump(mode="json") for d in wiring],
        "ml10x": {
            "topology": ml10x_topo,
            "diagnostics": [d.model_dump(mode="json") for d in ml10x_diags],
            "preset_paths": preset_paths,
        },
        "cable_kit": [i.as_dict() for i in kit],
        "instances": placed,
        "compiled": compiled,
    }
