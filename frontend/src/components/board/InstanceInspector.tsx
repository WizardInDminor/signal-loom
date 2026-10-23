"use client";

import { useRigStore } from "@/store/rigStore";
import type { DeviceInstance, Rotation } from "@/lib/types";
import { Badge, Button, DiagnosticList, EvidenceBadge, Field, Panel } from "@/components/ui/basics";
import { PortEditor } from "./PortEditor";
import { JackEditor } from "./JackEditor";
import { DeviceImageSection } from "@/components/images/DeviceImageSection";
import { ConfigureJacksButton, JackMapper } from "@/components/images/JackMapper";
import { api } from "@/lib/api";
import { enclosureFill } from "@/lib/boardLayout";
import { SURFACES, SURFACE_LABEL, setSurface, surfaceOf } from "@/lib/mounting";
import type { Surface } from "@/lib/types";
import { useState } from "react";
import Link from "next/link";
import type { DeviceNote, PortDef } from "@/lib/types";
import { NotesPane } from "@/components/workbench/NotesPane";
import { citableDocuments } from "@/lib/knowledge";

export function InstanceInspector() {
  const { rig, analysis, profiles, selectedInstanceId, update, removeInstance, refreshCatalog, reanalyze } = useRigStore();
  const [mapping, setMapping] = useState(false);
  const inst = rig?.instances.find((i) => i.id === selectedInstanceId);
  if (!rig || !inst) return <Panel title="Device inspector"><p className="text-xs text-neutral-500">Select a device on the board.</p></Panel>;
  const profile = profiles[inst.profile_id];
  const geo = analysis?.instances[inst.id];
  const diags = analysis?.diagnostics.filter((d) => d.subject_id === inst.id || d.related_ids.includes(inst.id)) ?? [];
  const edit = (fn: (i: DeviceInstance) => void) => update((r) => { const k = r.instances.find((x) => x.id === inst.id); if (k) fn(k); });
  const savePort = (port: PortDef) =>
    edit((k) => {
      const idx = k.port_overrides.findIndex((p) => p.id === port.id);
      if (idx >= 0) k.port_overrides[idx] = port;
      else k.port_overrides.push(port);
    });

  return (
    <Panel title="Device inspector" actions={<Button variant="danger" onClick={() => window.confirm(`Remove "${inst.label}" and its cables?`) && removeInstance(inst.id)}>Remove</Button>}>
      <div className="flex flex-col gap-2 text-xs">
        <div className="text-neutral-600">
          {profile ? `${profile.manufacturer} ${profile.model}` : inst.profile_id} <span className="font-mono text-[10px] text-neutral-400">{inst.id}</span>
        </div>
        <Field label="Label"><input value={inst.label} onChange={(e) => edit((i) => { i.label = e.target.value; })} /></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="X (mm)"><input type="number" value={inst.x_mm} onChange={(e) => edit((i) => { i.x_mm = Number(e.target.value); })} disabled={surfaceOf(inst) === "off_board"} /></Field>
          <Field label="Y (mm)"><input type="number" value={inst.y_mm} onChange={(e) => edit((i) => { i.y_mm = Number(e.target.value); })} disabled={surfaceOf(inst) === "off_board"} /></Field>
          <Field label="Rotation">
            <select value={inst.rotation} onChange={(e) => edit((i) => { i.rotation = Number(e.target.value) as Rotation; })}>
              {[0, 90, 180, 270].map((r) => <option key={r} value={r}>{r}°</option>)}
            </select>
          </Field>
        </div>
        <Field label="Mounted on" hint={surfaceOf(inst) === "underside" ? "Same x/y as the top view, seen through the board from above (not mirrored). Fit under the board is checked against the device's height and the board's clearance." : undefined}>
          <select value={surfaceOf(inst)} onChange={(e) => edit((i) => setSurface(i, e.target.value as Surface))} data-testid="inst-surface" aria-label="Mounted on">
            {SURFACES.map((sf) => <option key={sf} value={sf}>{SURFACE_LABEL[sf]}</option>)}
          </select>
        </Field>
        <div className="text-neutral-600">
          Footprint: {geo ? `${Math.round(geo.width_mm * 10) / 10} × ${Math.round(geo.height_mm * 10) / 10} mm (rotated)` : "?"}{" "}
          {profile && <EvidenceBadge evidence={profile.footprint.width.evidence} />}{" "}
          {profile?.footprint.includes_jacks === null && <Badge tone="warn">jack inclusion unknown</Badge>}
          {" · "}height {geo?.tall_mm != null ? `${geo.tall_mm} mm` : <Badge tone="warn">unknown</Badge>}{profile?.footprint.height.value_mm != null && <> <EvidenceBadge evidence={profile.footprint.height.evidence} /></>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="MIDI channel" hint={profile?.midi.interfaces.length ? `profile default: ${profile.midi.default_channel ?? "unknown"}` : "no MIDI interface"}>
            <input type="number" min={1} max={16} value={inst.midi_channel ?? ""} placeholder="—" onChange={(e) => edit((i) => { i.midi_channel = e.target.value === "" ? null : Math.min(16, Math.max(1, Number(e.target.value))); })} />
          </Field>
          <div className="flex flex-col gap-1 pt-4">
            <label className="flex items-center gap-1"><input type="checkbox" checked={inst.intentional_overlap} onChange={(e) => edit((i) => { i.intentional_overlap = e.target.checked; })} /> Overlap is intentional</label>
          </div>
        </div>
        <Field label="Notes"><textarea rows={2} value={inst.notes ?? ""} onChange={(e) => edit((i) => { i.notes = e.target.value || null; })} /></Field>
        {profile && (
          <div className="flex flex-col gap-2 border border-line rounded p-2" data-testid="unit-knowledge">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">Quick Reference</h3>
              <Link href={`/catalog/${encodeURIComponent(profile.id)}/workbench`} className="underline text-neutral-600 ml-auto" data-testid="inspector-workbench-link">Knowledge Workbench ↗</Link>
            </div>
            {(profile.quick_reference ?? []).filter((n) => n.pinned).length > 0 ? (
              <ul className="flex flex-col gap-1" data-testid="pinned-model-notes">
                {(profile.quick_reference ?? []).filter((n) => n.pinned).map((n) => (
                  <li key={n.id} className="rounded border border-line bg-neutral-50 px-2 py-1">
                    <div className="flex items-center gap-1"><span className="text-amber-500">★</span><b>{n.title}</b><span className="text-neutral-400 text-[10px] ml-auto">every {profile.model}</span></div>
                    {n.body && <p className="text-neutral-700 whitespace-pre-wrap">{n.body}</p>}
                    {n.steps.length > 0 && <ol className="list-decimal pl-4 text-neutral-800">{n.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-[11px] text-neutral-500">Pinned notes about every {profile.model} (how to save a preset, set the channel…) appear here once you pin them in the Workbench.</p>}
            <details data-testid="unit-notes-details" open={(inst.quick_reference ?? []).length > 0}>
              <summary className="cursor-pointer text-neutral-600">This unit only ({(inst.quick_reference ?? []).length}) — its channel setting, a global mode, a quirk of this one pedal</summary>
              <div className="mt-2">
                <NotesPane compact notes={inst.quick_reference ?? []} docs={citableDocuments(profile)} reference={null} cite={null} spawn={null} scopeLabel={`this ${inst.label}`}
                  onSave={async (next: DeviceNote[]) => { edit((i) => { i.quick_reference = next; }); return true; }} />
              </div>
            </details>
          </div>
        )}
        {geo?.unknowns.length ? (
          <div>
            <span className="text-neutral-600">Unknown / unverified on this profile: </span>
            {geo.unknowns.map((u) => <Badge key={u} tone="warn">{u}</Badge>)}
          </div>
        ) : null}
        {profile?.power.voltage_v != null ? (
          <div className="text-neutral-600">Power: {profile.power.voltage_v} V {profile.power.polarity.replace("_", " ")}, {profile.power.current_ma_min ?? "?"} mA min <EvidenceBadge evidence={profile.power.evidence} /></div>
        ) : (
          <div className="text-neutral-600">Power requirement: <Badge tone="bad">unknown</Badge></div>
        )}
        <div className="flex flex-col gap-2 border border-line rounded p-2">
          <DeviceImageSection
            heading={`Picture for every ${profile?.model ?? "device of this profile"}`}
            value={profile?.image ?? null}
            widthMm={profile?.footprint.width.value_mm ?? null}
            depthMm={profile?.footprint.depth.value_mm ?? null}
            evidence={profile?.footprint.width.evidence}
            ports={geo?.effective_ports ?? profile?.ports ?? []}
            fill={enclosureFill(profile?.category)}
            testId="profile-image"
            hint="A top-down photograph shown on every board that uses this profile."
            onSave={async (img) => {
              if (!profile) return;
              await api.catalog.update({ ...profile, image: img });
              await refreshCatalog();
              await reanalyze();
            }}
          />
          <details data-testid="instance-image-details">
            <summary className="cursor-pointer text-neutral-600">This unit only (repainted or customised pedal){inst.image ? " · override active" : ""}</summary>
            <div className="mt-2">
              <DeviceImageSection
                value={inst.image ?? null}
                widthMm={profile?.footprint.width.value_mm ?? null}
                depthMm={profile?.footprint.depth.value_mm ?? null}
                evidence={profile?.footprint.width.evidence}
                ports={geo?.effective_ports ?? []}
                fill={enclosureFill(profile?.category)}
                testId="instance-image"
                hint="Overrides the profile's picture for this one placed unit; the profile's dimensions and jacks still apply."
                onSave={(img) => edit((i) => { i.image = img; })}
              />
            </div>
          </details>
        </div>
        <div className="flex flex-col gap-1">
          <ConfigureJacksButton image={profile?.image} count={profile?.ports.length ?? 0} onOpen={() => setMapping(true)} />
          {profile?.image && <p className="text-[11px] text-neutral-500">Edits the profile, so every {profile.model} gets the jacks. Per-unit tweaks stay below.</p>}
        </div>
        {mapping && profile?.image && (
          <JackMapper
            profileId={profile.id}
            title={`${profile.manufacturer} ${profile.model}`}
            ports={profile.ports}
            image={profile.image}
            widthMm={profile.footprint.width.value_mm}
            depthMm={profile.footprint.depth.value_mm}
            footprintEvidence={profile.footprint.width.evidence}
            onSaved={async () => { await refreshCatalog(); await reanalyze(); }}
            onClose={() => setMapping(false)}
          />
        )}
        <div>
          <h3 className="font-semibold mb-1">Jack positions on this unit (drag on the outline)</h3>
          <JackEditorForInstance inst={inst} onChange={savePort} />
        </div>
        <PortEditor inst={inst} />
        <div>
          <h3 className="font-semibold mb-1">Diagnostics for this device</h3>
          <DiagnosticList items={diags} empty="Nothing flagged." />
        </div>
      </div>
    </Panel>
  );
}


function JackEditorForInstance({ inst, onChange }: { inst: DeviceInstance; onChange: (p: PortDef) => void }) {
  const { analysis, profiles } = useRigStore();
  const [sel, setSel] = useState<string | null>(null);
  const prof = profiles[inst.profile_id];
  const ports = analysis?.instances[inst.id]?.effective_ports ?? [];
  const w = prof?.footprint.width.value_mm ?? 70;
  const d = prof?.footprint.depth.value_mm ?? 120;
  return (
    <div className="flex flex-col gap-1">
      <JackEditor widthMm={w} depthMm={d} ports={ports} onChange={onChange} selectedId={sel} onSelect={setSel} />
      <p className="text-[11px] text-neutral-500">Unrotated device frame. Dashed jacks have no documented position; dragging stores a user-specified position on this instance only.</p>
    </div>
  );
}
