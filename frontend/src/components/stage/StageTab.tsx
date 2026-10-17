"use client";

import { useEffect, useMemo, useState } from "react";
import { useRigStore } from "@/store/rigStore";
import { Badge, Button, DiagnosticList, Panel } from "@/components/ui/basics";
import { sceneDiff, sceneStory, setlist } from "@/lib/stage";
import { FLOW_COLOR, MIDI_COLOR, StageCanvas, VIRTUAL_COLOR } from "./StageCanvas";
import { Mc8Face } from "./Mc8Face";

/**
 * Stage: a scene-first, physical-first view of the rig. Pick a scene (or step through the
 * setlist with the arrow keys) and the board shows the real signal path, every pedal's state,
 * which MC8 switch recalls it and where its MIDI goes. Read-only: nothing here edits the rig.
 */
export function StageTab() {
  const { rig, analysis, profiles, selectedSceneId, selectScene } = useRigStore();
  const [showMidi, setShowMidi] = useState(true);
  const [showAllCables, setShowAllCables] = useState(false);
  const [fireKey, setFireKey] = useState(0);
  const scenes = useMemo(() => (rig ? setlist(rig) : []), [rig]);
  const index = Math.max(0, scenes.findIndex((s) => s.id === selectedSceneId));
  const scene = scenes[index] ?? null;
  const prevScene = index > 0 ? scenes[index - 1] : null;
  const story = useMemo(() => (rig && scene ? sceneStory(rig, analysis, profiles, scene) : null), [rig, analysis, profiles, scene]);
  const prevStory = useMemo(() => (rig && prevScene ? sceneStory(rig, analysis, profiles, prevScene) : null), [rig, analysis, profiles, prevScene]);
  const diff = useMemo(() => (story ? sceneDiff(prevStory, story) : null), [story, prevStory]);

  const go = (i: number) => {
    if (!scenes.length) return;
    const next = scenes[(i + scenes.length) % scenes.length];
    selectScene(next.id);
    setFireKey((k) => k + 1);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") go(index - 1);
      else if (e.key === " ") setFireKey((k) => k + 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // re-bound each render on purpose: `index` and `scenes` are cheap closures
  if (!rig) return null;

  const messageCounts: Record<string, number> = {};
  for (const b of analysis?.compiled.mc8.banks ?? []) for (const sw of b.switches) messageCounts[`${b.number}:${sw.position}`] = sw.message_count;
  const positions = analysis?.compiled.mc8.limits.footswitch_positions ?? "ABCDEFGHIJKLMNOP".split("");

  return (
    <div className="grid lg:grid-cols-[210px_1fr_360px] gap-3 items-start">
      <Panel title="Setlist" actions={<div className="flex gap-1"><Button variant="ghost" aria-label="Previous scene" onClick={() => go(index - 1)} disabled={scenes.length < 2}>↑</Button><Button variant="ghost" aria-label="Next scene" onClick={() => go(index + 1)} disabled={scenes.length < 2}>↓</Button></div>}>
        <ol className="flex flex-col gap-1" aria-label="Scenes in setlist order" data-testid="setlist">
          {scenes.map((s, i) => {
            const mc8 = rig.controllers.mc8.banks.flatMap((b) => b.presets.filter((p) => p.scene_id === s.id).map((p) => `${b.number}${p.position}`))[0];
            const active = s.id === scene?.id;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  data-testid={`setlist-${s.id}`}
                  onClick={() => { selectScene(s.id); setFireKey((k) => k + 1); }}
                  className={`w-full text-left rounded-md border px-2 py-1.5 transition ${active ? "border-amber-400 bg-amber-50 shadow-sm" : "border-transparent hover:bg-neutral-100"}`}
                  style={{ borderLeftColor: s.color ?? (active ? "#fbbf24" : "transparent"), borderLeftWidth: 4 }}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] text-neutral-400 w-4 tabular-nums">{i + 1}</span>
                    <span className="text-sm font-medium flex-1 truncate">{s.name}</span>
                    {mc8 && <span className="font-mono text-[10px] text-neutral-500">{mc8}</span>}
                  </div>
                  <div className="text-[10px] text-neutral-500 pl-6">{[s.song, s.section].filter(Boolean).join(" · ") || " "}</div>
                </button>
              </li>
            );
          })}
          {!scenes.length && <li className="text-xs text-neutral-500">No scenes yet. Create one in the Scenes tab and come back: the Stage shows what each scene does to the board.</li>}
        </ol>
        <p className="text-[10px] text-neutral-400 mt-2">↑ ↓ or ← → step through the set · Space replays the scene</p>
      </Panel>

      <div className="flex flex-col gap-2 min-w-0">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {story ? (
            <h2 className="text-base font-semibold flex items-center gap-2">
              <span className="text-neutral-400 font-normal">{index + 1}/{scenes.length}</span>
              {story.scene.name}
              {story.mc8 ? <Badge tone="warn">MC8 bank {story.mc8.bank} · switch {story.mc8.position}</Badge> : <Badge>no MC8 switch</Badge>}
              {story.presetDef && <Badge tone="ok">ML10X preset {story.presetDef.number} · {story.presetDef.name}</Badge>}
            </h2>
          ) : <h2 className="text-base font-semibold">Stage</h2>}
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1"><input type="checkbox" checked={showMidi} onChange={(e) => setShowMidi(e.target.checked)} /> MIDI pulses</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={showAllCables} onChange={(e) => setShowAllCables(e.target.checked)} /> all cables</label>
            <Button onClick={() => setFireKey((k) => k + 1)} aria-label="Replay scene">▶ Replay</Button>
          </div>
        </div>
        <StageCanvas story={story} changed={diff?.changedInstances ?? new Set()} view={{ showMidi, showAllCables, fireKey }} />
        <div className="flex flex-wrap gap-4 text-[11px] text-neutral-600 px-1">
          <span className="flex items-center gap-1"><i className="inline-block w-5 h-1 rounded" style={{ background: FLOW_COLOR.L }} /> left / Tip conductor</span>
          <span className="flex items-center gap-1"><i className="inline-block w-5 h-1 rounded" style={{ background: FLOW_COLOR.R }} /> right / Ring conductor</span>
          <span className="flex items-center gap-1"><i className="inline-block w-5 border-t border-dashed" style={{ borderColor: VIRTUAL_COLOR, background: "#0f172a" }} /> routing inside the ML10X (preset, not a cable)</span>
          <span className="flex items-center gap-1"><i className="inline-block w-5 h-1 rounded" style={{ background: MIDI_COLOR }} /> MIDI cable carrying this scene&apos;s messages</span>
          <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" /> pedal engaged</span>
          <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-full bg-neutral-700" /> bypassed</span>
          <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-full border border-dashed border-neutral-500" /> not set by the scene</span>
          <span>faded pedal = not in this scene&apos;s path</span>
        </div>
        {rig.controllers.mc8.instance_id ? (
          <Mc8Face rig={rig} positions={positions} current={story?.mc8 ?? null} messageCounts={messageCounts} onSelectScene={(id) => { selectScene(id); setFireKey((k) => k + 1); }} />
        ) : (
          <p className="text-xs text-neutral-500">No MC8 assigned (Controllers tab), so there is no switch to press for this scene.</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Panel title="What happens">
          {story ? (
            <div className="flex flex-col gap-2 text-xs" data-testid="stage-story">
              <div>
                <span className="font-semibold">Press</span>{" "}
                {story.mc8 ? <>MC8 bank {story.mc8.bank} switch <b>{story.mc8.position}</b> (“{story.mc8.short_name || story.scene.name.slice(0, 10)}”)</> : <span className="text-neutral-500">— this scene is not on an MC8 switch yet (assign one in Scenes)</span>}
              </div>
              {story.preset ? (
                <div>
                  <div className="font-semibold">ML10X preset {story.preset.preset_number} “{story.preset.preset_name}” <Badge>{story.preset.mode}</Badge> {story.preset.stereo_output ? <Badge tone="ok">stereo out</Badge> : <Badge>mono out</Badge>}</div>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {story.flows.map((f) => (
                      <li key={f.short} className="flex gap-1.5">
                        <span className="font-bold w-3 shrink-0" style={{ color: f.short === "L" ? "#15803d" : "#be123c" }}>{f.short}</span>
                        <span className="flex-1">{f.summary} {f.complete ? null : <Badge tone="bad">incomplete</Badge>}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : story.scene.ml10x.preset_number != null ? (
                <div className="text-red-700">Scene asks for ML10X preset {story.scene.ml10x.preset_number}, which is not defined.</div>
              ) : (
                <div className="text-neutral-500">ML10X routing unchanged by this scene.</div>
              )}
              <div>
                <div className="font-semibold">Pedals</div>
                <ul className="mt-1 flex flex-col gap-0.5" data-testid="stage-pedals">
                  {story.devices.filter((d) => d.role === "effect").map((d) => {
                    const t = story.midi.find((m) => m.instance_id === d.instance_id);
                    return (
                      <li key={d.instance_id} className={`flex gap-1.5 ${d.inPath ? "" : "text-neutral-400"}`} data-testid={`stage-pedal-${d.instance_id}`}>
                        <i className={`mt-1 inline-block w-2.5 h-2.5 rounded-full shrink-0 ${d.enabled === true ? "bg-green-500" : d.enabled === false ? "bg-neutral-700" : "border border-dashed border-neutral-500"}`} />
                        <span className="flex-1">
                          <b>{d.label}</b>{" "}
                          {d.enabled === true ? "engaged" : d.enabled === false ? "bypassed" : "state not set"}
                          {d.loopState === "bypassed" ? " · loop bypassed on the ML10X" : d.loopState === "return_only" ? " · stereo return only" : !d.inPath ? " · not in this scene's path" : ""}
                          {d.program ? ` · program ${d.program.pc}` : ""}
                          {d.cc_values.length ? ` · ${d.cc_values.map((c) => `CC#${c.cc}=${c.value}`).join(", ")}` : ""}
                          {t ? <span className="text-neutral-500"> — {t.messages.length} MIDI msg on ch {t.channel}{t.route ? ` via ${t.route.length} cable${t.route.length > 1 ? "s" : ""}` : analysis?.midi.controller_id ? " · no cable path!" : ""}</span> : d.hasMidi ? <span className="text-neutral-500"> — no MIDI sent</span> : <span className="text-neutral-500"> — no MIDI: by foot</span>}
                          {d.manual_note ? <span className="italic text-amber-800"> · {d.manual_note}</span> : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {story.midi.length > 0 && (
                <details>
                  <summary className="cursor-pointer font-semibold">{story.plan?.message_count ?? story.midi.length} MIDI messages, in order</summary>
                  <ol className="list-decimal pl-5 mt-1 flex flex-col gap-0.5">
                    {(story.plan?.messages ?? []).map((m, k) => <li key={k}>{m.summary} <span className="text-neutral-500">— {m.explanation}</span></li>)}
                  </ol>
                </details>
              )}
              {story.manualSteps.length > 0 && (
                <div>
                  <div className="font-semibold">By foot or hand</div>
                  <ul className="list-disc pl-4" data-testid="stage-manual">{story.manualSteps.map((s, k) => <li key={k}>{s}</li>)}</ul>
                </div>
              )}
              <DiagnosticList items={story.plan?.diagnostics ?? []} empty="" />
            </div>
          ) : <p className="text-xs text-neutral-500">Pick a scene.</p>}
        </Panel>
        {story && (
          <Panel title={prevScene ? `What changes from “${prevScene.name}”` : "Starting state"}>
            {diff && diff.lines.length ? (
              <ul className="text-xs flex flex-col gap-1" data-testid="stage-diff">
                {diff.lines.map((l, k) => <li key={k} className="flex gap-1.5"><span className="text-amber-500">◆</span><span>{l}</span></li>)}
              </ul>
            ) : <p className="text-xs text-neutral-500" data-testid="stage-diff">Nothing changes on the board between these two scenes.</p>}
          </Panel>
        )}
      </div>
    </div>
  );
}
