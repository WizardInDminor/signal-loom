"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DeviceProfile } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";
import { Badge, Button, ErrorBanner, EvidenceBadge, Field, Panel } from "@/components/ui/basics";

function blankProfile(): DeviceProfile {
  return {
    id: "", manufacturer: "", model: "", category: "effect", provenance: { source: "user", evidence: "user" },
    footprint: { width: { value_mm: null, evidence: "user" }, depth: { value_mm: null, evidence: "user" }, height: { value_mm: null, evidence: "user" }, includes_jacks: null, display_unit: "mm" },
    ports: [], power: { voltage_v: null, polarity: "unknown", current_ma_min: null, connector: "unknown", evidence: "unknown" },
    midi: { interfaces: [], default_channel: null, program_change: { supported: null, min: null, max: null, evidence: "unknown" }, cc_map: [], bypass: { evidence: "unknown" }, evidence: "unknown" },
    capabilities: {}, declared_unknowns: [], tags: [], builtin: false,
  };
}

export default function CatalogPage() {
  const [items, setItems] = useState<DeviceProfile[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<DeviceProfile | null>(null);
  const [draft, setDraft] = useState<DeviceProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const refresh = () => api.catalog.list(q).then(setItems).catch((e) => setError(e.message));
  useEffect(() => { void refresh(); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!draft) return;
    try {
      const p = { ...draft, id: draft.id || `${draft.manufacturer}-${draft.model}`.toLowerCase().replace(/[^a-z0-9]+/g, "-") };
      const exists = items.some((i) => i.id === p.id);
      const saved = exists ? await api.catalog.update(p) : await api.catalog.create(p);
      setDraft(null); setSel(saved); void refresh();
    } catch (e) { setError((e as Error).message); }
  };
  const jsonEdit = (text: string) => { try { setDraft(JSON.parse(text)); setError(null); } catch { setError("Profile JSON is not valid yet."); } };

  return (
    <div className="p-4 grid lg:grid-cols-[320px_1fr] gap-3 items-start">
      <div className="flex flex-col gap-3">
        <ErrorBanner message={error} onClose={() => setError(null)} />
        <Panel title="Device library" actions={<Button variant="primary" onClick={() => { setDraft(blankProfile()); setSel(null); }}>+ Custom device</Button>}>
          <input aria-label="Search devices" placeholder="Search…" className="w-full mb-2" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="flex flex-col divide-y divide-line max-h-[60vh] overflow-auto">
            {items.map((p) => (
              <li key={p.id}>
                <button type="button" className={`w-full text-left text-sm py-1 ${sel?.id === p.id ? "text-accent font-medium" : ""}`} onClick={() => { setSel(p); setDraft(null); }}>
                  {p.manufacturer} {p.model} <span className="text-[10px] text-neutral-400">{p.source}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Import Pedal Playground catalog">
          <p className="text-xs text-neutral-600 mb-1">Upload your own copy of <code>pedals.json</code> (Brand/Name/Width/Height in inches). The dataset has no published license, so Signal Loom never bundles it; images are not imported. Records become third-party-evidence profiles without ports or power data.</p>
          <input type="file" accept=".json,application/json" aria-label="Pedal Playground file" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const r = await api.catalog.importPedalPlayground(await f.text()); setReport(`Imported ${r.imported}, skipped ${r.skipped_existing} existing, ${r.problems.length} problems${r.problems.length ? ": " + r.problems.slice(0, 3).join("; ") : ""}`); void refresh(); } catch (err) { setError((err as Error).message); } }} />
          {report && <p className="text-xs mt-1">{report}</p>}
        </Panel>
      </div>
      {draft ? (
        <Panel title={draft.id ? `Edit ${draft.id}` : "New custom device"} actions={<div className="flex gap-2"><Button onClick={() => setDraft(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></div>}>
          <div className="grid grid-cols-4 gap-2 text-xs mb-2">
            <Field label="Manufacturer"><input value={draft.manufacturer} onChange={(e) => setDraft({ ...draft, manufacturer: e.target.value })} /></Field>
            <Field label="Model"><input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} /></Field>
            <Field label="Category"><select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as DeviceProfile["category"] })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Width mm"><input type="number" value={draft.footprint.width.value_mm ?? ""} onChange={(e) => setDraft({ ...draft, footprint: { ...draft.footprint, width: { ...draft.footprint.width, value_mm: e.target.value === "" ? null : Number(e.target.value), evidence: "user" } } })} /></Field>
            <Field label="Depth mm"><input type="number" value={draft.footprint.depth.value_mm ?? ""} onChange={(e) => setDraft({ ...draft, footprint: { ...draft.footprint, depth: { ...draft.footprint.depth, value_mm: e.target.value === "" ? null : Number(e.target.value), evidence: "user" } } })} /></Field>
            <Field label="Height mm"><input type="number" value={draft.footprint.height.value_mm ?? ""} onChange={(e) => setDraft({ ...draft, footprint: { ...draft.footprint, height: { ...draft.footprint.height, value_mm: e.target.value === "" ? null : Number(e.target.value), evidence: "user" } } })} /></Field>
            <Field label="Power V"><input type="number" value={draft.power.voltage_v ?? ""} onChange={(e) => setDraft({ ...draft, power: { ...draft.power, voltage_v: e.target.value === "" ? null : Number(e.target.value), evidence: "user" } })} /></Field>
            <Field label="Current mA (min)"><input type="number" value={draft.power.current_ma_min ?? ""} onChange={(e) => setDraft({ ...draft, power: { ...draft.power, current_ma_min: e.target.value === "" ? null : Number(e.target.value), evidence: "user" } })} /></Field>
          </div>
          <Field label="Full profile JSON (ports, MIDI map, provenance). Jacks can also be added per instance on the Board tab.">
            <textarea rows={18} className="font-mono text-[11px]" defaultValue={JSON.stringify(draft, null, 2)} onBlur={(e) => jsonEdit(e.target.value)} />
          </Field>
        </Panel>
      ) : sel ? (
        <Panel title={`${sel.manufacturer} ${sel.model}`} actions={<div className="flex gap-2"><Button onClick={() => setDraft(structuredClone(sel))}>Edit{sel.builtin ? " (creates your own copy)" : ""}</Button><Button variant="danger" onClick={async () => { if (!window.confirm(`Delete profile ${sel.id}?`)) return; try { await api.catalog.remove(sel.id); setSel(null); void refresh(); } catch (e) { setError((e as Error).message); } }}>Delete</Button></div>}>
          <div className="text-xs flex flex-col gap-2">
            <div className="flex flex-wrap gap-1 items-center">
              <Badge>{sel.category}</Badge><Badge>{sel.source}</Badge>
              <span>Provenance: {sel.provenance.source} <EvidenceBadge evidence={sel.provenance.evidence} /></span>
              {sel.provenance.url && <a className="underline" href={sel.provenance.url} target="_blank" rel="noreferrer">source</a>}
              {sel.provenance.retrieved && <span className="text-neutral-500">({sel.provenance.retrieved})</span>}
            </div>
            <div>Footprint: {sel.footprint.width.value_mm ?? "?"} × {sel.footprint.depth.value_mm ?? "?"} × {sel.footprint.height.value_mm ?? "?"} mm <EvidenceBadge evidence={sel.footprint.width.evidence} /> {sel.footprint.width.note && <span className="text-neutral-500">{sel.footprint.width.note}</span>} · jacks included: {sel.footprint.includes_jacks === null ? <Badge tone="warn">not stated</Badge> : sel.footprint.includes_jacks ? "yes" : "no"}</div>
            <div>Power: {sel.power.voltage_v ?? "?"} V {sel.power.polarity.replace("_", " ")} {sel.power.current_ma_min ?? "?"} mA <EvidenceBadge evidence={sel.power.evidence} /> {sel.power.note}</div>
            <div>MIDI: {sel.midi.interfaces.join(", ") || "none"} · default channel {sel.midi.default_channel ?? <Badge tone="warn">unknown</Badge>} · PC {sel.midi.program_change.supported === true ? `${sel.midi.program_change.min}–${sel.midi.program_change.max}` : sel.midi.program_change.supported === false ? "no" : "unknown"} <EvidenceBadge evidence={sel.midi.program_change.evidence} /> {sel.midi.program_change.note}</div>
            {sel.midi.bypass.cc != null && <div>Bypass: CC {sel.midi.bypass.cc} on={sel.midi.bypass.on_value} off={sel.midi.bypass.off_value} <EvidenceBadge evidence={sel.midi.bypass.evidence} /> {sel.midi.bypass.note}</div>}
            {sel.midi.cc_map.length > 0 && <div>CC map: <ul className="list-disc pl-4">{sel.midi.cc_map.map((c) => <li key={c.cc}>CC {c.cc} {c.name} {c.value_semantics && <span className="text-neutral-500">({c.value_semantics})</span>} <EvidenceBadge evidence={c.evidence} /></li>)}</ul></div>}
            <div>Unknown / unverified: {(sel.unknown_attributes ?? []).length ? sel.unknown_attributes!.map((u) => <Badge key={u} tone="warn">{u}</Badge>) : "nothing declared"}</div>
            <table className="w-full"><thead><tr className="text-left text-neutral-500"><th>Jack</th><th>Kind</th><th>Dir</th><th>Connector</th><th>Edge</th><th>Position</th><th>Notes</th></tr></thead>
              <tbody>{sel.ports.map((p) => <tr key={p.id} className="border-t border-line"><td>{p.label}</td><td>{p.kind}</td><td>{p.direction}</td><td>{p.connector}{p.midi_trs_type ? ` (${p.midi_trs_type})` : ""}{p.audio_channel ? ` ${p.audio_channel}` : ""}</td><td>{p.edge}</td><td>{p.position == null ? <Badge tone="bad">unknown</Badge> : <>{p.position} <EvidenceBadge evidence={p.position_evidence} /></>}</td><td className="text-neutral-500">{p.notes}</td></tr>)}</tbody>
            </table>
            {sel.capabilities.notes && <div className="text-neutral-600">{sel.capabilities.notes}</div>}
          </div>
        </Panel>
      ) : <Panel title="Device"><p className="text-xs text-neutral-500">Pick a device to see its specification and evidence levels, or create a custom one.</p></Panel>}
    </div>
  );
}
