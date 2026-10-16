"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AssetRecord, DeviceProfile } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";
import { Badge, Button, ErrorBanner, EvidenceBadge, Field, Panel } from "@/components/ui/basics";
import { JackEditor } from "@/components/board/JackEditor";
import { DeviceImageSection } from "@/components/images/DeviceImageSection";
import { enclosureFill } from "@/lib/boardLayout";
import type { PortDef, SignalKind, PortDirection, Edge } from "@/lib/types";
import { CONNECTORS } from "@/lib/types";

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
  const [category, setCategory] = useState("");
  const [selPort, setSelPort] = useState<string | null>(null);
  const [sel, setSel] = useState<DeviceProfile | null>(null);
  const [draft, setDraft] = useState<DeviceProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [assets, setAssets] = useState<(AssetRecord & { referenced: boolean })[] | null>(null);
  const refresh = () => api.catalog.list(q, category || undefined).then(setItems).catch((e) => setError(e.message));
  const refreshAssets = () => api.assets.list().then(setAssets).catch(() => setAssets(null));
  useEffect(() => { void refresh(); }, [q, category]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void refreshAssets(); }, [sel?.image?.asset_id]);
  const unused = assets?.filter((a) => !a.referenced) ?? [];
  const duplicate = (p: DeviceProfile) => {
    const copy = structuredClone(p);
    copy.id = `${p.id}-copy`;
    copy.model = `${p.model} (copy)`;
    copy.builtin = false;
    copy.provenance = { ...copy.provenance, source: "user", evidence: "user", attribution: `Copied from ${p.manufacturer} ${p.model}` };
    setDraft(copy);
    setSel(null);
  };
  const setDraftPort = (port: PortDef) => setDraft((d) => d ? { ...d, ports: d.ports.map((x) => (x.id === port.id ? port : x)) } : d);
  const addDraftPort = () => setDraft((d) => {
    if (!d) return d;
    let n = 1;
    while (d.ports.some((x) => x.id === `jack${n}`)) n++;
    const port: PortDef = { id: `jack${n}`, label: `Jack ${n}`, kind: "audio", direction: "in", connector: "ts_1_4", audio_channel: "mono", edge: "top", position: 0.5, position_evidence: "user", plug_clearance_mm: 38 };
    return { ...d, ports: [...d.ports, port] };
  });

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
    <div className="p-4 grid lg:grid-cols-[320px_minmax(0,1fr)] gap-3 items-start">
      <div className="flex flex-col gap-3 min-w-0">
        <ErrorBanner message={error} onClose={() => setError(null)} />
        <Panel title="Device library" actions={<Button variant="primary" onClick={() => { setDraft(blankProfile()); setSel(null); }}>+ Custom device</Button>}>
          <div className="flex gap-1 mb-2">
            <input aria-label="Search devices" placeholder="Search…" className="flex-1" value={q} onChange={(e) => setQ(e.target.value)} />
            <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">all</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
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
        <Panel title="Pictures on this computer">
          <div className="text-xs flex flex-col gap-1" data-testid="asset-cleanup">
            {assets === null ? <span className="text-neutral-500">…</span> : (
              <>
                <span>{assets.length} picture{assets.length === 1 ? "" : "s"} stored · <b data-testid="asset-unused-count">{unused.length}</b> unused ({Math.round(unused.reduce((n, a) => n + a.byte_size, 0) / 1024)} KB)</span>
                <span className="text-neutral-500">Unused pictures come from cancelled crops or replaced photographs. Pictures a device still uses are never removed here.</span>
                <div><Button disabled={!unused.length} data-testid="asset-cleanup-remove" onClick={async () => { if (!window.confirm(`Remove ${unused.length} unused picture(s) from this computer?`)) return; try { await api.assets.removeUnreferenced(); await refreshAssets(); } catch (e) { setError((e as Error).message); } }}>Remove unused pictures</Button></div>
              </>
            )}
          </div>
        </Panel>
        <Panel title="Import Pedal Playground catalog">
          <p className="text-xs text-neutral-600 mb-1">Upload your own copy of <code>pedals.json</code> (Brand/Name/Width/Height in inches). The dataset has no published license, so Signal Loom never bundles it; images are not imported. Records become third-party-evidence profiles without ports or power data.</p>
          <input type="file" accept=".json,application/json" aria-label="Pedal Playground file" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const r = await api.catalog.importPedalPlayground(await f.text()); setReport(`Imported ${r.imported}, skipped ${r.skipped_existing} existing, ${r.problems.length} problems${r.problems.length ? ": " + r.problems.slice(0, 3).join("; ") : ""}`); void refresh(); } catch (err) { setError((err as Error).message); } }} />
          {report && <p className="text-xs mt-1">{report}</p>}
        </Panel>
      </div>
      {draft ? (
        <Panel className="min-w-0" title={draft.id ? `Edit ${draft.id}` : "New custom device"} actions={<div className="flex gap-2"><Button onClick={() => setDraft(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></div>}>
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
          <div className="grid md:grid-cols-[280px_1fr] gap-3 mb-2">
            <div>
              <h3 className="text-xs font-semibold mb-1">Jack positions (drag)</h3>
              <JackEditor widthMm={draft.footprint.width.value_mm ?? 70} depthMm={draft.footprint.depth.value_mm ?? 120} ports={draft.ports} onChange={setDraftPort} selectedId={selPort} onSelect={setSelPort} />
            </div>
            <div className="text-xs">
              <div className="flex items-center justify-between mb-1"><h3 className="font-semibold">Jacks ({draft.ports.length})</h3><Button onClick={addDraftPort}>+ Add jack</Button></div>
              <div className="overflow-x-auto"><table className="w-full">
                <thead><tr className="text-left text-neutral-500"><th>Id</th><th>Label</th><th>Kind</th><th>Dir</th><th>Connector</th><th>Edge</th><th>Pos</th><th></th></tr></thead>
                <tbody>
                  {draft.ports.map((p) => (
                    <tr key={p.id} className={`border-t border-line ${selPort === p.id ? "bg-blue-50" : ""}`} onClick={() => setSelPort(p.id)}>
                      <td className="font-mono text-[10px]">{p.id}</td>
                      <td><input aria-label={`Jack ${p.id} label`} className="w-24" value={p.label} onChange={(e) => setDraftPort({ ...p, label: e.target.value })} /></td>
                      <td><select aria-label={`Jack ${p.id} kind`} value={p.kind} onChange={(e) => setDraftPort({ ...p, kind: e.target.value as SignalKind })}>{["audio", "midi", "expression", "power", "usb"].map((k) => <option key={k}>{k}</option>)}</select></td>
                      <td><select aria-label={`Jack ${p.id} direction`} value={p.direction} onChange={(e) => setDraftPort({ ...p, direction: e.target.value as PortDirection })}>{["in", "out", "bidirectional"].map((k) => <option key={k}>{k}</option>)}</select></td>
                      <td><select aria-label={`Jack ${p.id} connector`} value={p.connector} onChange={(e) => setDraftPort({ ...p, connector: e.target.value as PortDef["connector"] })}>{CONNECTORS.map((k) => <option key={k}>{k}</option>)}</select></td>
                      <td><select aria-label={`Jack ${p.id} edge`} value={p.edge} onChange={(e) => setDraftPort({ ...p, edge: e.target.value as Edge })}>{["top", "bottom", "left", "right", "top_face"].map((k) => <option key={k}>{k}</option>)}</select></td>
                      <td>{p.position == null ? <Badge tone="bad">unknown</Badge> : `${p.position.toFixed(2)} (${p.position_evidence})`}</td>
                      <td><Button variant="ghost" aria-label={`Remove jack ${p.id}`} onClick={() => setDraft((d) => d ? { ...d, ports: d.ports.filter((x) => x.id !== p.id) } : d)}>✕</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <p className="text-[11px] text-neutral-500 mt-1">MIDI map, power details and provenance live in the JSON below; the evidence level of every value you type is recorded as “user”.</p>
            </div>
          </div>
          <Field label="Full profile JSON (ports, MIDI map, provenance). Jacks can also be added per instance on the Board tab.">
            <textarea rows={14} className="font-mono text-[11px]" key={JSON.stringify(draft.ports.map((p) => [p.id, p.edge, p.position, p.label, p.kind, p.direction, p.connector]))} defaultValue={JSON.stringify(draft, null, 2)} onBlur={(e) => jsonEdit(e.target.value)} />
          </Field>
        </Panel>
      ) : sel ? (
        <Panel className="min-w-0" title={`${sel.manufacturer} ${sel.model}`} actions={<div className="flex gap-2"><Button onClick={() => duplicate(sel)}>Duplicate</Button><Button onClick={() => setDraft(structuredClone(sel))}>Edit{sel.builtin ? " (creates your own copy)" : ""}</Button><Button variant="danger" onClick={async () => { if (!window.confirm(`Delete profile ${sel.id}?`)) return; try { await api.catalog.remove(sel.id); setSel(null); void refresh(); } catch (e) { setError((e as Error).message); } }}>Delete</Button></div>}>
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
            <div className="overflow-x-auto"><table className="w-full"><thead><tr className="text-left text-neutral-500"><th>Jack</th><th>Kind</th><th>Dir</th><th>Connector</th><th>Edge</th><th>Position</th><th>Notes</th></tr></thead>
              <tbody>{sel.ports.map((p) => <tr key={p.id} className="border-t border-line"><td>{p.label}</td><td>{p.kind}</td><td>{p.direction}</td><td>{p.connector}{p.midi_trs_type ? ` (${p.midi_trs_type})` : ""}{p.audio_channel ? ` ${p.audio_channel}` : ""}</td><td>{p.edge}</td><td>{p.position == null ? <Badge tone="bad">unknown</Badge> : <>{p.position} <EvidenceBadge evidence={p.position_evidence} /></>}</td><td className="text-neutral-500">{p.notes}</td></tr>)}</tbody>
            </table></div>
            {sel.capabilities.notes && <div className="text-neutral-600">{sel.capabilities.notes}</div>}
            <DeviceImageSection
              heading="Picture"
              value={sel.image ?? null}
              widthMm={sel.footprint.width.value_mm}
              depthMm={sel.footprint.depth.value_mm}
              evidence={sel.footprint.width.evidence}
              ports={sel.ports}
              fill={enclosureFill(sel.category)}
              hint={`Add a top-down photograph of the ${sel.model}; every board that uses this profile shows it.${sel.builtin ? " Saving a picture on a built-in profile makes it your own copy (same id, never overwritten by updates)." : ""}`}
              onSave={async (img) => {
                const saved = await api.catalog.update({ ...sel, image: img });
                setSel(saved);
                void refresh();
                setTimeout(() => void refreshAssets(), 300); // after the section reclaims replaced/cancelled uploads
              }}
            />
            <div>
              <h3 className="font-semibold mb-1">Jack layout (read-only; Edit or Duplicate to change)</h3>
              <JackEditor widthMm={sel.footprint.width.value_mm ?? 70} depthMm={sel.footprint.depth.value_mm ?? 120} ports={sel.ports} onChange={() => undefined} />
            </div>
          </div>
        </Panel>
      ) : <Panel title="Device"><p className="text-xs text-neutral-500">Pick a device to see its specification and evidence levels, or create a custom one.</p></Panel>}
    </div>
  );
}
