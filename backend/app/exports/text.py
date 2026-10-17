"""Human-readable configuration package: wiring manifest, scene/action report, MC8 switch map."""

from __future__ import annotations

import csv
import io

from ..domain.cables import cable_kit
from ..domain.geometry import effective_ports
from ..domain.ml10x import Ml10xTopology, loop_occupancy, preset_path
from ..domain.paths import trace_preset
from ..domain.wiring import WiringContext
from ..models.common import SignalKind
from ..models.profile import DeviceProfile
from ..models.rig import Rig
from ..morningstar import specs

SURFACE_WORD = {"top": "the top of the board", "underside": "under the board", "off_board": "off the board"}
SURFACE_SHORT = {"top": "top", "underside": "underside", "off_board": "off-board"}


def _port_label(rig: Rig, profiles: dict[str, DeviceProfile], ref) -> tuple[str, str]:
    inst = rig.instance(ref.instance_id)
    if inst is None:
        return (ref.instance_id, ref.port_id)
    ports = {p.id: p for p in effective_ports(inst, profiles.get(inst.profile_id))}
    p = ports.get(ref.port_id)
    return (inst.label, p.label if p else ref.port_id)


def wiring_manifest_rows(rig: Rig, profiles: dict[str, DeviceProfile]) -> list[dict]:
    rows = []
    for i, c in enumerate(rig.connections, start=1):
        si, sp = _port_label(rig, profiles, c.source)
        ti, tp = _port_label(rig, profiles, c.target)
        a, b = rig.instance(c.source.instance_id), rig.instance(c.target.instance_id)
        sa, sb = (a.mount if a else "top"), (b.mount if b else "top")
        notes = c.notes or ""
        if sa != sb and "off_board" not in (sa, sb):
            # Where the cable passes through or around the board is not known; say that it must.
            notes = (
                notes + " " if notes else ""
            ) + f"Crosses from {SURFACE_WORD[sa]} to {SURFACE_WORD[sb]} (route not modelled)."
        rows.append(
            {
                "n": i,
                "kind": c.kind.value,
                "from_device": si,
                "from_port": sp,
                "to_device": ti,
                "to_port": tp,
                "label": c.label or "",
                "cable_length_cm": c.cable_length_cm if c.cable_length_cm is not None else "",
                "connector_style": c.connector_style or "",
                "intentional": "yes" if c.intentional else "",
                "notes": notes,
                "from_surface": sa,
                "to_surface": sb,
                "connection_id": c.id,
            }
        )
    return rows


def wiring_manifest_csv(rig: Rig, profiles: dict[str, DeviceProfile]) -> str:
    rows = wiring_manifest_rows(rig, profiles)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()) if rows else ["n"])
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def wiring_manifest_markdown(
    rig: Rig, profiles: dict[str, DeviceProfile], ctx: WiringContext, diagnostics: list
) -> str:
    out = [
        f"# Wiring manifest — {rig.name}",
        "",
        f"Board: {rig.board.name} ({rig.board.width_mm:g} x {rig.board.depth_mm:g} mm)",
        "",
    ]
    out.append("## Devices")
    out.append("")
    out.append("| Label | Profile | Mounted | Position (mm) | Rotation | MIDI ch | Footprint (mm) | Unknowns |")
    out.append("|---|---|---|---|---|---|---|---|")
    for inst in rig.instances:
        prof = profiles.get(inst.profile_id)
        fp = "?"
        if prof and prof.footprint.width.value_mm and prof.footprint.depth.value_mm:
            fp = f"{prof.footprint.width.value_mm:g} x {prof.footprint.depth.value_mm:g} ({prof.footprint.width.evidence.value})"
        unknowns = ", ".join(prof.unknowns()) if prof else "profile missing"
        pos = "-" if inst.mount == "off_board" else f"{inst.x_mm:g}, {inst.y_mm:g}"
        out.append(
            f"| {inst.label} | {prof.display_name if prof else inst.profile_id} | {SURFACE_SHORT[inst.mount]} | {pos} | {inst.rotation}° | {inst.midi_channel or '-'} | {fp} | {unknowns or '-'} |"
        )
    out.append("")
    for kind in (SignalKind.AUDIO, SignalKind.MIDI, SignalKind.EXPRESSION, SignalKind.POWER, SignalKind.USB):
        rows = [r for r in wiring_manifest_rows(rig, profiles) if r["kind"] == kind.value]
        if not rows:
            continue
        out.append(f"## {kind.value.capitalize()} cables ({len(rows)})")
        out.append("")
        out.append("| # | From | To | Label | Length (cm) | Plug | Notes |")
        out.append("|---|---|---|---|---|---|---|")
        for r in rows:
            out.append(
                f"| {r['n']} | {r['from_device']}: {r['from_port']} | {r['to_device']}: {r['to_port']} | {r['label']} | {r['cable_length_cm']} | {r['connector_style']} | {r['notes']} |"
            )
        out.append("")
    # Ports left open
    used = {c.source.key() for c in rig.connections} | {c.target.key() for c in rig.connections}
    open_ports = []
    for inst in rig.instances:
        for p in effective_ports(inst, profiles.get(inst.profile_id)):
            if f"{inst.id}:{p.id}" not in used:
                open_ports.append(f"{inst.label}: {p.label} ({p.kind.value} {p.direction.value})")
    if open_ports:
        out.append("## Unconnected ports")
        out.append("")
        out.extend(f"- {s}" for s in open_ports)
        out.append("")
    sw = [i for i in rig.instances if ctx.category_of(i).value == "switcher"]
    for s in sw:
        topo: Ml10xTopology = loop_occupancy(ctx, s)
        out.append(f"## {s.label} loop occupancy (from cables)")
        out.append("")
        out.append("| Loop | Jack | Send feeds | Return from | Complete |")
        out.append("|---|---|---|---|---|")
        for lp in topo.loops:
            out.append(
                f"| {lp.loop} | {lp.name} | {lp.send_to_label or '-'} | {lp.return_from_label or '-'} | {'yes' if lp.complete else ('NO' if lp.occupied else '-')} |"
            )
        out.append("")
        if rig.controllers.ml10x.presets:
            out.append(f"## {s.label} presets (virtual routing)")
            out.append("")
            for p in sorted(rig.controllers.ml10x.presets, key=lambda p: p.number):
                byp = f" (bypassed: {', '.join(map(str, p.bypassed_loops))})" if p.bypassed_loops else ""
                out.append(f"- Preset {p.number} '{p.name}' [{p.mode}]: {' -> '.join(preset_path(p))}{byp}")
                traced = trace_preset(topo, p)
                for path in traced["paths"]:
                    out.append(f"  - {path['name']}: {path['summary']}{'' if path['complete'] else '  (INCOMPLETE)'}")
            out.append("")
    kit, _ = cable_kit(ctx)
    if kit:
        out.append("## Cable kit (physical cables to make or buy)")
        out.append("")
        out.append("| # | Cable | Ends | Length (cm) | Notes |")
        out.append("|---|---|---|---|---|")
        for i, item in enumerate(kit, start=1):
            length = "" if item.length_cm is None else f"{item.length_cm:g}"
            out.append(f"| {i} | {item.description} | {'; '.join(item.ends)} | {length} | {' '.join(item.notes)} |")
        out.append("")
    if diagnostics:
        out.append("## Diagnostics")
        out.append("")
        for d in diagnostics:
            out.append(f"- **{d.severity.value.upper()}** `{d.code}`: {d.message}")
        out.append("")
    return "\n".join(out)


def scene_report_markdown(rig: Rig, compiled: dict) -> str:
    out = [f"# Scene and action report — {rig.name}", ""]
    out.append(
        f"MC8 firmware assumed: {compiled['mc8']['firmware_assumed']}. ML10X firmware assumed: {rig.controllers.ml10x.firmware_version or 'not set'}."
    )
    out.append(
        "The MIDI below is what the original MC8 is intended to send, compiled from the saved scene values; "
        "it is not a record of what any device has been observed to do."
    )
    out.append("")
    for sp in compiled["scenes"]:
        scene = rig.scene(sp["scene_id"])
        out.append(
            f"## {sp['scene_name']}"
            + (f" ({scene.song} / {scene.section})" if scene and (scene.song or scene.section) else "")
        )
        out.append("")
        if scene:
            out.append("**Desired state**")
            out.append("")
            if scene.ml10x.preset_number is not None:
                out.append(
                    f"- ML10X preset {scene.ml10x.preset_number}"
                    + (f", loops: {scene.ml10x.loop_states}" if scene.ml10x.loop_states else "")
                )
            for st in scene.device_states:
                inst = rig.instance(st.instance_id)
                bits = []
                if st.program is not None:
                    pc_text = f"PC {st.program.pc}" + (
                        f" bank {st.program.bank_msb}/{st.program.bank_lsb}"
                        if st.program.bank_msb is not None or st.program.bank_lsb is not None
                        else ""
                    )
                    if st.program.command is not None:
                        pc_text = f"'{st.program.command.name}' ({pc_text})"
                    bits.append(pc_text)
                if st.enabled is not None:
                    bits.append("engaged" if st.enabled else "bypassed")
                for c in st.cc_values:
                    cc_text = f"CC{c.cc}={c.value}"
                    if c.command is not None:
                        meaning = f" {c.command.value_label}" if c.command.value_label else ""
                        cc_text = f"'{c.command.name}'{meaning} ({cc_text})"
                    bits.append(cc_text)
                if st.manual_note:
                    bits.append(f"note: {st.manual_note}")
                out.append(f"- {inst.label if inst else st.instance_id}: {', '.join(bits) or 'no change'}")
            out.append("")
        out.append(f"**Compiled MIDI ({sp['message_count']} messages, in order)**")
        out.append("")
        out.append("| # | Target | Ch | Type | Number | Value | Why |")
        out.append("|---|---|---|---|---|---|---|")
        for i, m in enumerate(sp["messages"], start=1):
            out.append(
                f"| {i} | {m['target_label']} | {m['channel']} | {m['type'].upper()} | {m['number']} | {'' if m['value'] is None else m['value']} | {m['explanation']} |"
            )
        out.append("")
        if sp["manual_steps"]:
            out.append("**Manual steps**")
            out.append("")
            out.extend(f"- {s}" for s in sp["manual_steps"])
            out.append("")
        if sp["diagnostics"]:
            out.append("**Diagnostics**")
            out.append("")
            out.extend(f"- {d['severity'].upper()} `{d['code']}`: {d['message']}" for d in sp["diagnostics"])
            out.append("")
    return "\n".join(out)


def mc8_switch_map_csv(compiled: dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "bank",
            "bank_name",
            "position",
            "short_name",
            "scene",
            "action",
            "msg_index",
            "target",
            "channel",
            "type",
            "number",
            "value",
            "explanation",
        ]
    )
    for b in compiled["mc8"]["banks"]:
        for s in b["switches"]:
            if not s["messages"]:
                w.writerow(
                    [
                        b["number"],
                        b["name"],
                        s["position"],
                        s["short_name"],
                        s["scene_name"] or "",
                        s["action"],
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "(no messages)",
                    ]
                )
            for i, m in enumerate(s["messages"], start=1):
                w.writerow(
                    [
                        b["number"],
                        b["name"],
                        s["position"],
                        s["short_name"],
                        s["scene_name"] or "",
                        s["action"],
                        i,
                        m["target_label"],
                        m["channel"],
                        m["type"].upper(),
                        m["number"],
                        "" if m["value"] is None else m["value"],
                        m["explanation"],
                    ]
                )
    return buf.getvalue()


def mc8_switch_map_markdown(rig: Rig, compiled: dict) -> str:
    out = [
        f"# MC8 switch map — {rig.name}",
        "",
        f"Limits: {specs.MC8_BANKS} banks, {specs.MC8_SWITCH_PRESETS_PER_BANK} presets per bank (A-H page 1, I-P page 2, Q-V aux only), {specs.MC8_MESSAGES_PER_PRESET} messages per preset.",
        "",
    ]
    for b in compiled["mc8"]["banks"]:
        out.append(f"## Bank {b['number']}: {b['name']}")
        out.append("")
        for s in b["switches"]:
            out.append(
                f"### {s['position']} — {s['short_name'] or '(unnamed)'}  [{s['action']}]  {s['message_count']}/{s['message_limit']} messages"
            )
            if s["scene_name"]:
                out.append(f"Scene: {s['scene_name']}")
            out.append("")
            for i, m in enumerate(s["messages"], start=1):
                out.append(f"{i}. {m['summary']} — {m['explanation']}")
            for st in s["manual_steps"]:
                out.append(f"- Manual: {st}")
            for d in s["diagnostics"]:
                out.append(f"- {d['severity'].upper()} `{d['code']}`: {d['message']}")
            out.append("")
    return "\n".join(out)
