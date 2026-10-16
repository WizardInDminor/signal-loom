"use client";

import { useState } from "react";
import { useRigStore } from "@/store/rigStore";
import type { DeviceInstance, Edge, PortDef, PortDirection, SignalKind } from "@/lib/types";
import { AUDIO_CHANNELS, CONNECTORS, MIDI_TRS_TYPES, TRS_ROLES } from "@/lib/types";
import { Badge, Button, Field } from "@/components/ui/basics";

const KINDS: SignalKind[] = ["audio", "midi", "expression", "power", "usb"];
const DIRS: PortDirection[] = ["in", "out", "bidirectional"];
const EDGES: Edge[] = ["top", "bottom", "left", "right", "top_face"];

export function PortEditor({ inst }: { inst: DeviceInstance }) {
  const { analysis, profiles, update } = useRigStore();
  const [editing, setEditing] = useState<PortDef | null>(null);
  const ports = analysis?.instances[inst.id]?.effective_ports ?? [];
  const profile = profiles[inst.profile_id];
  const overridden = new Set(inst.port_overrides.map((p) => p.id));
  const fromProfile = new Set(profile?.ports.map((p) => p.id) ?? []);

  const save = () => {
    if (!editing) return;
    const port = { ...editing, position_evidence: "user" as const };
    update((r) => {
      const k = r.instances.find((x) => x.id === inst.id)!;
      const idx = k.port_overrides.findIndex((p) => p.id === port.id);
      if (idx >= 0) k.port_overrides[idx] = port;
      else k.port_overrides.push(port);
      k.removed_port_ids = k.removed_port_ids.filter((id) => id !== port.id);
    });
    setEditing(null);
  };
  const remove = (id: string) =>
    update((r) => {
      const k = r.instances.find((x) => x.id === inst.id)!;
      k.port_overrides = k.port_overrides.filter((p) => p.id !== id);
      if (fromProfile.has(id)) k.removed_port_ids = [...new Set([...k.removed_port_ids, id])];
    });
  const reset = (id: string) =>
    update((r) => {
      const k = r.instances.find((x) => x.id === inst.id)!;
      k.port_overrides = k.port_overrides.filter((p) => p.id !== id);
    });
  const newPort = () => {
    const base = "jack";
    let n = 1;
    while (ports.some((p) => p.id === `${base}${n}`)) n++;
    setEditing({ id: `${base}${n}`, label: `Custom jack ${n}`, kind: "audio", direction: "in", connector: "ts_1_4", audio_channel: "mono", edge: "top", position: 0.5, position_evidence: "user", plug_clearance_mm: 38 });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold">Jacks ({ports.length})</h3>
        <Button onClick={newPort}>+ Add jack</Button>
      </div>
      <p className="text-[11px] text-neutral-500 mb-1">Positions are normalized 0–1 along the edge. Profile positions are estimates unless marked documented; edits here are stored on this instance only.</p>
      <table className="w-full text-[11px]">
        <thead><tr className="text-left text-neutral-500"><th>Label</th><th>Kind</th><th>Dir</th><th>Edge</th><th>Pos</th><th></th></tr></thead>
        <tbody>
          {ports.map((p) => (
            <tr key={p.id} className="border-t border-line">
              <td>{p.label}{overridden.has(p.id) && <Badge tone="ok">edited</Badge>}</td>
              <td>{p.kind}</td>
              <td>{p.direction}</td>
              <td>{p.edge}</td>
              <td>{p.position == null ? <Badge tone="bad">unknown</Badge> : <>{p.position.toFixed(2)} <span className="text-neutral-400">{p.position_evidence}</span></>}</td>
              <td className="whitespace-nowrap">
                <Button variant="ghost" onClick={() => setEditing({ ...p })} aria-label={`Edit jack ${p.label}`}>Edit</Button>
                {overridden.has(p.id) && fromProfile.has(p.id) && <Button variant="ghost" onClick={() => reset(p.id)}>Reset</Button>}
                <Button variant="ghost" onClick={() => remove(p.id)} aria-label={`Remove jack ${p.label}`}>✕</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <form className="mt-2 border border-line rounded p-2 grid grid-cols-2 gap-2 bg-neutral-50" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Field label="Id"><input value={editing.id} disabled={fromProfile.has(editing.id) || ports.some((p) => p.id === editing.id && !overridden.has(p.id))} onChange={(e) => setEditing({ ...editing, id: e.target.value.replace(/[^a-z0-9_]/gi, "_") })} /></Field>
          <Field label="Label"><input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></Field>
          <Field label="Signal"><select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as SignalKind })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field>
          <Field label="Direction"><select value={editing.direction} onChange={(e) => setEditing({ ...editing, direction: e.target.value as PortDirection })}>{DIRS.map((k) => <option key={k}>{k}</option>)}</select></Field>
          <Field label="Connector"><select value={editing.connector} onChange={(e) => setEditing({ ...editing, connector: e.target.value as PortDef["connector"] })}>{CONNECTORS.map((k) => <option key={k}>{k}</option>)}</select></Field>
          <Field label="Edge"><select value={editing.edge} onChange={(e) => setEditing({ ...editing, edge: e.target.value as Edge })}>{EDGES.map((k) => <option key={k}>{k}</option>)}</select></Field>
          <Field label="Position along edge (0–1)"><input type="number" step={0.01} min={0} max={1} value={editing.position ?? ""} onChange={(e) => setEditing({ ...editing, position: e.target.value === "" ? null : Math.min(1, Math.max(0, Number(e.target.value))) })} /></Field>
          <Field label="Plug clearance (mm)"><input type="number" min={0} value={editing.plug_clearance_mm ?? ""} onChange={(e) => setEditing({ ...editing, plug_clearance_mm: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
          {editing.kind === "audio" && (
            <>
              <Field label="Audio channel"><select value={editing.audio_channel ?? "unknown"} onChange={(e) => setEditing({ ...editing, audio_channel: e.target.value as PortDef["audio_channel"] })}>{AUDIO_CHANNELS.map((k) => <option key={k}>{k}</option>)}</select></Field>
              <Field label="TRS role"><select value={editing.trs_role ?? ""} onChange={(e) => setEditing({ ...editing, trs_role: (e.target.value || null) as PortDef["trs_role"] })}><option value="">—</option>{TRS_ROLES.map((k) => <option key={k}>{k}</option>)}</select></Field>
            </>
          )}
          {editing.kind === "midi" && (
            <Field label="TRS MIDI wiring"><select value={editing.midi_trs_type ?? "unknown"} onChange={(e) => setEditing({ ...editing, midi_trs_type: e.target.value as PortDef["midi_trs_type"] })}>{MIDI_TRS_TYPES.map((k) => <option key={k}>{k}</option>)}</select></Field>
          )}
          {editing.kind === "power" && editing.direction === "out" && (
            <>
              <Field label="Supply voltage (V)"><input type="number" step={0.5} value={editing.supply_voltage_v ?? ""} onChange={(e) => setEditing({ ...editing, supply_voltage_v: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
              <Field label="Supply polarity"><select value={editing.supply_polarity ?? "unknown"} onChange={(e) => setEditing({ ...editing, supply_polarity: e.target.value as PortDef["supply_polarity"] })}><option value="unknown">unknown</option><option value="center_negative">center negative</option><option value="center_positive">center positive</option></select></Field>
              <Field label="Max current (mA)"><input type="number" value={editing.supply_current_ma_max ?? ""} onChange={(e) => setEditing({ ...editing, supply_current_ma_max: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            </>
          )}
          <Field label="Notes"><input value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value || null })} /></Field>
          <div className="col-span-2 flex gap-2 justify-end">
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" variant="primary">Save jack</Button>
          </div>
        </form>
      )}
    </div>
  );
}
