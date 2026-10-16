// The Stage reads a scene as a story told on the physical board: which conductor travels along
// which real cable, what state each pedal is in, which MIDI cables the MC8's messages travel,
// and what a musician still has to do by foot. Everything here is derived from facts the rig
// already stores (cables, jack positions, preset edges, compiled messages); nothing is invented.

import type { Analysis, CcValue, CompiledMessage, DeviceProfile, Ml10xPreset, PresetPaths, ProgramSelection, Rig, Scene, ScenePlan } from "./types";

export type FlowState = "engaged" | "bypassed" | "empty" | "broken" | "through" | "return_only";

export interface FlowSegment {
  /** cable = a physical cable; virtual = the preset's routing inside the switcher; device = through a pedal. */
  kind: "cable" | "virtual" | "device";
  /** Endpoints as `${instance_id}:${port_id}` keys into the board layout. */
  from: string;
  to: string;
  connection_id?: string;
  state: FlowState;
  note?: string;
}

export interface ConductorFlow {
  name: string;
  short: "L" | "R";
  complete: boolean;
  summary: string;
  segments: FlowSegment[];
  /** Ordered physical cables the conductor travels. */
  cables: string[];
  /** Pedals the conductor passes through (engaged or bypassed), in order. */
  devices: string[];
}

export type DeviceRole = "controller" | "switcher" | "instrument" | "amp" | "power_supply" | "effect";

export interface StageDeviceState {
  instance_id: string;
  label: string;
  role: DeviceRole;
  hasMidi: boolean;
  /** The pedal's own state as the scene wants it (null = the scene does not say). */
  enabled: boolean | null;
  program: ProgramSelection | null;
  cc_values: CcValue[];
  manual_note: string | null;
  /** Whether a conductor of the scene's preset passes through this device, and how the loop treats it. */
  inPath: boolean;
  loopState: "engaged" | "bypassed" | "return_only" | null;
}

export interface MidiTarget {
  instance_id: string;
  label: string;
  channel: number;
  messages: CompiledMessage[];
  /** Ordered MIDI cables from the MC8, or null when no cable path reaches the device. */
  route: string[] | null;
}

export interface Mc8Assignment {
  bank: number;
  bankName: string;
  position: string;
  short_name: string;
}

export interface SceneStory {
  scene: Scene;
  plan: ScenePlan | null;
  preset: PresetPaths | null;
  presetDef: Ml10xPreset | null;
  flows: ConductorFlow[];
  devices: StageDeviceState[];
  midi: MidiTarget[];
  manualSteps: string[];
  mc8: Mc8Assignment | null;
  cablesInPath: Set<string>;
}

export function roleOf(profile: DeviceProfile | undefined): DeviceRole {
  const c = profile?.category;
  if (c === "controller" || c === "switcher" || c === "instrument" || c === "amp" || c === "power_supply") return c;
  return "effect";
}

function loopNo(node: string): number | null {
  return /^L\d+$/.test(node) ? Number(node.slice(1)) : null;
}

/** Turn one traced conductor into drawable segments, using the cables the backend named. */
function buildFlow(rig: Rig, switcherId: string, preset: PresetPaths, pathIndex: number, scene: Scene): ConductorFlow {
  const path = preset.paths[pathIndex];
  const conns = new Map(rig.connections.map((c) => [c.id, c]));
  const key = (ref: { instance_id: string; port_id: string }) => `${ref.instance_id}:${ref.port_id}`;
  const segs: FlowSegment[] = [];
  const cables: string[] = [];
  const devices: string[] = [];
  let at: string | null = null; // where the conductor currently sits inside the switcher
  let broken = false;
  for (const step of path.steps) {
    if (broken) break;
    const stepCables = step.cables.map((id) => conns.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
    const sendCable = step.out_port_id ? stepCables.find((c) => c.source.instance_id === switcherId && c.source.port_id === step.out_port_id) : undefined;
    const returnCable = step.in_port_id ? stepCables.find((c) => c.target.instance_id === switcherId && c.target.port_id === step.in_port_id) : undefined;
    const n = loopNo(step.node);
    if (step.node === "IN_TIP" || step.node === "IN_RING") {
      if (returnCable) {
        segs.push({ kind: "cable", from: key(returnCable.source), to: key(returnCable.target), connection_id: returnCable.id, state: "through" });
        cables.push(returnCable.id);
      }
      at = step.in_port_id ? `${switcherId}:${step.in_port_id}` : null;
      continue;
    }
    if (step.node === "OUT_TIP" || step.node === "OUT_RING") {
      const outKey = step.out_port_id ? `${switcherId}:${step.out_port_id}` : null;
      if (at && outKey) segs.push({ kind: "virtual", from: at, to: outKey, state: "through" });
      if (sendCable) {
        segs.push({ kind: "cable", from: key(sendCable.source), to: key(sendCable.target), connection_id: sendCable.id, state: "through" });
        cables.push(sendCable.id);
      } else if (outKey) {
        segs.push({ kind: "virtual", from: outKey, to: outKey, state: "broken", note: "this output is not cabled anywhere" });
      }
      at = null;
      continue;
    }
    if (n === null) continue;
    // A loop. The scene may override the loop's state on a Simple preset (CC per loop).
    let state: FlowState = step.state === "bypassed" ? "bypassed" : step.state === "return_only" ? "return_only" : step.state === "missing" ? "empty" : "engaged";
    const override = preset.mode === "simple" ? scene.ml10x.loop_states[String(n)] : undefined;
    if (override !== undefined && (state === "engaged" || state === "bypassed")) state = override ? "engaged" : "bypassed";
    const sendKey = step.out_port_id ? `${switcherId}:${step.out_port_id}` : null;
    const retKey = step.in_port_id ? `${switcherId}:${step.in_port_id}` : null;
    if (state === "return_only") {
      if (returnCable) {
        segs.push({ kind: "cable", from: key(returnCable.source), to: key(returnCable.target), connection_id: returnCable.id, state: "return_only" });
        cables.push(returnCable.id);
        devices.push(returnCable.source.instance_id);
        at = retKey;
      } else {
        broken = true;
      }
      continue;
    }
    if (at && sendKey) segs.push({ kind: "virtual", from: at, to: sendKey, state: "through" });
    if (!sendCable && !returnCable) {
      // Empty loop: the switcher's buffered loop passes the signal straight through.
      if (sendKey && retKey) segs.push({ kind: "virtual", from: sendKey, to: retKey, state: "empty", note: step.note ?? undefined });
      at = retKey;
      continue;
    }
    if (sendCable) {
      const half = !returnCable;
      segs.push({ kind: "cable", from: key(sendCable.source), to: key(sendCable.target), connection_id: sendCable.id, state: half ? "broken" : state, note: half ? "loop is only half cabled: the path breaks here" : undefined });
      cables.push(sendCable.id);
      devices.push(sendCable.target.instance_id);
      if (half) {
        broken = true;
        continue;
      }
    }
    if (sendCable && returnCable) {
      segs.push({ kind: "device", from: key(sendCable.target), to: key(returnCable.source), state, note: sendCable.target.instance_id !== returnCable.source.instance_id ? step.note ?? undefined : undefined });
      if (returnCable.source.instance_id !== sendCable.target.instance_id) devices.push(returnCable.source.instance_id);
    }
    if (returnCable) {
      segs.push({ kind: "cable", from: key(returnCable.source), to: key(returnCable.target), connection_id: returnCable.id, state: sendCable ? state : "broken" });
      cables.push(returnCable.id);
      if (!sendCable) {
        broken = true;
        continue;
      }
      at = retKey;
    }
  }
  const short: "L" | "R" = path.name.startsWith("Right") ? "R" : "L";
  return { name: path.name, short, complete: path.complete && !broken, summary: path.summary, segments: segs, cables, devices };
}

export function sceneStory(rig: Rig, analysis: Analysis | null, profiles: Record<string, DeviceProfile>, scene: Scene): SceneStory {
  const plan = analysis?.compiled.scenes.find((p) => p.scene_id === scene.id) ?? null;
  const ml = rig.controllers.ml10x;
  const presetDef = scene.ml10x.preset_number != null ? ml.presets.find((p) => p.number === scene.ml10x.preset_number) ?? null : null;
  const preset = presetDef ? analysis?.ml10x.preset_paths.find((pp) => pp.preset_number === presetDef.number) ?? null : null;
  const flows = preset && ml.instance_id ? preset.paths.map((_, i) => buildFlow(rig, ml.instance_id!, preset, i, scene)) : [];
  const cablesInPath = new Set(flows.flatMap((f) => f.cables));
  const loopStateOf = new Map<string, "engaged" | "bypassed" | "return_only">();
  for (const f of flows) for (const s of f.segments) {
    if (s.kind === "device") loopStateOf.set(s.from.split(":")[0], s.state === "bypassed" ? "bypassed" : "engaged");
    if (s.kind === "cable" && s.state === "return_only") loopStateOf.set(s.from.split(":")[0], "return_only");
  }
  const inPath = new Set<string>();
  for (const f of flows) for (const s of f.segments) {
    inPath.add(s.from.split(":")[0]);
    inPath.add(s.to.split(":")[0]);
  }
  const devices: StageDeviceState[] = rig.instances.map((inst) => {
    const prof = profiles[inst.profile_id];
    const st = scene.device_states.find((d) => d.instance_id === inst.id);
    return {
      instance_id: inst.id,
      label: inst.label,
      role: roleOf(prof),
      hasMidi: !!prof?.midi.interfaces.length,
      enabled: st?.enabled ?? null,
      program: st?.program ?? null,
      cc_values: st?.cc_values ?? [],
      manual_note: st?.manual_note ?? null,
      inPath: inPath.has(inst.id),
      loopState: loopStateOf.get(inst.id) ?? null,
    };
  });
  const routes = analysis?.midi.routes ?? {};
  const midi: MidiTarget[] = [];
  for (const m of plan?.messages ?? []) {
    let t = midi.find((x) => x.instance_id === m.target_instance_id);
    if (!t) {
      t = { instance_id: m.target_instance_id, label: m.target_label, channel: m.channel, messages: [], route: analysis?.midi.controller_id ? routes[m.target_instance_id] ?? null : null };
      midi.push(t);
    }
    t.messages.push(m);
  }
  let mc8: Mc8Assignment | null = null;
  for (const b of rig.controllers.mc8.banks) for (const p of b.presets) if (p.scene_id === scene.id && !mc8) mc8 = { bank: b.number, bankName: b.name, position: p.position, short_name: p.short_name };
  return { scene, plan, preset, presetDef, flows, devices, midi, manualSteps: plan?.manual_steps ?? scene.manual_steps, mc8, cablesInPath };
}

export interface SceneDiff {
  lines: string[];
  changedInstances: Set<string>;
}

const onOff = (v: boolean | null) => (v === true ? "engaged" : v === false ? "bypassed" : "not set");
const prog = (p: ProgramSelection | null) => (p ? `program ${p.pc}${p.bank_msb != null ? ` (bank ${p.bank_msb})` : ""}` : "no program");

/** What changes when the rig goes from scene `a` to scene `b` (a = null means "from nothing"). */
export function sceneDiff(a: SceneStory | null, b: SceneStory): SceneDiff {
  const lines: string[] = [];
  const changed = new Set<string>();
  const pa = a?.presetDef ?? null;
  const pb = b.presetDef;
  if ((pa?.number ?? null) !== (pb?.number ?? null)) {
    lines.push(pb ? `ML10X recalls preset ${pb.number} “${pb.name}”${pa ? ` (was ${pa.number} “${pa.name}”)` : ""}.` : pa ? `ML10X keeps whatever preset is active (scene sets none; was ${pa.number}).` : "");
  }
  for (const f of b.flows) {
    const prev = a?.flows.find((x) => x.short === f.short);
    if (!prev || prev.summary !== f.summary) lines.push(`${f.short === "L" ? "Left" : "Right"} path: ${f.summary}${f.complete ? "" : " (incomplete)"}`);
  }
  if (a && a.flows.length && !b.flows.length) lines.push("No ML10X path is defined for this scene.");
  for (const d of b.devices) {
    const p = a?.devices.find((x) => x.instance_id === d.instance_id);
    const parts: string[] = [];
    if (d.role === "effect") {
      if ((p?.loopState ?? null) !== d.loopState || (p?.inPath ?? false) !== d.inPath) {
        parts.push(!d.inPath ? "out of the signal path" : d.loopState === "bypassed" ? "loop bypassed" : d.loopState === "return_only" ? "return only" : "in the signal path");
      }
      if ((p?.enabled ?? null) !== d.enabled) parts.push(`${p ? `${onOff(p.enabled)} → ` : ""}${onOff(d.enabled)}`);
      if (JSON.stringify(p?.program ?? null) !== JSON.stringify(d.program)) parts.push(`${p ? `${prog(p.program)} → ` : ""}${prog(d.program)}`);
      const ccA = (p?.cc_values ?? []).map((c) => `CC#${c.cc}=${c.value}`).join(", ");
      const ccB = d.cc_values.map((c) => `CC#${c.cc}=${c.value}`).join(", ");
      if (ccA !== ccB && (ccA || ccB)) parts.push(`${ccA ? `${ccA} → ` : ""}${ccB || "no CC"}`);
      if ((p?.manual_note ?? null) !== d.manual_note && d.manual_note) parts.push(`by hand: ${d.manual_note}`);
    }
    if (parts.length) {
      lines.push(`${d.label}: ${parts.join("; ")}`);
      changed.add(d.instance_id);
    }
  }
  const na = a?.plan?.message_count ?? 0;
  const nb = b.plan?.message_count ?? 0;
  if (a && na !== nb) lines.push(`${nb} MIDI messages (was ${na}).`);
  const newSteps = b.manualSteps.filter((s) => !(a?.manualSteps ?? []).includes(s));
  for (const s of newSteps) lines.push(`By foot or hand: ${s}`);
  const mcA = a?.mc8 ? `${a.mc8.bank}:${a.mc8.position}` : null;
  const mcB = b.mc8 ? `${b.mc8.bank}:${b.mc8.position}` : null;
  if (mcA && mcB && mcA !== mcB && a!.mc8!.bank !== b.mc8!.bank) lines.push(`Switch to MC8 bank ${b.mc8!.bank} first.`);
  return { lines: lines.filter(Boolean), changedInstances: changed };
}

/** Scenes in setlist order. */
export function setlist(rig: Rig): Scene[] {
  return [...rig.scenes].sort((x, y) => x.order - y.order || x.name.localeCompare(y.name));
}
