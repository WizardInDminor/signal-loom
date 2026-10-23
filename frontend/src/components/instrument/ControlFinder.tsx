"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CcDef, DeviceInstance, DeviceProfile, FunctionRole, Macro, Texture } from "@/lib/types";
import { FUNCTION_ROLES } from "@/lib/types";
import { ROLE_LABEL, classifyControl, defaultRange, isSynthetic, roleOf } from "@/lib/instrument";
import { behaviorLabel, rangeText } from "@/lib/knowledge";
import { Badge, Button, EvidenceBadge, Field } from "@/components/ui/basics";

export interface MapRequest { instance_id: string; cc: number; output_min: number; output_max: number }

/**
 * Find a documented pedal control by its musical name or by the pedal, grouped by the function the
 * pedal serves in this texture, and map it to the macro in one click. What is offered mirrors the
 * backend's eligibility rules (`classifyControl`): sweeps map; *not stated* controls map and will
 * ask for the user's declaration; switches, bank/channel-mode CCs, bypass CCs and *proposed*
 * controls show the reason instead of a button. *Any CC number…* keeps the Session 5 form for a
 * control the manual does not list yet. Nothing here sends MIDI.
 */
export function ControlFinder({ texture, macro, devices, profiles, locked, onMap, onClose }: { texture: Texture; macro: Macro; devices: DeviceInstance[]; profiles: Record<string, DeviceProfile>; locked: boolean; onMap: (m: MapRequest) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<FunctionRole | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { search.current?.focus(); }, []);
  const q = query.trim().toLowerCase();
  const mapped = new Set(macro.mappings.map((m) => `${m.instance_id}:${m.cc}`));

  const groups = useMemo(() => {
    const byRole = new Map<FunctionRole, { inst: DeviceInstance; prof: DeviceProfile | undefined; controls: CcDef[] }[]>();
    for (const inst of devices) {
      const prof = profiles[inst.profile_id];
      const r = roleOf(texture, inst, prof);
      if (role && r !== role) continue;
      const hay = (c: CcDef) => [inst.label, prof?.model ?? "", ROLE_LABEL[r], `cc ${c.cc}`, `cc${c.cc}`, c.name, c.value_semantics ?? "", behaviorLabel(c)].join(" ").toLowerCase();
      const controls = [...(prof?.midi.cc_map ?? [])].sort((a, b) => a.cc - b.cc).filter((c) => !q || hay(c).includes(q));
      const deviceMatches = !q || `${inst.label} ${prof?.model ?? ""} ${ROLE_LABEL[r]}`.toLowerCase().includes(q);
      if (!controls.length && !deviceMatches) continue;
      byRole.set(r, [...(byRole.get(r) ?? []), { inst, prof, controls }]);
    }
    return FUNCTION_ROLES.filter((r) => byRole.has(r)).map((r) => ({ role: r, devices: byRole.get(r)! }));
  }, [devices, profiles, texture, role, q]);

  const presentRoles = useMemo(() => new Set(devices.map((d) => roleOf(texture, d, profiles[d.profile_id]))), [devices, profiles, texture]);
  const total = groups.reduce((n, g) => n + g.devices.reduce((k, d) => k + d.controls.length, 0), 0);

  return (
    <div className="rounded-md border border-accent bg-blue-50/40 p-2 flex flex-col gap-2 text-xs" role="region" aria-label={`Find a control for ${macro.name}`} data-testid="control-finder" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={search} type="search" aria-label="Find a control" placeholder="echo, mix, decay, Volante…" className="flex-1 min-w-[160px]" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="finder-search" />
        <span className="text-neutral-500" data-testid="finder-count">{total} control{total === 1 ? "" : "s"}</span>
        <Button variant="ghost" onClick={onClose} aria-label="Close the control finder">Close</Button>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by function">
        <button type="button" className={`rounded-full border px-2 py-0.5 ${role === null ? "bg-accent text-white border-accent" : "bg-panel border-line hover:bg-neutral-100"}`} aria-pressed={role === null} onClick={() => setRole(null)}>All</button>
        {FUNCTION_ROLES.filter((r) => presentRoles.has(r)).map((r) => (
          <button key={r} type="button" className={`rounded-full border px-2 py-0.5 ${role === r ? "bg-accent text-white border-accent" : "bg-panel border-line hover:bg-neutral-100"}`} aria-pressed={role === r} onClick={() => setRole(role === r ? null : r)} data-testid={`finder-role-${r}`}>{ROLE_LABEL[r]}</button>
        ))}
      </div>
      {!devices.length && <p className="text-neutral-600">No MIDI-capable pedal on this rig yet. Place one on the Board, or declare a pedal&apos;s MIDI input in the Device library.</p>}
      {devices.length > 0 && !groups.length && <p className="text-neutral-600" data-testid="finder-empty">Nothing matches “{query}”. Try the pedal&apos;s name, a word from the manual (“mix”, “time”), or document the control in the Knowledge Workbench.</p>}
      <div className="flex flex-col gap-2 max-h-[50vh] overflow-auto pr-1">
        {groups.map((g) => (
          <div key={g.role} data-testid={`finder-group-${g.role}`}>
            <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">{ROLE_LABEL[g.role]}</div>
            {g.devices.map(({ inst, prof, controls }) => (
              <div key={inst.id} className="rounded border border-line bg-panel mb-1" data-testid={`finder-device-${inst.id}`}>
                <div className="flex flex-wrap items-center gap-2 px-2 py-1 border-b border-line">
                  <b>{inst.label}</b>
                  <span className="text-neutral-500">{prof?.manufacturer} {prof?.model} · ch {inst.midi_channel ?? prof?.midi.default_channel ?? "?"}</span>
                  {isSynthetic(prof) && <Badge tone="warn">synthetic</Badge>}
                  {prof && !prof.provenance.source.startsWith("synthetic") && <Link href={`/catalog/${encodeURIComponent(prof.id)}/workbench`} className="ml-auto underline text-neutral-600" title="Document more controls beside the manual">Knowledge Workbench →</Link>}
                </div>
                {controls.length ? (
                  <ul className="divide-y divide-line">
                    {controls.map((c) => {
                      const offer = prof ? classifyControl(prof, c) : { kind: "refused" as const, label: "unknown", reason: "Profile not loaded." };
                      const already = mapped.has(`${inst.id}:${c.cc}`);
                      const [lo, hi] = defaultRange(c);
                      return (
                        <li key={c.cc} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1" data-testid={`finder-control-${inst.id}-${c.cc}`} data-offer={offer.kind}>
                          <span className="text-sm">{c.name}</span>
                          <span className="font-mono text-neutral-500">CC {c.cc}</span>
                          <Badge tone={offer.kind === "sweep" ? "ok" : offer.kind === "declare" ? "neutral" : "warn"}>{offer.kind === "sweep" ? "sweep" : offer.label}</Badge>
                          {rangeText(c) && <span className="text-neutral-500">{rangeText(c)}</span>}
                          <EvidenceBadge evidence={c.evidence} />
                          {c.citation?.page && <span className="text-neutral-500">p. {c.citation.page}</span>}
                          {c.hardware_status === "verified" && <Badge tone="ok">✓ verified</Badge>}
                          {already && <Badge>mapped</Badge>}
                          <span className="ml-auto flex items-center gap-1">
                            {offer.kind === "refused" ? <span className="text-neutral-500 italic" title={offer.reason}>{offer.reason}</span> : (
                              <>
                                {offer.kind === "declare" && <span className="text-neutral-500 italic">not stated as a sweep — you will be asked to declare it</span>}
                                <Button variant={offer.kind === "sweep" ? "primary" : "default"} disabled={locked || already} data-testid={`finder-map-${inst.id}-${c.cc}`} onClick={() => onMap({ instance_id: inst.id, cc: c.cc, output_min: lo, output_max: hi })} title={`Add ${c.name} to ${macro.name}, ${lo} → ${hi}`}>{already ? "Mapped" : `Map to ${macro.name}`}</Button>
                              </>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="px-2 py-1 text-neutral-500">{q ? "No matching control on this pedal." : "No documented controls yet — enter them from the manual in the Knowledge Workbench."}</p>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-line pt-1">
        <button type="button" className="underline text-neutral-600" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced} data-testid="finder-advanced-toggle">Any CC number… (a control the manual does not list yet)</button>
        {advanced && <AnyCcForm devices={devices} profiles={profiles} onAdd={onMap} locked={locked} />}
      </div>
    </div>
  );
}

function AnyCcForm({ devices, profiles, onAdd, locked }: { devices: DeviceInstance[]; profiles: Record<string, DeviceProfile>; onAdd: (m: MapRequest) => void; locked: boolean }) {
  const [instId, setInstId] = useState(devices[0]?.id ?? "");
  const [cc, setCc] = useState<number>(-1);
  const [lo, setLo] = useState(0);
  const [hi, setHi] = useState(127);
  const prof = profiles[devices.find((d) => d.id === instId)?.profile_id ?? ""];
  const known = prof?.midi.cc_map.find((c) => c.cc === cc);
  return (
    <div className="mt-1 flex flex-wrap items-end gap-2" data-testid="mapping-add-form">
      <Field label="Device">
        <select aria-label="Destination device" value={instId} onChange={(e) => setInstId(e.target.value)}>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </Field>
      <Field label="CC number" hint={known ? `documented as “${known.name}”` : "not in the documented map: the backend will decide whether it can be swept"}>
        <input aria-label="Custom CC number" type="number" min={0} max={127} className="w-20" value={cc < 0 ? "" : cc} onChange={(e) => setCc(e.target.value === "" ? -1 : Number(e.target.value))} />
      </Field>
      <Field label="From"><input aria-label="Range from" type="number" min={0} max={127} className="w-16" value={lo} onChange={(e) => setLo(Number(e.target.value))} /></Field>
      <Field label="To"><input aria-label="Range to" type="number" min={0} max={127} className="w-16" value={hi} onChange={(e) => setHi(Number(e.target.value))} /></Field>
      <Button variant="primary" disabled={locked || !instId || cc < 0 || cc > 127} data-testid="mapping-add-confirm" onClick={() => onAdd({ instance_id: instId, cc, output_min: Math.max(0, Math.min(127, lo)), output_max: Math.max(0, Math.min(127, hi)) })}>Add</Button>
    </div>
  );
}
