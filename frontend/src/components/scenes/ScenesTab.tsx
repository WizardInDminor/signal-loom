"use client";

import { useRigStore } from "@/store/rigStore";
import type { DeviceSceneState, Scene } from "@/lib/types";
import { Badge, Button, DiagnosticList, Field, Panel } from "@/components/ui/basics";

export function ScenesTab() {
  const { rig, analysis, profiles, selectedSceneId, selectScene, addScene, removeScene, update } = useRigStore();
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
          <Panel title="Desired state" actions={<Button variant="danger" onClick={() => window.confirm(`Delete scene "${scene.name}"?`) && removeScene(scene.id)}>Delete</Button>}>
            <div className="flex flex-col gap-2 text-xs">
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
                  <thead><tr className="text-left text-neutral-500"><th>Device</th><th>Program (PC)</th><th>Bank MSB</th><th>State</th><th>CC values</th><th>Manual note</th></tr></thead>
                  <tbody>
                    {midiDevices.map((i) => {
                      const prof = profiles[i.profile_id];
                      const st = stateFor(i.id);
                      const hasMidi = !!prof?.midi.interfaces.length;
                      return (
                        <tr key={i.id} className="border-t border-line align-top">
                          <td className="py-1">{i.label}<div className="text-[10px] text-neutral-500">{hasMidi ? `MIDI ch ${i.midi_channel ?? prof?.midi.default_channel ?? "?"}` : "no MIDI — manual"}</div></td>
                          <td>{hasMidi && <input aria-label={`${i.label} program`} type="number" min={0} max={127} className="w-16" value={st?.program?.pc ?? ""} onChange={(e) => setState(i.id, (d) => { d.program = e.target.value === "" ? null : { pc: Number(e.target.value), bank_msb: d.program?.bank_msb ?? null, bank_lsb: d.program?.bank_lsb ?? null }; })} />}</td>
                          <td>{hasMidi && st?.program && <input aria-label={`${i.label} bank MSB`} type="number" min={0} max={127} className="w-14" value={st.program.bank_msb ?? ""} onChange={(e) => setState(i.id, (d) => { if (d.program) d.program.bank_msb = e.target.value === "" ? null : Number(e.target.value); })} />}</td>
                          <td>
                            <select aria-label={`${i.label} state`} value={st?.enabled === true ? "on" : st?.enabled === false ? "off" : ""} onChange={(e) => setState(i.id, (d) => { d.enabled = e.target.value === "" ? null : e.target.value === "on"; })}>
                              <option value="">—</option><option value="on">engaged</option><option value="off">bypassed</option>
                            </select>
                          </td>
                          <td>
                            {hasMidi && (
                              <div className="flex flex-col gap-0.5">
                                {st?.cc_values.map((cv, k) => (
                                  <div key={k} className="flex gap-1 items-center">
                                    <input aria-label="CC number" type="number" min={0} max={127} className="w-12" value={cv.cc} onChange={(e) => setState(i.id, (d) => { d.cc_values[k].cc = Number(e.target.value); })} />=
                                    <input aria-label="CC value" type="number" min={0} max={127} className="w-12" value={cv.value} onChange={(e) => setState(i.id, (d) => { d.cc_values[k].value = Number(e.target.value); })} />
                                    <Button variant="ghost" aria-label="Remove CC" onClick={() => setState(i.id, (d) => { d.cc_values.splice(k, 1); })}>✕</Button>
                                  </div>
                                ))}
                                <Button variant="ghost" onClick={() => setState(i.id, (d) => { d.cc_values.push({ cc: prof?.midi.cc_map[0]?.cc ?? 1, value: 127 }); })}>+ CC</Button>
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
    </div>
  );
}
