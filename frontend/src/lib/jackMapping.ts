// Image-assisted jack mapping: pure geometry and vocabulary.
//
// Two coordinate systems are kept apart on purpose:
//   • image space: normalized (0–1) points in the stored, orientation-corrected photograph —
//     where a connector *appears* (PortDef.image_anchor). A plug can appear outside the crop.
//   • enclosure space: normalized (0–1) coordinates across the device's physical footprint
//     (U along width, V along depth, unrotated frame) — what the wiring model uses through
//     PortDef.edge + position. Points outside 0–1 are "beyond that edge".
// The crop rectangle, the quarter turn and the fit mode (the same facts the board uses to draw
// the picture) are the only bridge between the two.

import type { DeviceImage, Edge, ImageCrop, PortDef, SignalKind } from "./types";

export interface MappingFrame {
  crop: ImageCrop;
  rotationQuarter: number;
  fit: "contain" | "cover";
  imgW: number;
  imgH: number;
  widthMm: number | null;
  depthMm: number | null;
}

export function frameFromImage(image: DeviceImage, imgW: number, imgH: number, widthMm: number | null, depthMm: number | null): MappingFrame {
  return { crop: image.crop, rotationQuarter: image.rotation_quarter, fit: image.fit, imgW, imgH, widthMm, depthMm };
}

/** How the rotated selection sits inside the footprint (offset and size in enclosure units). */
function placement(f: MappingFrame): { ox: number; oy: number; w: number; h: number } {
  const selW = f.crop.w * f.imgW;
  const selH = f.crop.h * f.imgH;
  const odd = f.rotationQuarter % 2 === 1;
  const sw = odd ? selH : selW;
  const sh = odd ? selW : selH;
  if (!f.widthMm || !f.depthMm) return { ox: 0, oy: 0, w: 1, h: 1 }; // not calibrated: plain stretch
  const s = f.fit === "cover" ? Math.max(f.widthMm / sw, f.depthMm / sh) : Math.min(f.widthMm / sw, f.depthMm / sh);
  const w = (sw * s) / f.widthMm;
  const h = (sh * s) / f.depthMm;
  return { ox: (1 - w) / 2, oy: (1 - h) / 2, w, h };
}

/** Image point → enclosure coordinates (may lie outside 0–1 for a protruding plug). */
export function imageToEnclosure(p: { x: number; y: number }, f: MappingFrame): { u: number; v: number } {
  let u = (p.x - f.crop.x) / f.crop.w;
  let v = (p.y - f.crop.y) / f.crop.h;
  for (let i = 0; i < ((f.rotationQuarter % 4) + 4) % 4; i++) {
    const nu = 1 - v; // a clockwise quarter turn of the picture
    const nv = u;
    u = nu;
    v = nv;
  }
  const pl = placement(f);
  return { u: pl.ox + u * pl.w, v: pl.oy + v * pl.h };
}

/** Enclosure coordinates → image point (inverse of imageToEnclosure). */
export function enclosureToImage(e: { u: number; v: number }, f: MappingFrame): { x: number; y: number } {
  const pl = placement(f);
  let u = (e.u - pl.ox) / pl.w;
  let v = (e.v - pl.oy) / pl.h;
  for (let i = 0; i < ((f.rotationQuarter % 4) + 4) % 4; i++) {
    const nu = v; // undo one clockwise quarter turn
    const nv = 1 - u;
    u = nu;
    v = nv;
  }
  return { x: f.crop.x + u * f.crop.w, y: f.crop.y + v * f.crop.h };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
export const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Suggest where a connector seen at enclosure coordinates (u, v) is wired: the nearest edge
 * (or the side it protrudes beyond) and the normalized position along it. Deep inside the
 * footprint it is a top-face connector. Never more precise than the click itself.
 */
export function suggestPlacement(u: number, v: number, f: MappingFrame): { edge: Edge; position: number; outside: boolean } {
  const dists: [Edge, number][] = [
    ["top", v],
    ["bottom", 1 - v],
    ["left", u],
    ["right", 1 - u],
  ];
  dists.sort((a, b) => a[1] - b[1]);
  const [edge, d] = dists[0];
  const along = (e: Edge) => round4(clamp01(e === "top" || e === "bottom" ? u : v));
  if (d < 0) return { edge, position: along(edge), outside: true };
  // "Near an edge" is about 12 mm on a calibrated device, 15 % of the span otherwise.
  const near = f.widthMm && f.depthMm ? 12 / (edge === "top" || edge === "bottom" ? f.depthMm : f.widthMm) : 0.15;
  if (d <= near) return { edge, position: along(edge), outside: false };
  return { edge: "top_face", position: round4(clamp01(u)), outside: false };
}

/** Position along a chosen edge for a point (used when the user overrides the suggested edge). */
export function positionOnEdge(edge: Edge, u: number, v: number): number {
  return round4(clamp01(edge === "left" || edge === "right" ? v : u));
}

/** Enclosure point of a port's wiring anchor (edge + position), for drawing "the cable exits here". */
export function wiringPoint(port: Pick<PortDef, "edge" | "position">): { u: number; v: number } {
  const t = port.position ?? 0.5;
  switch (port.edge) {
    case "top": return { u: t, v: 0 };
    case "bottom": return { u: t, v: 1 };
    case "left": return { u: 0, v: t };
    case "right": return { u: 1, v: t };
    default: return { u: t, v: 0.5 };
  }
}

/** Where to draw a port on the photograph: its anchor if it has one (on this picture), else its wiring point. */
export function markerPoint(port: PortDef, f: MappingFrame, assetId: string): { x: number; y: number; derived: boolean; foreign: boolean } {
  if (port.image_anchor && port.image_anchor.asset_id === assetId) return { x: port.image_anchor.x, y: port.image_anchor.y, derived: false, foreign: false };
  const p = enclosureToImage(wiringPoint(port), f);
  return { x: clamp01(p.x), y: clamp01(p.y), derived: true, foreign: !!port.image_anchor && port.image_anchor.asset_id !== assetId };
}

// ----------------------------------------------------------------------------- vocabulary

export interface JackPreset {
  key: string;
  label: string;
  short: string;
  kind: SignalKind;
  direction: PortDef["direction"];
  connector: PortDef["connector"];
  idBase: string;
  audio_channel?: PortDef["audio_channel"];
  trs_role?: PortDef["trs_role"];
  midi_trs_type?: PortDef["midi_trs_type"];
  role?: string | null;
  plug_clearance_mm?: number;
}

export const JACK_PRESETS: JackPreset[] = [
  { key: "audio_in", label: "Audio in", short: "IN", kind: "audio", direction: "in", connector: "ts_1_4", audio_channel: "mono", idBase: "in", plug_clearance_mm: 38 },
  { key: "audio_out", label: "Audio out", short: "OUT", kind: "audio", direction: "out", connector: "ts_1_4", audio_channel: "mono", idBase: "out", plug_clearance_mm: 38 },
  { key: "stereo_in", label: "Stereo in (TRS, L+R)", short: "IN", kind: "audio", direction: "in", connector: "trs_1_4", audio_channel: "stereo_trs", trs_role: "stereo", idBase: "in", plug_clearance_mm: 38 },
  { key: "stereo_out", label: "Stereo out (TRS, L+R)", short: "OUT", kind: "audio", direction: "out", connector: "trs_1_4", audio_channel: "stereo_trs", trs_role: "stereo", idBase: "out", plug_clearance_mm: 38 },
  { key: "midi_in", label: "MIDI in", short: "MIDI", kind: "midi", direction: "in", connector: "din5", midi_trs_type: "din", idBase: "midi_in", plug_clearance_mm: 30 },
  { key: "midi_out", label: "MIDI out", short: "MIDI", kind: "midi", direction: "out", connector: "din5", midi_trs_type: "din", idBase: "midi_out", plug_clearance_mm: 30 },
  { key: "midi_thru", label: "MIDI thru", short: "THRU", kind: "midi", direction: "out", connector: "din5", midi_trs_type: "din", role: "thru", idBase: "midi_thru", plug_clearance_mm: 30 },
  { key: "exp", label: "Expression", short: "EXP", kind: "expression", direction: "in", connector: "trs_1_4", trs_role: "expression", idBase: "exp", plug_clearance_mm: 38 },
  { key: "power", label: "Power in", short: "DC", kind: "power", direction: "in", connector: "dc_barrel_2_1mm", idBase: "dc", plug_clearance_mm: 20 },
  { key: "usb", label: "USB", short: "USB", kind: "usb", direction: "bidirectional", connector: "usb_c", idBase: "usb", plug_clearance_mm: 25 },
  { key: "custom", label: "Custom", short: "?", kind: "audio", direction: "in", connector: "unknown", idBase: "jack" },
];

export const PRESET_LABEL: Record<string, string> = { audio_in: "In", audio_out: "Out", stereo_in: "In (TRS)", stereo_out: "Out (TRS)", midi_in: "MIDI In", midi_out: "MIDI Out", midi_thru: "MIDI Thru", exp: "EXP", power: "DC 9V", usb: "USB", custom: "Jack" };

/** A port id that is unique, short and stable: in, in_2, in_3 … */
export function uniqueId(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const clean = base.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "jack";
  if (!taken.has(clean)) return clean;
  let n = 2;
  while (taken.has(`${clean}_${n}`)) n++;
  return `${clean}_${n}`;
}

/** A new port from a preset. Position/edge are filled in by the caller from the click. */
export function portFromPreset(preset: JackPreset, existingIds: Iterable<string>, label?: string): PortDef {
  const id = uniqueId(preset.idBase, existingIds);
  return {
    id,
    label: label ?? PRESET_LABEL[preset.key] ?? preset.label,
    kind: preset.kind,
    direction: preset.direction,
    connector: preset.connector,
    audio_channel: preset.kind === "audio" ? preset.audio_channel ?? "mono" : null,
    trs_role: preset.trs_role ?? null,
    midi_trs_type: preset.kind === "midi" ? preset.midi_trs_type ?? "unknown" : null,
    role: preset.role ?? null,
    edge: "top",
    position: null,
    position_evidence: "unknown",
    plug_clearance_mm: preset.plug_clearance_mm ?? null,
    evidence: "user",
  };
}

/** Re-type an existing port with a preset, keeping its identity, anchor and placement. */
export function applyPreset(port: PortDef, preset: JackPreset): PortDef {
  return {
    ...port,
    kind: preset.kind,
    direction: preset.direction,
    connector: preset.connector,
    audio_channel: preset.kind === "audio" ? preset.audio_channel ?? "mono" : null,
    trs_role: preset.trs_role ?? null,
    midi_trs_type: preset.kind === "midi" ? preset.midi_trs_type ?? "unknown" : null,
    role: preset.role ?? null,
    plug_clearance_mm: port.plug_clearance_mm ?? preset.plug_clearance_mm ?? null,
    evidence: "user",
  };
}

/** Which preset best describes a port (for the chip row). */
export function presetOf(port: PortDef): string {
  if (port.kind === "audio") {
    if (port.audio_channel === "stereo_trs") return port.direction === "out" ? "stereo_out" : "stereo_in";
    return port.direction === "out" ? "audio_out" : "audio_in";
  }
  if (port.kind === "midi") return port.role === "thru" ? "midi_thru" : port.direction === "out" ? "midi_out" : "midi_in";
  if (port.kind === "expression") return "exp";
  if (port.kind === "power") return "power";
  if (port.kind === "usb") return "usb";
  return "custom";
}

export interface JackTemplate {
  key: string;
  name: string;
  description: string;
  ports: { preset: string; label: string; audio_channel?: PortDef["audio_channel"]; pair_group?: string }[];
}

/** Starter sets for profiles that came without jack information. They are proposals: the user
 * places and confirms every one, and each is stored with user evidence. */
export const JACK_TEMPLATES: JackTemplate[] = [
  { key: "mono", name: "Standard mono pedal", description: "In, Out, DC power", ports: [{ preset: "audio_in", label: "In" }, { preset: "audio_out", label: "Out" }, { preset: "power", label: "DC 9V" }] },
  {
    key: "stereo",
    name: "Stereo pedal",
    description: "In L/R, Out L/R, DC power",
    ports: [
      { preset: "audio_in", label: "In L", audio_channel: "left", pair_group: "in" },
      { preset: "audio_in", label: "In R", audio_channel: "right", pair_group: "in" },
      { preset: "audio_out", label: "Out L", audio_channel: "left", pair_group: "out" },
      { preset: "audio_out", label: "Out R", audio_channel: "right", pair_group: "out" },
      { preset: "power", label: "DC 9V" },
    ],
  },
  { key: "mono_midi", name: "Mono pedal with MIDI", description: "In, Out, MIDI in (DIN), DC power", ports: [{ preset: "audio_in", label: "In" }, { preset: "audio_out", label: "Out" }, { preset: "midi_in", label: "MIDI In" }, { preset: "power", label: "DC 9V" }] },
  { key: "empty", name: "Custom", description: "Start empty and click each jack", ports: [] },
];

export function portsFromTemplate(t: JackTemplate, existingIds: Iterable<string>): PortDef[] {
  const ids = new Set(existingIds);
  const out: PortDef[] = [];
  for (const spec of t.ports) {
    const preset = JACK_PRESETS.find((p) => p.key === spec.preset)!;
    const base = spec.audio_channel === "left" ? `${preset.idBase}_l` : spec.audio_channel === "right" ? `${preset.idBase}_r` : preset.idBase;
    const port = portFromPreset({ ...preset, idBase: base }, ids, spec.label);
    if (spec.audio_channel) port.audio_channel = spec.audio_channel;
    if (spec.pair_group) port.pair_group = spec.pair_group;
    ids.add(port.id);
    out.push(port);
  }
  return out;
}

export const EDGE_LABEL: Record<Edge, string> = { top: "top edge (away from the player)", bottom: "bottom edge (player side)", left: "left edge", right: "right edge", top_face: "top face (cable comes up from the panel)" };
