import type { CcDef, DeviceInstance, DeviceProfile, FunctionRole, Lfo, Macro, Mapping, Texture } from "./types";
import { FUNCTION_ROLES } from "./types";
import { behaviorOf, isReviewed } from "./knowledge";

/**
 * Mirror of backend `app/instrument/evaluator.py`. The backend is authoritative (the readiness
 * report and the analysis return its numbers); this copy drives the on-screen animation and the
 * live preview so a gesture is visible without a round trip. Same contract:
 *   period = beats × 60 / bpm; phase = ((t − t0)/period + φ0) mod 1
 *   triangle: 0 → 0 rising, ¼ → 1, ½ → 0, ¾ → −1
 *   effective = clamp(base + depth × lfo, 0, 1); disabled LFO → base
 *   value = clamp(roundHalfUp(min + (max − min) × effective), 0, 127)
 */
export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}
export function periodSeconds(bpm: number, beatsPerCycle: number): number {
  return (beatsPerCycle * 60) / bpm;
}
export function phaseAt(elapsedS: number, period: number, phase0 = 0): number {
  const p = (elapsedS / period + phase0) % 1;
  return p < 0 ? p + 1 : p >= 1 ? 0 : p;
}
export function triangle(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.25) return 4 * p;
  if (p < 0.75) return 2 - 4 * p;
  return 4 * p - 4;
}
export function lfoValue(lfo: Lfo, phase: number): number {
  return lfo.enabled ? triangle(phase) : 0;
}
export function effectiveMacro(base: number, depth: number, lfo: number): number {
  return clamp01(base + depth * lfo);
}
export function scaleToCc(effective: number, outputMin: number, outputMax: number): number {
  const v = roundHalfUp(outputMin + (outputMax - outputMin) * clamp01(effective));
  return v < 0 ? 0 : v > 127 ? 127 : v;
}
export interface MacroPreview { phase: number; lfo: number; effective: number; period: number | null; values: Record<string, number> }
/** Evaluate one macro at `elapsedS` seconds after its phase origin. `base` overrides the stored base. */
export function previewMacro(macro: Macro, bpm: number, elapsedS: number, phase0 = 0, base?: number): MacroPreview {
  const b = base ?? macro.base;
  const period = macro.lfo.enabled ? periodSeconds(bpm, macro.lfo.beats_per_cycle) : null;
  const phase = period ? phaseAt(elapsedS, period, phase0) : 0;
  const lfo = lfoValue(macro.lfo, phase);
  const effective = effectiveMacro(b, macro.lfo.enabled ? macro.lfo.depth : 0, lfo);
  const values: Record<string, number> = {};
  for (const m of macro.mappings) values[m.id] = scaleToCc(effective, m.output_min, m.output_max);
  return { phase, lfo, effective, period, values };
}
export function mappingEndpoints(m: Mapping): { at_0: number; at_half: number; at_1: number } {
  return { at_0: scaleToCc(0, m.output_min, m.output_max), at_half: scaleToCc(0.5, m.output_min, m.output_max), at_1: scaleToCc(1, m.output_min, m.output_max) };
}

// ---------------------------------------------------------------------------- function grouping
const ROLE_HINTS: [RegExp, FunctionRole][] = [
  [/\b(drive|overdrive|distortion|fuzz|boost|preamp)\b/, "drive"],
  [/\b(compressor|compression|dynamics|limiter|gate|volume)\b/, "dynamics"],
  [/\b(pitch|harmon|octave|whammy|shifter|synth)\b/, "pitch"],
  [/\b(modulation|chorus|phaser|flanger|tremolo|vibrato|rotary|uni-?vibe)\b/, "modulation"],
  [/\b(delay|echo|looper|tape)\b/, "delay"],
  [/\b(reverb|space|ambient|shimmer|hall)\b/, "space"],
  [/\b(switcher|loop switcher|controller|router|routing|midi)\b/, "routing"],
];
/** Default musical function of a device from its profile (tags, category, model). An organisational lens only; the texture can relabel it. */
export function defaultRole(profile: DeviceProfile | undefined): FunctionRole {
  if (!profile) return "other";
  if (profile.category === "switcher" || profile.category === "controller") return "routing";
  const text = [...profile.tags, profile.model, profile.capabilities.notes ?? ""].join(" ").toLowerCase();
  for (const [re, role] of ROLE_HINTS) if (re.test(text)) return role;
  return "other";
}
export function roleOf(texture: Texture | null, inst: DeviceInstance, profile: DeviceProfile | undefined): FunctionRole {
  const r = texture?.function_roles[inst.id];
  return r && (FUNCTION_ROLES as readonly string[]).includes(r) ? (r as FunctionRole) : defaultRole(profile);
}
export const ROLE_LABEL: Record<FunctionRole, string> = {
  drive: "Drive", dynamics: "Dynamics", pitch: "Pitch & harmony", modulation: "Modulation", delay: "Delay", space: "Space & reverb", routing: "Routing & control", other: "Other",
};
/** A device is a candidate destination when its profile has a MIDI interface at all (eligibility of each CC is the backend's call). */
export function isMidiDevice(profile: DeviceProfile | undefined): boolean {
  return !!profile && profile.midi.interfaces.length > 0 && !["instrument", "amp", "power_supply"].includes(profile.category);
}
export function isSynthetic(profile: DeviceProfile | undefined): boolean {
  return profile?.provenance.source === "synthetic_fixture";
}
export function formatPhase(phase: number): string {
  return `${Math.round(phase * 360)}°`;
}

// ---------------------------------------------------------------------------- Instrument Studio (A-02)

/**
 * Musical-function hints for well-known pedals whose profile carries no tags (imported catalogs
 * and hand-made profiles). A hint is a *suggestion* about what the pedal is for, offered with its
 * basis and accepted or dismissed by the user; it is never a capability claim and never a
 * statement about where the pedal sits in the audio path.
 */
const MODEL_FUNCTION_HINTS: [RegExp, FunctionRole, string][] = [
  [/\bvolante\b/, "delay", "a tape echo"],
  [/\bcollider\b/, "delay", "a delay and reverb"],
  [/\btimeline\b|\bel capistan\b|\bdig\b|\bbrigadier\b|\bhabit\b|\bblooper\b|\bthermae\b/, "delay", "a delay"],
  [/\bmood\b/, "delay", "a micro-looper and delay"],
  [/\bzelzah\b|\bmobius\b|\bwarped vinyl\b|\bgeneration loss\b|\bola\b|\borbit\b|\blex\b/, "modulation", "a modulation effect"],
  [/\bhedra\b|\bwhammy\b|\bpog\b|\bmicro pitch\b|\bpitch\b/, "pitch", "a pitch shifter"],
  [/\bbigsky\b|\bbig sky\b|\bblue sky\b|\bnightsky\b|\bcloudburst\b|\bdark world\b|\bmercury\b|\bflint\b/, "space", "a reverb"],
  [/\bsunset\b|\briverside\b|\biridium\b|\bplumes\b|\bpreamp\b|\bbrothers\b|\bdirty tree\b/, "drive", "a drive"],
  [/\bcompadre\b|\bcali76\b|\bdeco\b/, "dynamics", "a compressor or saturator"],
];

export interface RoleSuggestion { role: FunctionRole; basis: string }

/**
 * A suggested musical function for a device the heuristics would otherwise file under *Other*:
 * from the model name (curated hints), else from the names of its documented controls ("Echo
 * Level" → delay). Returns null when nothing can be said; the user decides what to store.
 */
export function suggestRole(profile: DeviceProfile | undefined): RoleSuggestion | null {
  if (!profile) return null;
  const model = `${profile.manufacturer} ${profile.model}`.toLowerCase();
  for (const [re, role, what] of MODEL_FUNCTION_HINTS) if (re.test(model)) return { role, basis: `the model name “${profile.model}” (${what})` };
  for (const c of profile.midi.cc_map) {
    const text = `${c.name} ${c.value_semantics ?? ""}`.toLowerCase();
    for (const [re, role] of ROLE_HINTS) if (role !== "routing" && re.test(text)) return { role, basis: `the documented control “${c.name}”` };
  }
  return null;
}

export type ControlOffer =
  | { kind: "sweep"; label: string }
  | { kind: "declare"; label: string }
  | { kind: "refused"; label: string; reason: string };

const SWITCH_WORDS = /\b(bypass|engage|toggle|bank|mute|unmute|scroll|preset\s*(up|down)|save|store|write|reset|tap|trigger|footswitch)\b/i;

/**
 * What the finder may *offer* for a documented control, mirroring the backend's eligibility rules
 * (`app/instrument/eligibility.py`) closely enough to explain before the server is asked. The row's
 * verdict after mapping is still the backend's.
 */
export function classifyControl(profile: DeviceProfile, c: CcDef): ControlOffer {
  if (c.cc === 0 || c.cc === 32) return { kind: "refused", label: "bank select", reason: "Bank Select changes which preset a Program Change recalls; never swept." };
  if (c.cc >= 120) return { kind: "refused", label: "channel mode", reason: "CC 120–127 are channel-mode messages, not controls." };
  if (profile.midi.bypass.cc === c.cc) return { kind: "refused", label: "bypass switch", reason: "This is the pedal's bypass switch: a state, not a sweep." };
  if (!isReviewed(c)) return { kind: "refused", label: "needs review", reason: "Proposed from a manual page; review it in the Knowledge Workbench before mapping." };
  const b = behaviorOf(c);
  if (b === "continuous") return { kind: "sweep", label: "sweep" };
  if (b === "discrete" || b === "toggle" || b === "trigger") return { kind: "refused", label: b === "discrete" ? "picks a state" : b, reason: `Documented as a ${b === "discrete" ? "discrete control" : b}: it does not sweep, so a macro cannot move it smoothly.` };
  if (SWITCH_WORDS.test(`${c.name} ${c.value_semantics ?? ""}`)) return { kind: "refused", label: "switch", reason: "Its documented name describes a switch or an action, not a sweep." };
  return { kind: "declare", label: "not stated" };
}

/** The extent a new destination starts with: the documented range when the profile states one, else 0–127. */
export function defaultRange(c: CcDef | undefined): [number, number] {
  return [c?.min_value ?? 0, c?.max_value ?? 127];
}

/** The direction of a destination in words; `inverse` is kept in the text so it reads the same as Session 5. */
export function directionText(m: Mapping, macroName: string): string {
  if (m.output_min > m.output_max) return `falls ${m.output_min} → ${m.output_max} as ${macroName} rises (inverse)`;
  if (m.output_min === m.output_max) return `stays at ${m.output_min} whatever ${macroName} does`;
  return `rises ${m.output_min} → ${m.output_max} as ${macroName} rises`;
}

export function controlOf(profile: DeviceProfile | undefined, cc: number): CcDef | undefined {
  return profile?.midi.cc_map.find((c) => c.cc === cc);
}
