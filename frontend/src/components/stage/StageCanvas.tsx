"use client";

import { useMemo } from "react";
import { useRigStore } from "@/store/rigStore";
import { boardLayout, enclosureFill } from "@/lib/boardLayout";
import type { FlowSegment, SceneStory } from "@/lib/stage";

export const FLOW_COLOR = { L: "#4ade80", R: "#fb7185" } as const;
export const MIDI_COLOR = "#c084fc";
export const VIRTUAL_COLOR = "#e2e8f0";

export interface StageView {
  showMidi: boolean;
  showAllCables: boolean;
  /** Changes whenever the scene "fires": remounts the animated layers so they replay. */
  fireKey: number;
}

/** Device glyph used on the stage: enclosure, name, scene LED and a state line. */
function Device({ x, y, w, h, label, fill, placeholder, offBoard, dim, led, state, changed, testId, note }: {
  x: number; y: number; w: number; h: number; label: string; fill: string; placeholder: boolean; offBoard: boolean; dim: boolean;
  led: "on" | "off" | "unset" | null; state: string; changed: boolean; testId: string; note?: string | null;
}) {
  const fs = Math.min(8, w / 8);
  return (
    <g data-testid={testId} data-state={led === "on" ? "engaged" : led === "off" ? "bypassed" : led === "unset" ? "unset" : "n/a"} data-inpath={dim ? "false" : "true"} opacity={dim ? 0.38 : 1}>
      {changed && <rect x={x - 2} y={y - 2} width={w + 4} height={h + 4} rx={5} fill="none" stroke="#fbbf24" strokeWidth={1.4} className="stage-pulse" />}
      <rect x={x} y={y} width={w} height={h} rx={3} fill={fill} stroke={offBoard ? "#94a3b8" : "#1f2937"} strokeWidth={0.8} strokeDasharray={placeholder || offBoard ? "3 2" : undefined} />
      {/* subtle top highlight so enclosures read as objects, not table cells */}
      <rect x={x + 1} y={y + 1} width={Math.max(0, w - 2)} height={Math.min(4, h / 6)} rx={2} fill="#fff" opacity={0.45} />
      <text x={x + 3} y={y + 9} fontSize={fs} fontWeight={600} fill="#111827">{label}</text>
      {led && (
        <g>
          {led === "on" && <circle cx={x + w - 6} cy={y + 6} r={5} fill="#22c55e" opacity={0.35} className="stage-led-glow" />}
          <circle cx={x + w - 6} cy={y + 6} r={2.4} fill={led === "on" ? "#22c55e" : led === "off" ? "#374151" : "none"} stroke={led === "unset" ? "#9ca3af" : "#111827"} strokeWidth={0.5} strokeDasharray={led === "unset" ? "1 1" : undefined}>
            <title>{led === "on" ? "Scene wants this pedal engaged" : led === "off" ? "Scene wants this pedal bypassed" : "Scene does not set this pedal's state"}</title>
          </circle>
        </g>
      )}
      <text x={x + 3} y={y + 9 + fs + 1} fontSize={4.6} fill="#374151">{state}</text>
      {note && (
        <text x={x + 3} y={y + h - 3} fontSize={4.4} fill="#b45309" fontWeight={600}>
          {note.length > w / 2.6 ? `${note.slice(0, Math.max(6, Math.floor(w / 2.6) - 1))}…` : note}
          <title>{note}</title>
        </text>
      )}
    </g>
  );
}

export function StageCanvas({ story, changed, view }: { story: SceneStory | null; changed: Set<string>; view: StageView }) {
  const { rig, analysis, profiles } = useRigStore();
  const layout = useMemo(() => (rig ? boardLayout(rig, analysis) : null), [rig, analysis]);
  if (!rig || !layout) return null;
  const { margin, vbW, vbH, offboard, originOf, ports } = layout;
  const board = rig.board;
  const cablesInPath = story?.cablesInPath ?? new Set<string>();
  const midiCables = new Set(view.showMidi ? (story?.midi ?? []).flatMap((t) => t.route ?? []) : []);
  const byFoot = new Map<string, string>();
  for (const s of story?.manualSteps ?? []) {
    const inst = rig.instances.find((i) => s.startsWith(`${i.label}:`));
    if (inst && !byFoot.has(inst.id)) byFoot.set(inst.id, s.slice(inst.label.length + 1).trim());
  }
  const unreachable = new Set((story?.midi ?? []).filter((t) => t.route === null && analysis?.midi.controller_id).map((t) => t.instance_id));

  const segPath = (s: FlowSegment): string | null => {
    const a = ports[s.from];
    const b = ports[s.to];
    if (!a || !b) return null;
    if (s.kind === "cable") return layout.cablePath(a, b);
    if (s.kind === "virtual") return s.from === s.to ? null : layout.internalPath(a, b);
    return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  };

  return (
    <svg
      role="img"
      aria-label={story ? `Stage: scene ${story.scene.name}` : "Stage"}
      data-testid="stage-canvas"
      viewBox={`0 0 ${vbW} ${vbH}`}
      width="100%"
      style={{ maxHeight: "68vh", background: "#0f172a", borderRadius: 8 }}
      className="select-none"
    >
      <defs>
        <pattern id="stage-grid" width={board.grid_mm * 4} height={board.grid_mm * 4} patternUnits="userSpaceOnUse" x={margin} y={margin}>
          <path d={`M ${board.grid_mm * 4} 0 L 0 0 0 ${board.grid_mm * 4}`} fill="none" stroke="#334155" strokeWidth={0.3} />
        </pattern>
        <radialGradient id="stage-light" cx="50%" cy="0%" r="90%">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0f172a" />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={vbW} height={vbH} fill="url(#stage-light)" />
      <rect x={margin} y={margin} width={board.width_mm} height={board.depth_mm} fill="#1e293b" stroke="#64748b" strokeWidth={1} rx={2} />
      <rect x={margin} y={margin} width={board.width_mm} height={board.depth_mm} fill="url(#stage-grid)" />
      <text x={margin} y={margin - 6} fontSize={7} fill="#94a3b8">{board.name} · {board.width_mm} × {board.depth_mm} mm</text>
      {offboard.length > 0 && <text x={margin + board.width_mm + 40} y={margin - 6} fontSize={7} fill="#94a3b8">Off-board</text>}

      {/* Every physical cable, faint: the stage never hides a cable that exists. */}
      {rig.connections.filter((c) => c.kind === "audio" || c.kind === "midi" || (view.showAllCables && c.kind !== "power")).map((c) => {
        const a = ports[`${c.source.instance_id}:${c.source.port_id}`];
        const b = ports[`${c.target.instance_id}:${c.target.port_id}`];
        if (!a || !b) return null;
        const lit = cablesInPath.has(c.id) || midiCables.has(c.id);
        return <path key={c.id} d={layout.cablePath(a, b)} fill="none" stroke={c.kind === "midi" ? MIDI_COLOR : "#94a3b8"} strokeWidth={lit ? 0.6 : 0.8} strokeOpacity={lit ? 0.25 : view.showAllCables ? 0.5 : 0.22} />;
      })}

      {/* Devices */}
      {rig.instances.map((inst) => {
        const geo = analysis?.instances[inst.id];
        const w = geo?.width_mm ?? 70;
        const h = geo?.height_mm ?? 120;
        const pos = originOf(inst);
        const profile = profiles[inst.profile_id];
        const d = story?.devices.find((x) => x.instance_id === inst.id);
        const isEffect = d?.role === "effect";
        const dim = !!story && isEffect && !d.inPath;
        const led = isEffect ? (d.enabled === true ? "on" : d.enabled === false ? "off" : "unset") : null;
        const stateText = !story ? "" : isEffect ? [d.loopState === "bypassed" ? "loop bypassed" : d.loopState === "return_only" ? "return only" : d.inPath ? "in path" : "not in path", d.program ? `prog ${d.program.pc}` : null].filter(Boolean).join(" · ") : d?.role === "switcher" && story.presetDef ? `preset ${story.presetDef.number} ${story.presetDef.name}` : d?.role === "controller" && story.mc8 ? `bank ${story.mc8.bank} · ${story.mc8.position}` : "";
        return (
          <Device
            key={inst.id}
            x={pos.x} y={pos.y} w={w} h={h}
            label={inst.label}
            fill={enclosureFill(profile?.category, { placeholder: geo?.placeholder, offBoard: inst.off_board })}
            placeholder={!!geo?.placeholder}
            offBoard={inst.off_board}
            dim={dim}
            led={led}
            state={stateText}
            changed={changed.has(inst.id)}
            testId={`stage-device-${inst.id}`}
            note={byFoot.get(inst.id) ? `✋ by foot: ${byFoot.get(inst.id)}` : unreachable.has(inst.id) ? "⚠ no MIDI cable path from the MC8" : null}
          />
        );
      })}

      {/* Conductor flows, replayed on every fire. */}
      <g key={`flows-${view.fireKey}`}>
        {(story?.flows ?? []).map((flow, fi) => {
          const color = FLOW_COLOR[flow.short];
          return (
            <g key={fi} data-testid={`stage-path-${flow.short}`} data-cables={flow.cables.join(",")} data-complete={flow.complete ? "true" : "false"}>
              {flow.segments.map((s, si) => {
                const d = segPath(s);
                if (!d) return null;
                const faint = s.state === "bypassed" || s.state === "empty";
                const broken = s.state === "broken";
                const dash = s.kind === "virtual" ? "2 2" : undefined;
                return (
                  <g key={si} data-kind={s.kind} data-state={s.state}>
                    <path d={d} fill="none" stroke={broken ? "#f87171" : s.kind === "virtual" ? VIRTUAL_COLOR : color} strokeWidth={s.kind === "virtual" ? 0.9 : 2.2} strokeOpacity={faint ? 0.35 : s.kind === "virtual" ? 0.7 : 0.95} strokeDasharray={dash} strokeLinecap="round">
                      <title>{`${flow.short === "L" ? "Left" : "Right"} · ${s.kind}${s.note ? ` — ${s.note}` : ""}`}</title>
                    </path>
                    {!faint && !broken && s.kind !== "virtual" && <path d={d} fill="none" stroke="#fff" strokeWidth={1.1} strokeOpacity={0.9} strokeLinecap="round" className="stage-flow" pointerEvents="none" />}
                    {broken && ports[s.to] && <text x={ports[s.to].x + 3} y={ports[s.to].y - 3} fontSize={7} fill="#f87171" fontWeight={700}>✕ breaks here</text>}
                  </g>
                );
              })}
              {flow.segments.filter((s) => s.kind === "cable").map((s, si) => {
                const a = ports[s.from];
                const b = ports[s.to];
                if (!a || !b) return null;
                return (
                  <g key={`j${si}`}>
                    <circle cx={a.x} cy={a.y} r={2.2} fill={color} stroke="#0f172a" strokeWidth={0.5} />
                    <circle cx={b.x} cy={b.y} r={2.2} fill={color} stroke="#0f172a" strokeWidth={0.5} />
                  </g>
                );
              })}
              {flow.segments[0] && ports[flow.segments[0].from] && (
                <text x={ports[flow.segments[0].from].x} y={ports[flow.segments[0].from].y - 5} fontSize={6} fontWeight={700} fill={color} textAnchor="middle" paintOrder="stroke" stroke="#0f172a" strokeWidth={1.2}>{flow.short}</text>
              )}
            </g>
          );
        })}
      </g>

      {/* MIDI pulses from the MC8 along the real MIDI cables. */}
      {view.showMidi && (
        <g key={`midi-${view.fireKey}`} data-testid="stage-midi">
          {(story?.midi ?? []).map((t) => {
            if (!t.route) return null;
            return (
              <g key={t.instance_id} data-testid={`stage-midi-${t.instance_id}`} data-route={t.route.join(",")}>
                {t.route.map((cid, hop) => {
                  const c = rig.connections.find((x) => x.id === cid);
                  const a = c && ports[`${c.source.instance_id}:${c.source.port_id}`];
                  const b = c && ports[`${c.target.instance_id}:${c.target.port_id}`];
                  if (!a || !b) return null;
                  const d = layout.cablePath(a, b);
                  return (
                    <g key={cid}>
                      <path d={d} fill="none" stroke={MIDI_COLOR} strokeWidth={1.4} strokeOpacity={0.55} />
                      <circle r={2.4} fill="#f5d0fe" stroke={MIDI_COLOR} strokeWidth={0.6} opacity={0}>
                        <animateMotion dur="0.7s" begin={`${0.25 + hop * 0.7}s`} repeatCount="1" path={d} fill="freeze" />
                        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.9;1" dur="0.7s" begin={`${0.25 + hop * 0.7}s`} repeatCount="1" fill="freeze" />
                      </circle>
                    </g>
                  );
                })}
                {(() => {
                  const last = rig.connections.find((x) => x.id === t.route![t.route!.length - 1]);
                  const b = last && ports[`${last.target.instance_id}:${last.target.port_id}`];
                  return b ? <text x={b.x + 3} y={b.y - 7} fontSize={5} fill={MIDI_COLOR} paintOrder="stroke" stroke="#0f172a" strokeWidth={1.2}>{`ch ${t.channel} · ${t.messages.length} msg`}</text> : null;
                })()}
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}
