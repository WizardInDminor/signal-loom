"use client";

import { useState } from "react";
import { useRigStore } from "@/store/rigStore";
import { useLiveStore } from "@/store/liveStore";
import type { Macro, Mapping, Texture, TextureReport } from "@/lib/types";
import { controlOf, defaultRange, directionText, mappingEndpoints } from "@/lib/instrument";
import { behaviorLabel, behaviorOf, isReviewed, rangeText } from "@/lib/knowledge";
import { Badge, Button, Field } from "@/components/ui/basics";

/**
 * One destination of a macro, drawn around what a musician needs to read: the control's documented
 * name, the rail (0–127 with the documented range shaded, the authored extent as a directional
 * bar, the live cursor), the direction in words, one Flip button for the inverse gesture, and —
 * never hidden behind the picture — the backend's eligibility verdict, warnings, conflicts and the
 * declaration affordance exactly as Session 5 reported them.
 */
export function DestinationCard({ texture, macro, mapping: m, report, preview, locked }: { texture: Texture; macro: Macro; mapping: Mapping; report: TextureReport | undefined; preview: number | undefined; locked: boolean }) {
  const { rig, profiles, updateTexture } = useRigStore();
  const coverage = useLiveStore((s) => s.coverage);
  const [noteDraft, setNoteDraft] = useState(m.override_note ?? "");
  if (!rig) return null;
  const inst = rig.instances.find((i) => i.id === m.instance_id);
  const prof = inst ? profiles[inst.profile_id] : undefined;
  const ccDef = controlOf(prof, m.cc);
  const el = report?.mappings[m.id];
  const ends = el ? { at_0: el.at_0, at_half: el.at_half, at_1: el.at_1 } : mappingEndpoints(m);
  const route = coverage?.targets[m.instance_id]?.coverage.cc;
  const edit = (fn: (x: Mapping) => void) => updateTexture(texture.id, (t) => { const mm = t.macros.find((x) => x.id === macro.id)?.mappings.find((x) => x.id === m.id); if (mm) fn(mm); });
  const remove = () => updateTexture(texture.id, (t) => { const mac = t.macros.find((x) => x.id === macro.id); if (mac) mac.mappings = mac.mappings.filter((x) => x.id !== m.id); });
  const tone = !inst ? "bad" : el?.eligible ? (el.basis === "synthetic" ? "warn" : el.basis === "user_declared" ? "warn" : "ok") : "bad";
  const conflict = el?.conflict ?? null;
  const falling = m.output_min > m.output_max;
  const constant = m.output_min === m.output_max;
  const lo = Math.min(m.output_min, m.output_max);
  const hi = Math.max(m.output_min, m.output_max);
  const pos = (v: number) => `${(v / 127) * 100}%`;
  const [docLo, docHi] = defaultRange(ccDef);
  const documentedRange = ccDef && (ccDef.min_value != null || ccDef.max_value != null);
  const clampCc = (v: number) => Math.max(0, Math.min(127, Number.isFinite(v) ? v : 0));
  const setRange = (a: number, b: number) => edit((x) => { x.output_min = clampCc(a); x.output_max = clampCc(b); });
  const name = ccDef?.name ?? (inst ? "not in the documented map" : "");
  const ok = !!el?.eligible && !conflict;
  return (
    <li className={`relative rounded-md border p-2 text-xs flex flex-col gap-1.5 ${ok ? "border-line bg-panel" : el || !inst ? "border-red-200 bg-red-50/40" : "border-line bg-panel"} ${m.enabled ? "" : "opacity-60"}`}
      data-testid={`mapping-${m.id}`} data-eligible={el?.eligible ? "true" : "false"} data-conflict={conflict ? "true" : "false"} data-value={preview ?? ""} data-direction={constant ? "constant" : falling ? "falls" : "rises"}>
      <span className={`hidden md:block absolute left-0 top-5 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-panel ${conflict || (el && !el.eligible) ? "bg-red-500" : !m.enabled ? "bg-neutral-400" : falling ? "bg-amber-500" : "bg-accent"}`} data-port={`map:${m.id}`} aria-hidden="true" />
      <div className="flex items-start gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 flex-1">
          <label className="flex items-center gap-1"><input type="checkbox" aria-label="Mapping enabled" checked={m.enabled} disabled={locked} onChange={(e) => edit((x) => { x.enabled = e.target.checked; })} /><b className="text-sm">{inst ? name : <span className="text-red-700">missing device {m.instance_id}</span>}</b></label>
          <span className="text-neutral-600">on {inst?.label ?? m.instance_id}</span>
          <span className="font-mono text-neutral-500">CC {m.cc} · ch {el?.channel ?? inst?.midi_channel ?? "?"}</span>
        </div>
        <span className="font-mono text-base shrink-0" data-testid={`mapping-value-${m.id}`} title="The value this screen asks for now; not what any pedal does">{preview ?? "—"}</span>
        {!locked && <Button variant="ghost" className="shrink-0 !py-0" aria-label={`Remove destination CC ${m.cc} on ${inst?.label ?? m.instance_id}`} onClick={remove}>✕</Button>}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Badge tone={tone}>{!inst ? "device missing" : el ? (el.eligible ? (el.basis === "documented" ? "documented continuous" : el.basis === "synthetic" ? "synthetic (simulation only)" : "user-declared") : "not eligible") : "checking…"}</Badge>
        {ccDef && behaviorOf(ccDef) !== "continuous" && <Badge tone={behaviorOf(ccDef) ? "warn" : "neutral"}>{behaviorLabel(ccDef)}</Badge>}
        {ccDef && rangeText(ccDef) && <Badge>documented {rangeText(ccDef)}</Badge>}
        {ccDef?.citation?.page && <Badge>p. {ccDef.citation.page}</Badge>}
        {ccDef && (ccDef.hardware_status === "verified" ? <Badge tone="ok">✓ verified on hardware</Badge> : ccDef.hardware_status === "failed" ? <Badge tone="bad">failed on hardware</Badge> : <Badge>not tried on hardware</Badge>)}
        {ccDef && !isReviewed(ccDef) && <Badge tone="warn">needs review</Badge>}
        {route && <Badge tone={route.status === "supported" ? "ok" : route.status === "unverified" ? "warn" : "neutral"}>route {route.status}{route.evidence ? ` · ${route.evidence.replace("_", " ")}` : ""}</Badge>}
        {conflict && <Badge tone="bad">conflicts with another destination</Badge>}
      </div>
      <div className="relative h-7 rounded bg-neutral-100 border border-line overflow-hidden" aria-hidden="true">
        {documentedRange && <div className="absolute top-0 bottom-0 bg-neutral-300/50" style={{ left: pos(docLo), width: `${((docHi - docLo) / 127) * 100}%` }} title={`documented ${docLo}–${docHi}`} />}
        <div className={`absolute top-1 bottom-1 rounded-sm ${constant ? "bg-neutral-400/60" : falling ? "bg-amber-300/80" : "bg-blue-300/80"}`} style={{ left: pos(lo), width: `${Math.max(((hi - lo) / 127) * 100, 0.8)}%` }} />
        {!constant && <span className={`absolute top-0 bottom-0 flex items-center text-[11px] ${falling ? "text-amber-900" : "text-blue-900"}`} style={falling ? { left: `calc(${pos(lo)} + 2px)` } : { right: `calc(${100 - (hi / 127) * 100}% + 2px)` }}>{falling ? "◀" : "▶"}</span>}
        {preview != null && <div className="absolute top-0 bottom-0 w-0.5 bg-neutral-900 inst-cursor" style={{ left: pos(preview) }} />}
        <span className="absolute left-1 bottom-0 text-[9px] text-neutral-400">0</span>
        <span className="absolute right-1 bottom-0 text-[9px] text-neutral-400">127</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`font-medium ${falling ? "text-amber-900" : constant ? "text-neutral-600" : "text-blue-900"}`} data-testid={`mapping-direction-${m.id}`}>{directionText(m, macro.name)}</span>
        <span className="text-[11px] text-neutral-600">macro 0 → <b className="font-mono">{ends.at_0}</b> · ½ → <b className="font-mono">{ends.at_half}</b> · 1 → <b className="font-mono">{ends.at_1}</b></span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="from"><input aria-label="Output min" type="number" min={0} max={127} className="w-16" value={m.output_min} disabled={locked} onChange={(e) => edit((x) => { x.output_min = clampCc(Number(e.target.value)); })} /></Field>
        <Field label="to"><input aria-label="Output max" type="number" min={0} max={127} className="w-16" value={m.output_max} disabled={locked} onChange={(e) => edit((x) => { x.output_max = clampCc(Number(e.target.value)); })} /></Field>
        <Button aria-label="Flip direction" title="Swap from and to: the inverse gesture" data-testid={`mapping-flip-${m.id}`} disabled={locked || constant} onClick={() => setRange(m.output_max, m.output_min)}>⇄ Flip</Button>
        {documentedRange && <Button className="!py-0 text-[11px]" disabled={locked} onClick={() => setRange(falling ? docHi : docLo, falling ? docLo : docHi)} title="Use the range the manual documents" data-testid={`mapping-range-doc-${m.id}`}>documented {docLo}–{docHi}</Button>}
        <Button className="!py-0 text-[11px]" disabled={locked} onClick={() => setRange(falling ? 127 : 0, falling ? 0 : 127)} title="Use the whole 0–127 range" data-testid={`mapping-range-full-${m.id}`}>full 0–127</Button>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-600">
        {el?.evidence && <span>control evidence: {el.evidence}</span>}
        {ccDef?.value_semantics && <span>· {ccDef.value_semantics}</span>}
        {ccDef?.hardware_note && <span>· {ccDef.hardware_note}</span>}
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
