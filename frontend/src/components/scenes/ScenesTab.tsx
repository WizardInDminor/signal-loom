"use client";

import { useState } from "react";
import { useRigStore } from "@/store/rigStore";
import type { CcValue, DeviceSceneState, Scene } from "@/lib/types";
import { Badge, Button, DiagnosticList, Field, Panel } from "@/components/ui/basics";
import { CommandPicker } from "./CommandPicker";
import { applyCc, applyPc, commandStatus } from "@/lib/commands";

export function ScenesTab() {
  const { rig, analysis, profiles, selectedSceneId, selectScene, addScene, duplicateScene, removeScene, update, assignSceneToSwitch } = useRigStore();
  const [picking, setPicking] = useState<string | null>(null);
  if (!rig) return null;
  const scenes = [...rig.scenes].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const scene = rig.scenes.find((s) => s.id === selectedSceneId) ?? scenes[0];
  const plan = analysis?.compiled.scenes.find((p) => p.scene_id === scene?.id);
  const edit = (fn: (s: Scene) => void) => update((r) => { const s = r.scenes.find((x) => x.id === scene!.id); if (s) fn(s); });
  const ml = rig.controllers.ml10x;
  const midiDevices = rig.instances.filter((i) => i.id !== rig.controllers.mc8.instance_id && i.id !== ml.instance_id && !["instrument", "amp", "power_supply"].includes(profiles[i.profile_id]?.category ?? ""));
  const stateFor = (id: string): DeviceSceneState | undefined => scene?.device_states.find((d) => d.instance_id === id);
  const setState = (id: string, fn: (d: DeviceSceneState) => void) =>
    edit((s) => {
      let d = s.device_states.find((x) => x.instance_id === id);
      if (!d) {
        d = { instance_id: id, program: null, enabled: null, cc_values: [] };
        s.device_states.push(d);
      }
      fn(d);
    });
  const move = (s: Scene, dir: -1 | 1) =>
    update((r) => {
      const sorted = [...r.scenes].sort((a, b) => a.order - b.order);
      const i = sorted.findIndex((x) => x.id === s.id);
      const j = i + dir;
      if (j < 0 || j >= sorted.length) return;
      [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      sorted.forEach((x, k) => { x.order = k; });
    });
  const loopNames = analysis?.ml10x.topology?.loops ?? [];
  const assignment = scene ? rig.controllers.mc8.banks.flatMap((b) => b.presets.filter((p) => p.scene_id === scene.id).map((p) => ({ bank: b.number, position: p.position }))) : [];
  const positions = analysis?.compiled.mc8.limits.footswitch_positions ?? "ABCDEFGHIJKLMNOP".split("");
  const switchOptions = (rig.controllers.mc8.banks.length ? rig.controllers.mc8.banks : [{ number: 1, name: "Bank 1", presets: [] }]).flatMap((b) =>
    positions.map((pos) => {
      const taken = b.presets.find((p) => p.position === pos);
      const takenBy = taken?.scene_id && taken.scene_id !== scene?.id ? rig.scenes.find((s) => s.id === taken.scene_id)?.name : null;
      return { value: `${b.number}:${pos}`, label: `Bank ${b.number} · ${pos}${takenBy ? ` (used by ${takenBy})` : taken?.short_name && !taken.scene_id ? ` (${taken.short_name})` : ""}`, disabled: !!takenBy };
    }),
  );
  const presetSummary = analysis?.ml10x.preset_paths.find((pp) => pp.preset_number === scene?.ml10x.preset_number);

  return (
    <div className="grid lg:grid-cols-[220px_1fr_1fr] gap-3 items-start">
      <Panel title="Scenes / song order" actions={<Button onClick={() => { const n = window.prompt("Scene name", `Scene ${rig.scenes.length + 1}`); if (n) addScene(n); }}>+ New</Button>}>
        <ul className="flex flex-col gap-1">
          {scenes.map((s) => (
            <li key={s.id} className="flex items-center gap-1">
              <button type="button" className={`flex-1 text-left text-sm px-2 py-1 rounded border ${scene?.id === s.id ? "border-accent bg-blue-50" : "border-transparent hover:bg-neutral-100"}`} onClick={() => selectScene(s.id)} style={{ borderLeftColor: s.color ?? undefined, borderLeftWidth: 4 }}>
                {s.name}
                <div className="text-[10px] text-neutral-500">{[s.song, s.section].filter(Boolean).join(" · ")}</div>
              </button>
              <Button variant="ghost" aria-label="Move up" onClick={() => move(s, -1)}>↑</Button>
              <Button variant="ghost" aria-label="Move down" onClick={() => move(s, 1)}>↓</Button>
            </li>
          ))}
          {!scenes.length && <li className="text-xs text-neutral-500">No scenes yet. A scene describes the desired rig state for a song section.</li>}
        </ul>
      </Panel>
      {scene ? (
        <>
          <Panel title="Desired state" actions={<div className="flex gap-1"><Button onClick={() => duplicateScene(scene.id)}>Duplicate</Button><Button variant="danger" onClick={() => window.confirm(`Delete scene "${scene.name}"?`) && removeScene(scene.id)}>Delete</Button></div>}>
            <div className="flex flex-col gap-2 text-xs">
              <Field label="MC8 switch (bank · position)" hint={rig.controllers.mc8.instance_id ? "Assigning here updates the Controllers tab; a switch already used by another scene cannot be chosen." : "Assign an MC8 instance in the Controllers tab to compile a switch plan."}>
                <select aria-label="MC8 switch" value={assignment[0] ? `${assignment[0].bank}:${assignment[0].position}` : ""} onChange={(e) => { const [b, pos] = e.target.value.split(":"); assignSceneToSwitch(scene.id, Number(b || 1), pos ?? ""); }}>
                  <option value="">— not assigned —</option>
                  {switchOptions.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Name"><input value={scene.name} onChange={(e) => edit((s) => { s.name = e.target.value; })} /></Field>
                <Field label="Song"><input value={scene.song ?? ""} onChange={(e) => edit((s) => { s.song = e.target.value || null; })} /></Field>
                <Field label="Section"><input value={scene.section ?? ""} onChange={(e) => edit((s) => { s.section = e.target.value || null; })} /></Field>
              </div>
              <fieldset className="border border-line rounded p-2">
                <legend className="px-1 font-semibold">ML10X routing {ml.instance_id ? "" : <Badge tone="warn">no ML10X assigned (Controllers tab)</Badge>}</legend>
                <Field label="Preset (0–511; bank = preset ÷ 128)">
                  <select value={scene.ml10x.preset_number ?? ""} onChange={(e) => edit((s) => { s.ml10x.preset_number = e.target.value === "" ? null : Number(e.target.value); })}>
                    <option value="">— no change —</option>
                    {ml.presets.map((p) => <option key={p.number} value={p.number}>{p.number}: {p.name || "(unnamed)"} [{p.mode}] IN → {p.chain.map((l) => `L${l}`).join(" → ")} → OUT</option>)}
                    {scene.ml10x.preset_number != null && !ml.presets.some((p) => p.number === scene.ml10x.preset_number) && <option value={scene.ml10x.preset_number}>{scene.ml10x.preset_number}: (undefined preset)</option>}
                  </select>
                </Field>
                {presetSummary && (
                  <ul className="mt-1 text-[11px] text-neutral-600" data-testid="scene-preset-paths">
                    {presetSummary.paths.map((path) => <li key={path.name}><b>{path.name}:</b> {path.summary}</li>)}
                  </ul>
                )}
                <div className="mt-1">
                  <span className="text-neutral-600">Per-loop state via CC (Simple presets only): </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {loopNames.map((l) => {
                      const v = scene.ml10x.loop_states[String(l.loop)];
                      return (
                        <label key={l.loop} className={`border rounded px-1 ${v === true ? "bg-green-50 border-green-300" : v === false ? "bg-red-50 border-red-300" : "border-line"}`}>
                          <select aria-label={`Loop ${l.loop} ${l.name}`} className="border-0 p-0 text-[11px]" value={v === undefined ? "" : v ? "on" : "off"} onChange={(e) => edit((s) => { if (e.target.value === "") delete s.ml10x.loop_states[String(l.loop)]; else s.ml10x.loop_states[String(l.loop)] = e.target.value === "on"; })}>
                            <option value="">L{l.loop} {l.send_to ?? l.name}: —</option>
                            <option value="on">L{l.loop} {l.send_to ?? l.name}: engage</option>
                            <option value="off">L{l.loop} {l.send_to ?? l.name}: bypass</option>
                          </select>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </fieldset>
              <fieldset className="border border-line rounded p-2">
                <legend className="px-1 font-semibold">Devices</legend>
                <table className="w-full">
                  <thead><tr className="text-left text-neutral-500"><th>Device</th><th>Program (PC)</th><th>Bank MSB</th><th>State</th><th className="min-w-[190px]">CC values / commands</th><th>Manual note</th></tr></thead>
                  <tbody>
                    {midiDevices.map((i) => {
                      const prof = profiles[i.profile_id];
                      const st = stateFor(i.id);
                      const hasMidi = !!prof?.midi.interfaces.length;
                      return (
                        <tr key={i.id} className="border-t border-line align-top">
                          <td className="py-1">{i.label}<div className="text-[10px] text-neutral-500">{hasMidi ? `MIDI ch ${i.midi_channel ?? prof?.midi.default_channel ?? "?"}` : "no MIDI — manual"}</div></td>
                          <td>
                            {hasMidi && <input aria-label={`${i.label} program`} type="number" min={prof?.midi.program_change.min ?? 0} max={prof?.midi.program_change.max ?? 127} className="w-16" value={st?.program?.pc ?? ""} onChange={(e) => setState(i.id, (d) => { d.program = e.target.value === "" ? null : { pc: Number(e.target.value), bank_msb: d.program?.bank_msb ?? null, bank_lsb: d.program?.bank_lsb ?? null }; })} />}
                            {hasMidi && st?.program && <div className="text-[10px] text-neutral-500">{prof?.midi.program_change.display_numbering === "one_based" ? `shown as preset ${st.program.pc + 1} on the device` : `PC ${st.program.pc} (zero-based)`}{prof?.midi.program_change.supported === null ? " · PC support unverified" : ""}</div>}
                            {hasMidi && st?.program?.command && <AppliedTag name={st.program.command.name} status={commandStatus(st.program.command, prof)} profile={prof} commandId={st.program.command.command_id} onReapply={() => { const live = prof?.midi.commands?.find((c) => c.id === st.program!.command!.command_id); if (live) setState(i.id, (d) => { d.program = applyPc(live); }); }} />}
                          </td>
                          <td>{hasMidi && st?.program && <input aria-label={`${i.label} bank MSB`} type="number" min={0} max={127} className="w-14" value={st.program.bank_msb ?? ""} onChange={(e) => setState(i.id, (d) => { if (d.program) { d.program.bank_msb = e.target.value === "" ? null : Number(e.target.value); d.program.command = null; } })} />}</td>
                          <td>
                            <select aria-label={`${i.label} state`} value={st?.enabled === true ? "on" : st?.enabled === false ? "off" : ""} onChange={(e) => setState(i.id, (d) => { d.enabled = e.target.value === "" ? null : e.target.value === "on"; })}>
                              <option value="">—</option><option value="on">engaged</option><option value="off">bypassed</option>
                            </select>
                          </td>
                          <td>
                            {hasMidi && (
                              <div className="flex flex-col gap-0.5" data-testid={`cc-values-${i.id}`}>
                                {st?.cc_values.map((cv, k) => (
                                  <div key={k} className="flex flex-col">
                                    <div className="flex gap-1 items-center">
                                      {/* Typing a different number turns the row back into a hand-set value: the snapshot would no longer describe it. */}
                                      <input aria-label="CC number" type="number" min={0} max={127} className="w-12" value={cv.cc} onChange={(e) => setState(i.id, (d) => { d.cc_values[k].cc = Number(e.target.value); d.cc_values[k].command = null; })} />=
                                      <input aria-label="CC value" type="number" min={0} max={127} className="w-12" value={cv.value} onChange={(e) => setState(i.id, (d) => { d.cc_values[k].value = Number(e.target.value); d.cc_values[k].command = null; })} />
                                      <Button variant="ghost" aria-label="Remove CC" onClick={() => setState(i.id, (d) => { d.cc_values.splice(k, 1); })}>✕</Button>
                                    </div>
                                    {cv.command && <AppliedTag name={cv.command.name} valueLabel={cv.command.value_label} status={commandStatus(cv.command, prof)} profile={prof} commandId={cv.command.command_id} onReapply={() => { const live = prof?.midi.commands?.find((c) => c.id === cv.command!.command_id); if (!live) return; try { const next = applyCc(live, live.value_mode === "fixed" ? undefined : cv.value); setState(i.id, (d) => { d.cc_values[k] = next; }); } catch (err) { window.alert((err as Error).message); } }} />}
                                  </div>
                                ))}
                                <div className="flex gap-1 whitespace-nowrap">
                                  <Button variant="primary" className="!py-0.5 !px-1.5 !text-[11px]" onClick={() => setPicking(i.id)} data-testid={`add-command-${i.id}`} title="Pick a named command from the device's library">+ Command</Button>
                                  <Button variant="ghost" className="!py-0.5 !px-1.5 !text-[11px]" onClick={() => setState(i.id, (d) => { d.cc_values.push({ cc: prof?.midi.cc_map[0]?.cc ?? 1, value: 127 }); })} title="Type a CC number and value by hand">+ CC by number</Button>
                                </div>
                                {prof?.midi.cc_map.length ? <span className="text-[10px] text-neutral-400">documented: {prof.midi.cc_map.map((c) => `${c.cc} ${c.name}`).join(", ")}</span> : null}
                              </div>
                            )}
                          </td>
                          <td><input aria-label={`${i.label} manual note`} value={st?.manual_note ?? ""} placeholder="e.g. gain at 2 o'clock" onChange={(e) => setState(i.id, (d) => { d.manual_note = e.target.value || null; })} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </fieldset>
              <Field label="Manual steps (one per line)">
                <textarea rows={2} value={scene.manual_steps.join("\n")} onChange={(e) => edit((s) => { s.manual_steps = e.target.value.split("\n").filter((x) => x.trim()); })} />
              </Field>
              <Field label="Notes"><textarea rows={2} value={scene.notes ?? ""} onChange={(e) => edit((s) => { s.notes = e.target.value || null; })} /></Field>
            </div>
          </Panel>
          <Panel title={`Compiled MIDI plan${plan ? ` — ${plan.message_count} messages` : ""}`}>
            {plan ? (
              <div className="flex flex-col gap-2 text-xs">
                <table className="w-full">
                  <thead><tr className="text-left text-neutral-500"><th>#</th><th>Target</th><th>Ch</th><th>Type</th><th>#</th><th>Val</th><th>Why</th></tr></thead>
                  <tbody>
                    {plan.messages.map((m, k) => (
                      <tr key={k} className="border-t border-line align-top">
                        <td>{k + 1}</td><td>{m.target_label}</td><td>{m.channel}</td><td className="uppercase">{m.type}</td><td>{m.number}</td><td>{m.value ?? ""}</td>
                        <td className="text-neutral-600">{m.explanation}{!m.deterministic && <Badge tone="warn">toggle</Badge>}</td>
                      </tr>
                    ))}
                    {!plan.messages.length && <tr><td colSpan={7} className="text-neutral-500 py-1">No MIDI messages compile from this scene.</td></tr>}
                  </tbody>
                </table>
                {plan.manual_steps.length > 0 && (
                  <div><span className="font-semibold">Manual steps:</span><ul className="list-disc pl-4">{plan.manual_steps.map((s, k) => <li key={k}>{s}</li>)}</ul></div>
                )}
                <DiagnosticList items={plan.diagnostics} empty="Compiles cleanly." />
              </div>
            ) : <p className="text-xs text-neutral-500">Compiling…</p>}
          </Panel>
        </>
      ) : <Panel title="Scene"><p className="text-xs text-neutral-500">Create a scene to begin.</p></Panel>}
      {picking && scene && (() => {
        const inst = rig.instances.find((x) => x.id === picking);
        const prof = inst ? profiles[inst.profile_id] : undefined;
        if (!inst || !prof) return null;
        return (
          <CommandPicker
            instance={inst}
            profile={prof}
            state={stateFor(inst.id)}
            onClose={() => setPicking(null)}
            onApplyPc={(p) => setState(inst.id, (d) => { d.program = p; })}
            onApplyCc={(cv: CcValue, replace) => setState(inst.id, (d) => { if (replace) d.cc_values = d.cc_values.filter((x) => x.cc !== cv.cc); d.cc_values.push(cv); })}
          />
        );
      })()}
    </div>
  );
}

/** Under a scene value: which library command it came from and whether that command still says the same. */
function AppliedTag({ name, valueLabel, status, profile, commandId, onReapply }: { name: string; valueLabel?: string | null; status: "ok" | "changed" | "removed" | null; profile: import("@/lib/types").DeviceProfile | undefined; commandId: string; onReapply: () => void }) {
  const live = profile?.midi.commands?.find((c) => c.id === commandId);
  const cite = live?.citation;
  const present = cite ? profile?.document_files?.find((f) => f.document_id === cite.document_id)?.present : false;
  return (
    <div className="text-[10px] text-neutral-500 flex flex-wrap items-center gap-1" data-testid="applied-command" data-status={status ?? ""}>
      <span>{live?.favorite ? "★ " : ""}“{name}”{valueLabel ? ` · ${valueLabel}` : ""}</span>
      {status === "changed" && <Badge tone="warn">definition changed — review</Badge>}
      {status === "removed" && <Badge tone="warn">command removed</Badge>}
      {status === "changed" && <button type="button" className="underline" onClick={onReapply} data-testid="reapply-command">reapply</button>}
      {cite && present && <a className="underline" href={`/documents/${cite.document_id}${cite.page ? `?page=${cite.page}` : ""}`} target="_blank" rel="noreferrer" title="Open the cited manual page">manual{cite.page ? ` p. ${cite.page}` : ""} ↗</a>}
    </div>
  );
}
