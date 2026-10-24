"use client";

import { useMemo, useRef, useState } from "react";
import { useRigStore } from "@/store/rigStore";
import { useLiveStore } from "@/store/liveStore";
import type { DeviceInstance, FunctionRole, Macro, Texture, TextureReport } from "@/lib/types";
import { FUNCTION_ROLES } from "@/lib/types";
import { type MacroPreview, ROLE_LABEL, defaultRole, isMidiDevice, isSynthetic, roleOf, suggestRole } from "@/lib/instrument";
import { newId } from "@/lib/api";
import { Badge, Button } from "@/components/ui/basics";
import { MacroSource } from "./MacroSource";
import { DestinationCard } from "./DestinationCard";
import { ControlFinder, type MapRequest } from "./ControlFinder";
import { PatchCords, type Cord } from "./PatchCords";

/**
 * "The patch — what moves what": the rig grouped by musical function (an editable lens with
 * user-correctable suggestions for devices that would land in *Other*; never a signal-flow claim),
 * then, per macro, the source card on the left, cords, and the destinations on the right grouped by
 * pedal, with the control finder to add more. Editing anything here is an ordinary rig edit.
 */
export function PatchBay({ texture, report, previews, structuralLocked, performing }: { texture: Texture; report: TextureReport | undefined; previews: Record<string, MacroPreview>; structuralLocked: boolean; performing: boolean }) {
  const { rig, profiles, updateTexture } = useRigStore();
  const coverage = useLiveStore((s) => s.coverage);
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
  const suggestionFor = (d: DeviceInstance) => {
    if (texture.function_roles[d.id]) return null; // the user already decided for this texture
    const prof = profiles[d.profile_id];
    return defaultRole(prof) === "other" ? suggestRole(prof) : null;
  };

  return (
    <section className="flex flex-col gap-4" data-testid="patch-bay" aria-label="The patch: what moves what">
      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">The rig, by function <span className="normal-case">(an organisational lens for this texture — relabel any pedal; it says nothing about the audio path)</span></div>
        <div className="flex flex-wrap gap-2" data-testid="function-groups">
          {FUNCTION_ROLES.filter((r) => groups.has(r)).map((role) => (
            <div key={role} className="rounded-md border border-line bg-panel px-2 py-1.5 min-w-[150px] max-w-full" data-testid={`function-group-${role}`}>
              <div className="text-[11px] font-semibold text-neutral-600">{ROLE_LABEL[role]}</div>
              <ul className="flex flex-col gap-1 mt-1">
                {groups.get(role)!.map((d) => {
                  const prof = profiles[d.profile_id];
                  const route = routeOf(d.id);
                  const n = mappedCount(d.id);
                  const suggestion = suggestionFor(d);
                  return (
                    <li key={d.id} className="text-xs flex flex-col" data-testid={`function-device-${d.id}`}>
                      <div className="flex items-center gap-1 flex-wrap">
                        <b>{d.label}</b>
                        {isSynthetic(prof) && <Badge tone="warn">synthetic</Badge>}
                        {n > 0 && <Badge tone="ok">{n} mapped</Badge>}
                        <span className="text-neutral-500">· {prof?.midi.cc_map.length ?? 0} documented control{prof?.midi.cc_map.length === 1 ? "" : "s"}</span>
                      </div>
                      <div className="text-neutral-500 flex items-center gap-1 flex-wrap">
                        <span>{prof?.model} · ch {channelOf(d) ?? "?"}</span>
                        <span>· CC route {route ? <Badge tone={route.status === "supported" ? "ok" : route.status === "unverified" ? "warn" : route.status === "unreachable" ? "neutral" : "bad"}>{route.status}</Badge> : <Badge>unknown (not connected)</Badge>}</span>
                        <select aria-label={`Function of ${d.label}`} className="!py-0 !px-1 text-[11px]" value={role} disabled={structuralLocked} onChange={(e) => edit((t) => { t.function_roles[d.id] = e.target.value; })}>
                          {FUNCTION_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      </div>
                      {suggestion && (
                        <div className="mt-1 flex flex-wrap items-center gap-1 rounded border border-dashed border-amber-300 bg-amber-50/60 px-1.5 py-1" data-testid={`role-suggestion-${d.id}`}>
                          <span>Suggested: <b>{ROLE_LABEL[suggestion.role]}</b> <span className="text-neutral-500">— from {suggestion.basis}</span></span>
                          <Button className="!py-0 !px-1.5 text-[11px]" disabled={structuralLocked} data-testid={`role-suggestion-use-${d.id}`} onClick={() => edit((t) => { t.function_roles[d.id] = suggestion.role; })}>Use</Button>
                          <Button variant="ghost" className="!py-0 !px-1.5 text-[11px]" disabled={structuralLocked} data-testid={`role-suggestion-keep-${d.id}`} onClick={() => edit((t) => { t.function_roles[d.id] = "other"; })}>Keep Other</Button>
                        </div>
                      )}
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
        <MacroPatch key={macro.id} texture={texture} macro={macro} devices={devices} report={report} preview={previews[macro.id]} structuralLocked={structuralLocked} performing={performing} />
      ))}
      {!texture.macros.length && (
        <div className="text-xs text-neutral-600 flex flex-wrap items-center gap-2">
          <span>This texture has no macro yet. A macro is the one gesture that moves several pedals at once.</span>
          <Button onClick={() => edit((t) => { t.macros.push({ id: newId("macro"), name: "Bloom", base: 0.5, mappings: [], lfo: { enabled: false, shape: "triangle", beats_per_cycle: 8, depth: 0.25 } }); })} disabled={structuralLocked}>+ Add a macro</Button>
        </div>
      )}
    </section>
  );
}

function MacroPatch({ texture, macro, devices, report, preview, structuralLocked, performing }: { texture: Texture; macro: Macro; devices: DeviceInstance[]; report: TextureReport | undefined; preview: MacroPreview | undefined; structuralLocked: boolean; performing: boolean }) {
  const { rig, profiles, updateTexture } = useRigStore();
  const [finding, setFinding] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // Stable between preview frames: the cords re-measure only when a destination, its direction or its verdict changes.
  const cords = useMemo<Cord[]>(() => macro.mappings.map((m) => {
    const el = report?.mappings[m.id];
    const tone = (el && !el.eligible) || el?.conflict ? "bad" : !m.enabled ? "off" : m.output_min > m.output_max ? "falls" : "rises";
    return { from: `macro:${macro.id}`, to: `map:${m.id}`, tone };
  }), [macro.id, macro.mappings, report]);
  if (!rig) return null;
  const onMap = (m: MapRequest) => {
    updateTexture(texture.id, (t) => { t.macros.find((x) => x.id === macro.id)?.mappings.push({ id: newId("map"), ...m, label: null, enabled: true, user_override: false, override_note: null }); });
  };
  const closeFinder = () => { setFinding(false); addButton.current?.focus(); };
  // Destinations grouped by pedal, in first-appearance order; a missing device gets its own group.
  const byDevice: { inst: DeviceInstance | undefined; id: string; mappings: typeof macro.mappings }[] = [];
  for (const m of macro.mappings) {
    let g = byDevice.find((x) => x.id === m.instance_id);
    if (!g) { g = { inst: rig.instances.find((i) => i.id === m.instance_id), id: m.instance_id, mappings: [] }; byDevice.push(g); }
    g.mappings.push(m);
  }
  const distinct = new Set(macro.mappings.map((m) => m.instance_id)).size;
  return (
    <div className="flex flex-col gap-2" data-testid={`patch-macro-${macro.id}`}>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold">{macro.name}</span>
        <span className="text-neutral-400">→</span>
        <span className="text-neutral-600">{macro.mappings.length} destination{macro.mappings.length === 1 ? "" : "s"} on {distinct} pedal{distinct === 1 ? "" : "s"}</span>
        {!structuralLocked && <Button ref={addButton} className="ml-auto" variant={macro.mappings.length ? "default" : "primary"} onClick={() => setFinding(!finding)} aria-expanded={finding} data-testid={`mapping-add-${macro.id}`}>+ Add a destination</Button>}
      </div>
      <div ref={container} className="relative grid md:grid-cols-[260px_minmax(0,1fr)] gap-x-8 gap-y-3 items-start">
        <PatchCords container={container} cords={cords} moving={macro.lfo.enabled} />
        <MacroSource texture={texture} macro={macro} preview={preview} performing={performing} structuralLocked={structuralLocked} />
        <div className="flex flex-col gap-2 min-w-0 relative">
          {byDevice.map((g) => {
            const prof = g.inst ? profiles[g.inst.profile_id] : undefined;
            const role = g.inst ? roleOf(texture, g.inst, prof) : null;
            return (
              <div key={g.id} className="flex flex-col gap-1" data-testid={`dest-group-${g.id}`}>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-600 pl-2">
                  <b className="text-foreground">{g.inst?.label ?? `missing device ${g.id}`}</b>
                  {role && <Badge>{ROLE_LABEL[role]}</Badge>}
                  {prof && <span>{prof.manufacturer} {prof.model}</span>}
                </div>
                <ul className="flex flex-col gap-2 pl-2">
                  {g.mappings.map((m) => <DestinationCard key={m.id} texture={texture} macro={macro} mapping={m} report={report} preview={preview?.values[m.id]} locked={structuralLocked} />)}
                </ul>
              </div>
            );
          })}
          {!macro.mappings.length && (
            <div className="text-xs text-neutral-600 border border-dashed border-line rounded-md p-3 flex flex-col gap-1" data-testid={`patch-empty-${macro.id}`}>
              <b className="text-foreground">No destination yet.</b>
              <span>A destination is one documented pedal control that {macro.name} moves through a range you choose. Two or more on different pedals make a whole-rig gesture.</span>
              {!structuralLocked && <div><Button variant="primary" onClick={() => setFinding(true)}>Find a control</Button></div>}
            </div>
          )}
          {finding && !structuralLocked && <ControlFinder texture={texture} macro={macro} devices={devices} profiles={profiles} locked={structuralLocked} onMap={onMap} onClose={closeFinder} />}
        </div>
      </div>
    </div>
  );
}
