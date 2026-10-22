"use client";

import { useState } from "react";
import { useRigStore } from "@/store/rigStore";
import { useLiveStore } from "@/store/liveStore";
import type { DeviceInstance, DeviceProfile, FunctionRole, Mapping, Texture, TextureReport } from "@/lib/types";
import { FUNCTION_ROLES } from "@/lib/types";
import { type MacroPreview, ROLE_LABEL, isMidiDevice, isSynthetic, mappingEndpoints, roleOf } from "@/lib/instrument";
import { newId } from "@/lib/api";
import { Badge, Button, Field } from "@/components/ui/basics";

/**
 * "What does it move?" — the rig grouped by musical function (an editable lens, not a signal-flow
 * claim), and the patch list: macro → destination with range, direction, the backend's values at
 * macro 0 / ½ / 1, the live preview value, eligibility (documented / synthetic / user-declared /
 * refused and why), MIDI channel and CC route status. Editing a mapping is an ordinary rig edit.
 */
export function PatchBay({ texture, report, previews, structuralLocked }: { texture: Texture; report: TextureReport | undefined; previews: Record<string, MacroPreview>; structuralLocked: boolean }) {
  const { rig, profiles, updateTexture } = useRigStore();
  const coverage = useLiveStore((s) => s.coverage);
  const [adding, setAdding] = useState<string | null>(null); // macro id
  if (!rig) return null;
  const edit = (fn: (t: Texture) => void) => updateTexture(texture.id, fn);
  const devices = rig.instances.filter((i) => isMidiDevice(profiles[i.profile_id]));
  const groups = new Map<FunctionRole, DeviceInstance[]>();
  for (const d of devices) {
    const role = roleOf(texture, d, profiles[d.profile_id]);
    groups.set(role, [...(groups.get(role) ?? []), d]);
  }
  const routeOf = (instId: string) => coverage?.targets[instId]?.coverage.cc;
  const channelOf = (inst: DeviceInstance) => inst.midi_channel ?? profiles[inst.profile_id]?.midi.default_channel ?? null;
  const mappedCount = (instId: string) => texture.macros.reduce((n, m) => n + m.mappings.filter((x) => x.instance_id === instId).length, 0);

  return (
    <section className="flex flex-col gap-3" data-testid="patch-bay" aria-label="What does it move">
      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">The rig, by function <span className="normal-case">(relabel any device for this texture)</span></div>
        <div className="flex flex-wrap gap-2" data-testid="function-groups">
          {FUNCTION_ROLES.filter((r) => groups.has(r)).map((role) => (
            <div key={role} className="rounded-md border border-line bg-panel px-2 py-1.5 min-w-[150px]" data-testid={`function-group-${role}`}>
              <div className="text-[11px] font-semibold text-neutral-600">{ROLE_LABEL[role]}</div>
              <ul className="flex flex-col gap-1 mt-1">
                {groups.get(role)!.map((d) => {
                  const prof = profiles[d.profile_id];
                  const route = routeOf(d.id);
                  const n = mappedCount(d.id);
                  return (
                    <li key={d.id} className="text-xs flex flex-col" data-testid={`function-device-${d.id}`}>
                      <div className="flex items-center gap-1 flex-wrap">
                        <b>{d.label}</b>
                        {isSynthetic(prof) && <Badge tone="warn">synthetic</Badge>}
                        {n > 0 && <Badge tone="ok">{n} mapped</Badge>}
                      </div>
                      <div className="text-neutral-500 flex items-center gap-1 flex-wrap">
                        <span>{prof?.model} · ch {channelOf(d) ?? "?"}</span>
                        <span>· CC route {route ? <Badge tone={route.status === "supported" ? "ok" : route.status === "unverified" ? "warn" : route.status === "unreachable" ? "neutral" : "bad"}>{route.status}</Badge> : <Badge>unknown (not connected)</Badge>}</span>
                        <select aria-label={`Function of ${d.label}`} className="!py-0 !px-1 text-[11px]" value={role} disabled={structuralLocked} onChange={(e) => edit((t) => { t.function_roles[d.id] = e.target.value; })}>
                          {FUNCTION_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {!devices.length && <p className="text-xs text-neutral-500">No MIDI-capable device on this rig.</p>}
        </div>
      </div>

      {texture.macros.map((macro) => (
        <div key={macro.id} className="flex flex-col gap-1" data-testid={`patch-macro-${macro.id}`}>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold">{macro.name}</span>
            <span className="text-neutral-400">→</span>
            <span className="text-neutral-600">{macro.mappings.length} destination(s) on {new Set(macro.mappings.map((m) => m.instance_id)).size} device(s)</span>
            {!structuralLocked && <Button className="ml-auto" onClick={() => setAdding(adding === macro.id ? null : macro.id)} data-testid={`mapping-add-${macro.id}`}>+ Destination</Button>}
          </div>
          {adding === macro.id && (
            <AddMapping devices={devices} profiles={profiles} onAdd={(m) => { edit((t) => { t.macros.find((x) => x.id === macro.id)?.mappings.push(m); }); setAdding(null); }} onCancel={() => setAdding(null)} />
          )}
          <ul className="flex flex-col gap-1">
            {macro.mappings.map((m) => (
              <MappingRow key={m.id} texture={texture} macroId={macro.id} mapping={m} report={report} preview={previews[macro.id]?.values[m.id]} locked={structuralLocked} />
            ))}
            {!macro.mappings.length && <li className="text-xs text-neutral-500 border border-dashed border-line rounded p-2">No destination yet. A macro needs at least two destinations on different pedals to become a whole-rig gesture.</li>}
          </ul>
        </div>
      ))}
    </section>
  );
}

function MappingRow({ texture, macroId, mapping: m, report, preview, locked }: { texture: Texture; macroId: string; mapping: Mapping; report: TextureReport | undefined; preview: number | undefined; locked: boolean }) {
  const { rig, profiles, updateTexture } = useRigStore();
  const coverage = useLiveStore((s) => s.coverage);
  const [noteDraft, setNoteDraft] = useState(m.override_note ?? "");
  if (!rig) return null;
  const inst = rig.instances.find((i) => i.id === m.instance_id);
  const prof = inst ? profiles[inst.profile_id] : undefined;
  const el = report?.mappings[m.id];
  const ends = el ? { at_0: el.at_0, at_half: el.at_half, at_1: el.at_1 } : mappingEndpoints(m);
  const route = coverage?.targets[m.instance_id]?.coverage.cc;
  const ccDef = prof?.midi.cc_map.find((c) => c.cc === m.cc);
  const edit = (fn: (x: Mapping) => void) => updateTexture(texture.id, (t) => { const mm = t.macros.find((x) => x.id === macroId)?.mappings.find((x) => x.id === m.id); if (mm) fn(mm); });
  const remove = () => updateTexture(texture.id, (t) => { const mac = t.macros.find((x) => x.id === macroId); if (mac) mac.mappings = mac.mappings.filter((x) => x.id !== m.id); });
  const tone = !inst ? "bad" : el?.eligible ? (el.basis === "synthetic" ? "warn" : el.basis === "user_declared" ? "warn" : "ok") : "bad";
  const conflict = el?.conflict ?? null;
  const span = Math.abs(m.output_max - m.output_min);
  const pos = (v: number) => `${(v / 127) * 100}%`;
  return (
    <li className={`rounded-md border p-2 text-xs flex flex-col gap-1 ${el?.eligible && !conflict ? "border-line bg-panel" : "border-red-200 bg-red-50/40"} ${m.enabled ? "" : "opacity-60"}`} data-testid={`mapping-${m.id}`} data-eligible={el?.eligible ? "true" : "false"} data-conflict={conflict ? "true" : "false"} data-value={preview ?? ""}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1"><input type="checkbox" aria-label="Mapping enabled" checked={m.enabled} disabled={locked} onChange={(e) => edit((x) => { x.enabled = e.target.checked; })} /><b>{inst?.label ?? <span className="text-red-700">missing device {m.instance_id}</span>}</b></label>
        <span className="text-neutral-500">CC {m.cc}{ccDef ? ` · ${ccDef.name}` : " · not in the documented map"} · ch {el?.channel ?? inst?.midi_channel ?? "?"}</span>
        <Badge tone={tone}>{!inst ? "device missing" : el ? (el.eligible ? (el.basis === "documented" ? "documented continuous" : el.basis === "synthetic" ? "synthetic (simulation only)" : "user-declared") : "not eligible") : "checking…"}</Badge>
        {route && <Badge tone={route.status === "supported" ? "ok" : route.status === "unverified" ? "warn" : "neutral"}>route {route.status}{route.evidence ? ` · ${route.evidence.replace("_", " ")}` : ""}</Badge>}
        {conflict && <Badge tone="bad">conflicts with another destination</Badge>}
        <span className="ml-auto font-mono text-sm" data-testid={`mapping-value-${m.id}`}>{preview ?? "—"}</span>
        {!locked && <Button variant="ghost" aria-label={`Remove destination CC ${m.cc} on ${inst?.label ?? m.instance_id}`} onClick={remove}>✕</Button>}
      </div>
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <input aria-label="Output min" type="number" min={0} max={127} className="w-14" value={m.output_min} disabled={locked} onChange={(e) => edit((x) => { x.output_min = Math.max(0, Math.min(127, Number(e.target.value) || 0)); })} />
        <div className="relative h-5 rounded bg-neutral-100 border border-line" aria-hidden="true">
          <div className={`absolute top-0 bottom-0 ${m.output_min > m.output_max ? "bg-amber-200/80" : "bg-blue-200/80"}`} style={{ left: pos(Math.min(m.output_min, m.output_max)), width: `${(span / 127) * 100}%` }} />
          {preview != null && <div className="absolute top-0 bottom-0 w-0.5 bg-neutral-900 inst-cursor" style={{ left: pos(preview) }} />}
          <span className="absolute inset-0 flex items-center justify-center text-[10px] text-neutral-700">{m.output_min > m.output_max ? "◀ falls as the macro rises (inverse)" : m.output_min === m.output_max ? "constant" : "rises with the macro ▶"}</span>
        </div>
        <input aria-label="Output max" type="number" min={0} max={127} className="w-14" value={m.output_max} disabled={locked} onChange={(e) => edit((x) => { x.output_max = Math.max(0, Math.min(127, Number(e.target.value) || 0)); })} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-600">
        <span>macro 0 → <b className="font-mono">{ends.at_0}</b></span><span>½ → <b className="font-mono">{ends.at_half}</b></span><span>1 → <b className="font-mono">{ends.at_1}</b></span>
        {el?.evidence && <span>· control evidence: {el.evidence}</span>}
        {ccDef?.value_semantics && <span>· {ccDef.value_semantics}</span>}
      </div>
      {el && <p className={`text-[11px] ${el.eligible ? "text-neutral-600" : "text-red-700"}`} data-testid={`mapping-reason-${m.id}`}>{el.reason}</p>}
      {el?.warnings.map((w) => <p key={w} className="text-[11px] text-amber-800">⚠ {w}</p>)}
      {conflict && <p className="text-[11px] text-red-700" data-testid={`mapping-conflict-${m.id}`}>✕ {conflict}</p>}
      {el && !el.eligible && !el.hard_refusal && inst && !locked && (
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-1">
          <Field label="Declare this CC safe to sweep (your claim; recorded with the mapping)">
            <input aria-label="Override note" className="w-64" placeholder="e.g. swept by hand on 2026-10-21, smooth 0–127" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />
          </Field>
          <Button disabled={!noteDraft.trim()} onClick={() => edit((x) => { x.user_override = true; x.override_note = noteDraft.trim(); })} data-testid={`mapping-override-${m.id}`}>Declare with note</Button>
        </div>
      )}
      {m.user_override && !locked && <div className="text-[11px]"><Button variant="ghost" className="!py-0" onClick={() => edit((x) => { x.user_override = false; x.override_note = null; })}>Withdraw my declaration</Button></div>}
    </li>
  );
}

function AddMapping({ devices, profiles, onAdd, onCancel }: { devices: DeviceInstance[]; profiles: Record<string, DeviceProfile>; onAdd: (m: Mapping) => void; onCancel: () => void }) {
  const [instId, setInstId] = useState(devices[0]?.id ?? "");
  const [cc, setCc] = useState<number>(() => firstContinuous(devices[0], profiles));
  const [lo, setLo] = useState(0);
  const [hi, setHi] = useState(127);
  const prof = profiles[devices.find((d) => d.id === instId)?.profile_id ?? ""];
  const options = prof?.midi.cc_map ?? [];
  return (
    <div className="border border-accent rounded-md p-2 bg-blue-50/50 text-xs flex flex-wrap items-end gap-2" data-testid="mapping-add-form">
      <Field label="Device">
        <select aria-label="Destination device" value={instId} onChange={(e) => { setInstId(e.target.value); setCc(firstContinuous(devices.find((d) => d.id === e.target.value), profiles)); }}>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </Field>
      <Field label="Control (CC)" hint="Only controls documented as continuous are offered as sweeps; others need your explicit declaration.">
        <select aria-label="Destination CC" value={String(cc)} onChange={(e) => setCc(Number(e.target.value))}>
          {options.map((c) => <option key={c.cc} value={String(c.cc)}>{`CC ${c.cc} · ${c.name}`}{c.continuous === true ? " · continuous" : c.continuous === false ? " · discrete (refused)" : " · not stated"}</option>)}
          <option value="-1">Other CC number…</option>
        </select>
      </Field>
      {(cc === -1 || !options.some((c) => c.cc === cc)) && <Field label="CC number"><input aria-label="Custom CC number" type="number" min={0} max={127} className="w-16" value={cc < 0 ? "" : cc} onChange={(e) => setCc(Number(e.target.value))} /></Field>}
      <Field label="From"><input aria-label="Range from" type="number" min={0} max={127} className="w-14" value={lo} onChange={(e) => setLo(Number(e.target.value))} /></Field>
      <Field label="To"><input aria-label="Range to" type="number" min={0} max={127} className="w-14" value={hi} onChange={(e) => setHi(Number(e.target.value))} /></Field>
      <Button variant="primary" disabled={!instId || cc < 0 || cc > 127} data-testid="mapping-add-confirm" onClick={() => onAdd({ id: newId("map"), instance_id: instId, cc, output_min: Math.max(0, Math.min(127, lo)), output_max: Math.max(0, Math.min(127, hi)), label: null, enabled: true, user_override: false, override_note: null })}>Add</Button>
      <Button onClick={onCancel}>Cancel</Button>
    </div>
  );
}

function firstContinuous(d: DeviceInstance | undefined, profiles: Record<string, DeviceProfile>): number {
  const prof = d ? profiles[d.profile_id] : undefined;
  const c = prof?.midi.cc_map.find((x) => x.continuous === true) ?? prof?.midi.cc_map[0];
  return c?.cc ?? -1;
}
