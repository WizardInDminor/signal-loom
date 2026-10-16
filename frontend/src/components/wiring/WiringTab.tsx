"use client";

import { useMemo, useState } from "react";
import { useRigStore } from "@/store/rigStore";
import type { Connection, PortDef, SignalKind } from "@/lib/types";
import { Badge, Button, DiagnosticList, Field, KIND_COLOR, Panel } from "@/components/ui/basics";
import { WiringDiagram } from "./WiringDiagram";

const KINDS: SignalKind[] = ["audio", "midi", "expression", "power", "usb"];

export function WiringTab() {
  const { rig, analysis, addConnection, removeConnection, update } = useRigStore();
  const [kind, setKind] = useState<SignalKind>("audio");
  const [srcInst, setSrcInst] = useState("");
  const [srcPort, setSrcPort] = useState("");
  const [dstInst, setDstInst] = useState("");
  const [dstPort, setDstPort] = useState("");
  const [label, setLabel] = useState("");
  const [filter, setFilter] = useState<SignalKind | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);

  const portsOf = (id: string): PortDef[] => analysis?.instances[id]?.effective_ports ?? [];
  const srcOptions = useMemo(() => portsOf(srcInst).filter((p) => p.kind === kind && p.direction !== "in"), [srcInst, kind, analysis]); // eslint-disable-line react-hooks/exhaustive-deps
  const dstOptions = useMemo(() => portsOf(dstInst).filter((p) => p.kind === kind && p.direction !== "out"), [dstInst, kind, analysis]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rig) return null;

  const used = new Set(rig.connections.flatMap((c) => [c.source.instance_id + ":" + c.source.port_id, c.target.instance_id + ":" + c.target.port_id]));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!srcInst || !srcPort || !dstInst || !dstPort) return;
    const id = addConnection({ kind, source: { instance_id: srcInst, port_id: srcPort }, target: { instance_id: dstInst, port_id: dstPort }, label: label || null });
    setSelected(id);
    setLabel("");
    setDstPort("");
  };
  const wiringDiags = analysis?.diagnostics.filter((d) => !d.code.startsWith("instance.")) ?? [];
  const conns = rig.connections.filter((c) => filter === "all" || c.kind === filter);
  const sel = rig.connections.find((c) => c.id === selected);
  const editConn = (fn: (c: Connection) => void) => update((r) => { const c = r.connections.find((x) => x.id === selected); if (c) fn(c); });
  const name = (ref: { instance_id: string; port_id: string }) => {
    const inst = rig.instances.find((i) => i.id === ref.instance_id);
    const port = portsOf(ref.instance_id).find((p) => p.id === ref.port_id);
    return `${inst?.label ?? ref.instance_id}: ${port?.label ?? ref.port_id}`;
  };
  const topo = analysis?.ml10x.topology;

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-3 items-start">
      <div className="flex flex-col gap-3 min-w-0">
        <Panel title="Signal diagram (physical cables only)">
          <WiringDiagram selectedId={selected} onSelect={setSelected} />
        </Panel>
        <Panel title={`Cables (${conns.length})`} actions={
          <select aria-label="Filter by signal" value={filter} onChange={(e) => setFilter(e.target.value as SignalKind | "all")}>
            <option value="all">all kinds</option>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        }>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-neutral-500"><th>#</th><th>Kind</th><th>From</th><th>To</th><th>Label</th><th>Length</th><th></th></tr></thead>
            <tbody>
              {conns.map((c, i) => (
                <tr key={c.id} className={`border-t border-line cursor-pointer ${selected === c.id ? "bg-blue-50" : ""}`} onClick={() => setSelected(c.id)}>
                  <td>{i + 1}</td>
                  <td><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: KIND_COLOR[c.kind] }} />{c.kind}</td>
                  <td>{name(c.source)}</td>
                  <td>{name(c.target)}</td>
                  <td>{c.label}{c.intentional && <Badge>intentional</Badge>}</td>
                  <td>{c.cable_length_cm ? `${c.cable_length_cm} cm` : ""}</td>
                  <td><Button variant="ghost" aria-label={`Remove cable ${c.label ?? i + 1}`} onClick={(e) => { e.stopPropagation(); removeConnection(c.id); if (selected === c.id) setSelected(null); }}>✕</Button></td>
                </tr>
              ))}
              {!conns.length && <tr><td colSpan={7} className="text-neutral-500 py-2">No cables yet. Add one on the right.</td></tr>}
            </tbody>
          </table>
        </Panel>
        {topo && (
          <Panel title={`${topo.label} loop occupancy (derived from cables)`}>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-neutral-500"><th>Loop</th><th>Jack</th><th>Send feeds</th><th>Return from</th><th>Status</th></tr></thead>
              <tbody>
                {topo.loops.map((l) => (
                  <tr key={l.loop} className="border-t border-line">
                    <td>{l.loop}</td><td>{l.name}</td><td>{l.send_to ?? "—"}</td><td>{l.return_from ?? "—"}</td>
                    <td>{l.complete ? <Badge tone="ok">complete</Badge> : l.occupied ? <Badge tone="bad">open</Badge> : <span className="text-neutral-400">empty</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-neutral-500 mt-1">Input cabled: {topo.input_cabled ? "yes" : "no"} · Output cabled: {topo.output_cabled ? "yes" : "no"}{topo.stereo_pairs.length ? ` · stereo pairs: ${topo.stereo_pairs.map((p) => `${p.label} (loops ${p.tip}+${p.ring})`).join(", ")}` : ""}</p>
          </Panel>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <Panel title="Add cable">
          <form onSubmit={submit} className="flex flex-col gap-2 text-xs">
            <Field label="Signal kind"><select value={kind} onChange={(e) => { setKind(e.target.value as SignalKind); setSrcPort(""); setDstPort(""); }}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field>
            <Field label="From device"><select value={srcInst} onChange={(e) => { setSrcInst(e.target.value); setSrcPort(""); }}><option value="">—</option>{rig.instances.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></Field>
            <Field label="From port (output)"><select value={srcPort} onChange={(e) => setSrcPort(e.target.value)} disabled={!srcInst}><option value="">—</option>{srcOptions.map((p) => <option key={p.id} value={p.id}>{p.label}{used.has(srcInst + ":" + p.id) ? " (in use)" : ""}</option>)}</select></Field>
            <Field label="To device"><select value={dstInst} onChange={(e) => { setDstInst(e.target.value); setDstPort(""); }}><option value="">—</option>{rig.instances.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></Field>
            <Field label="To port (input)"><select value={dstPort} onChange={(e) => setDstPort(e.target.value)} disabled={!dstInst}><option value="">—</option>{dstOptions.map((p) => <option key={p.id} value={p.id}>{p.label}{used.has(dstInst + ":" + p.id) ? " (in use)" : ""}</option>)}</select></Field>
            <Field label="Label (optional)"><input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
            <Button type="submit" variant="primary" disabled={!srcPort || !dstPort}>Add cable</Button>
            <p className="text-[11px] text-neutral-500">Only ports of the chosen signal kind are offered; wrong directions and shared inputs are flagged after adding, never silently fixed.</p>
          </form>
        </Panel>
        {sel && (
          <Panel title="Cable details">
            <div className="flex flex-col gap-2 text-xs">
              <div>{name(sel.source)} → {name(sel.target)} <span className="font-mono text-[10px] text-neutral-400">{sel.id}</span></div>
              <Field label="Label"><input value={sel.label ?? ""} onChange={(e) => editConn((c) => { c.label = e.target.value || null; })} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Length (cm, planning only)"><input type="number" min={0} value={sel.cable_length_cm ?? ""} onChange={(e) => editConn((c) => { c.cable_length_cm = e.target.value === "" ? null : Number(e.target.value); })} /></Field>
                <Field label="Plug style"><select value={sel.connector_style ?? ""} onChange={(e) => editConn((c) => { c.connector_style = e.target.value || null; })}><option value="">—</option><option value="straight">straight</option><option value="pancake">pancake</option><option value="right_angle">right angle</option><option value="solderless">solderless</option></select></Field>
              </div>
              <label className="flex items-center gap-1"><input type="checkbox" checked={sel.intentional} onChange={(e) => editConn((c) => { c.intentional = e.target.checked; })} /> Unusual connection is intentional (downgrades warnings)</label>
              <Field label="Notes"><textarea rows={2} value={sel.notes ?? ""} onChange={(e) => editConn((c) => { c.notes = e.target.value || null; })} /></Field>
              <DiagnosticList items={(analysis?.diagnostics ?? []).filter((d) => d.subject_id === sel.id || d.related_ids.includes(sel.id))} empty="No issues with this cable." />
            </div>
          </Panel>
        )}
        <Panel title={`Wiring diagnostics (${wiringDiags.length})`}>
          <DiagnosticList items={wiringDiags} empty="Signal path, MIDI, expression and power all check out." onFocus={(d) => d.subject_type === "connection" && d.subject_id && setSelected(d.subject_id)} />
        </Panel>
      </div>
    </div>
  );
}
