import type { CcDef, ControlBehavior, DeviceNote, DeviceProfile, DocumentRef, HardwareStatus, NoteCategory, SourceCitation } from "./types";
import { newId } from "./api";

/**
 * Session 6: the structured MIDI control knowledge and Quick Reference notes the Knowledge
 * Workbench edits. Mirrors the backend rules (`CcDef`, `DeviceNote`) so the editor can explain a
 * problem before the server refuses, and keeps the legacy `continuous` flag in agreement with
 * `behavior` on every save.
 */

export const BEHAVIORS: { value: ControlBehavior; label: string; short: string; hint: string }[] = [
  { value: "continuous", label: "Continuous", short: "continuous", hint: "a knob-like sweep: the same value always gives the same result (eligible for Textures)" },
  { value: "discrete", label: "Discrete", short: "discrete", hint: "picks one of a few states (a mode, a division, on/off by value)" },
  { value: "toggle", label: "Toggle", short: "toggle", hint: "flips state on each message; the result depends on what the pedal was doing" },
  { value: "trigger", label: "Trigger", short: "trigger", hint: "fires an action on any value (tap, bank up, save)" },
  { value: "unknown", label: "Unknown", short: "unknown", hint: "the manual does not say; nothing is assumed" },
];
export const BEHAVIOR_TONE: Record<ControlBehavior, "ok" | "warn" | "neutral" | "bad"> = { continuous: "ok", discrete: "neutral", toggle: "warn", trigger: "warn", unknown: "bad" };

export const HARDWARE_STATUSES: { value: HardwareStatus; label: string }[] = [
  { value: "unverified", label: "Not tried on my pedal" },
  { value: "verified", label: "Verified on my pedal" },
  { value: "failed", label: "Tried it — no response / different" },
];

export const NOTE_CATEGORIES: { value: NoteCategory; label: string }[] = [
  { value: "presets", label: "Presets" },
  { value: "modes", label: "Modes" },
  { value: "midi_setup", label: "MIDI setup" },
  { value: "global_settings", label: "Global settings" },
  { value: "startup", label: "Startup shortcuts" },
  { value: "firmware", label: "Firmware" },
  { value: "troubleshooting", label: "Troubleshooting" },
  { value: "technique", label: "Techniques & discoveries" },
  { value: "other", label: "Other" },
];
export const noteCategoryLabel = (c: NoteCategory) => NOTE_CATEGORIES.find((x) => x.value === c)?.label ?? c;

/** The behaviour a legacy entry implies; `null` when the profile says nothing. */
export function behaviorOf(c: CcDef): ControlBehavior | null {
  if (c.behavior) return c.behavior;
  if (c.continuous === true) return "continuous";
  if (c.continuous === false) return "discrete";
  return null;
}
export const behaviorLabel = (c: CcDef) => { const b = behaviorOf(c); return b ? BEHAVIORS.find((x) => x.value === b)!.short : "not stated"; };
export const isReviewed = (c: CcDef) => c.review_status !== "proposed";
export const isRemapped = (c: CcDef) => c.mapping === "user_configured";

/** `continuous` must agree with `behavior` (the backend derives it the same way). */
export function withContinuous(c: CcDef): CcDef {
  const b = c.behavior ?? null;
  const continuous = b === null ? (c.continuous ?? null) : b === "continuous" ? true : b === "unknown" ? null : false;
  return { ...c, continuous, behavior: b ?? (continuous === true ? "continuous" : continuous === false ? "discrete" : null) };
}

/** Trim strings, drop empties, keep the wire shape the backend expects. */
export function normalizeControl(c: CcDef): CcDef {
  const n = withContinuous(c);
  return {
    ...n,
    name: n.name.trim(),
    value_semantics: n.value_semantics?.trim() || null,
    notes: n.notes?.trim() || null,
    hardware_note: n.hardware_note?.trim() || null,
    citation: n.citation ? { ...n.citation, note: n.citation.note?.trim() || null } : null,
    factory_cc: n.mapping === "user_configured" ? (n.factory_cc ?? null) : null,
    mapping: n.mapping ?? "manufacturer_default",
    hardware_status: n.hardware_status ?? "unverified",
    review_status: n.review_status ?? null,
  };
}

export function blankControl(cc: number | null = null, citation: SourceCitation | null = null): CcDef {
  return {
    cc: cc ?? 0, name: "", value_semantics: null, evidence: citation ? "documented" : "user", continuous: null, behavior: null,
    min_value: null, max_value: null, citation, mapping: "manufacturer_default", factory_cc: null,
    hardware_status: "unverified", hardware_note: null, review_status: null, notes: null,
  };
}

/** The lowest CC number not yet in the list (a sensible default for the next control). */
export function nextFreeCc(list: CcDef[], from = 1): number {
  const used = new Set(list.map((c) => c.cc));
  for (let n = from; n <= 127; n++) if (!used.has(n)) return n;
  for (let n = 0; n < from; n++) if (!used.has(n)) return n;
  return 0;
}

/** Client-side mirror of the model rules. `others` = the rest of the list (for duplicate numbers). */
export function controlProblems(c: CcDef, others: CcDef[]): string[] {
  const out: string[] = [];
  if (!Number.isInteger(c.cc) || c.cc < 0 || c.cc > 127) out.push("CC number must be 0–127.");
  if (!c.name.trim()) out.push("Give the control a name (what the manual calls it).");
  if (others.some((o) => o.cc === c.cc)) out.push(`CC ${c.cc} is already listed; edit that control, or mark this one as your remapped number with the factory number recorded.`);
  if (c.min_value != null && (c.min_value < 0 || c.min_value > 127)) out.push("Minimum must be 0–127.");
  if (c.max_value != null && (c.max_value < 0 || c.max_value > 127)) out.push("Maximum must be 0–127.");
  if (c.min_value != null && c.max_value != null && c.min_value > c.max_value) out.push("Minimum cannot be greater than maximum.");
  if (c.mapping === "user_configured" && c.factory_cc == null) out.push("A remapped control needs the manufacturer's factory CC number, so the manual can still be read against it.");
  if (c.factory_cc != null && (c.factory_cc < 0 || c.factory_cc > 127)) out.push("Factory CC must be 0–127.");
  if (c.citation && c.citation.page != null && c.citation.page < 1) out.push("Cited page must be 1 or more.");
  return out;
}

export function rangeText(c: CcDef): string | null {
  if (c.min_value == null && c.max_value == null) return null;
  return `${c.min_value ?? 0}–${c.max_value ?? 127}`;
}

export type ControlFilter = "all" | "continuous" | "switches" | "proposed" | "verified" | "cited";
export const CONTROL_FILTERS: { value: ControlFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "continuous", label: "Continuous" },
  { value: "switches", label: "Switches" },
  { value: "cited", label: "Cited" },
  { value: "verified", label: "Verified" },
  { value: "proposed", label: "Needs review" },
];

export function filterControls(list: CcDef[], query: string, filter: ControlFilter): CcDef[] {
  const q = query.trim().toLowerCase();
  return [...list]
    .filter((c) => {
      if (filter === "continuous" && behaviorOf(c) !== "continuous") return false;
      if (filter === "switches" && !["discrete", "toggle", "trigger"].includes(behaviorOf(c) ?? "")) return false;
      if (filter === "proposed" && isReviewed(c)) return false;
      if (filter === "verified" && c.hardware_status !== "verified") return false;
      if (filter === "cited" && !c.citation) return false;
      if (!q) return true;
      return [`cc ${c.cc}`, `cc${c.cc}`, String(c.cc), c.name, c.value_semantics ?? "", c.notes ?? "", behaviorLabel(c)].join(" ").toLowerCase().includes(q);
    })
    .sort((a, b) => a.cc - b.cc);
}

export function citationLabel(cit: SourceCitation | null | undefined, docs: DocumentRef[]): string | null {
  if (!cit) return null;
  const d = docs.find((x) => x.document_id === cit.document_id);
  const title = d?.title ?? "document";
  return cit.page ? `${title} · p. ${cit.page}` : title;
}

// ---------------------------------------------------------------------------- notes

export function blankNote(category: NoteCategory = "other", reference: SourceCitation | null = null): DeviceNote {
  return { id: newId("note"), title: "", body: "", category, steps: [], references: reference ? [reference] : [], evidence: reference ? "documented" : "user", source_note: null, pinned: false, created_at: null, updated_at: null };
}

export function normalizeNote(n: DeviceNote): DeviceNote {
  return {
    ...n,
    title: n.title.trim(),
    body: n.body.trim(),
    steps: n.steps.map((s) => s.trim()).filter(Boolean),
    references: n.references.map((r) => ({ ...r, note: r.note?.trim() || null })),
    source_note: n.source_note?.trim() || null,
  };
}

export function noteProblems(n: DeviceNote): string[] {
  const out: string[] = [];
  if (!n.title.trim()) out.push("Give the note a title (what you would search for later).");
  if (!n.body.trim() && !n.steps.some((s) => s.trim())) out.push("Write the note, or add at least one step.");
  if (n.references.some((r) => r.page != null && r.page < 1)) out.push("Referenced pages must be 1 or more.");
  return out;
}

/** Pinned first, then by category order, then title. */
export function orderedNotes(notes: DeviceNote[], query = ""): DeviceNote[] {
  const q = query.trim().toLowerCase();
  const rank = (c: NoteCategory) => NOTE_CATEGORIES.findIndex((x) => x.value === c);
  return notes
    .filter((n) => !q || [n.title, n.body, noteCategoryLabel(n.category), ...n.steps].join(" ").toLowerCase().includes(q))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || rank(a.category) - rank(b.category) || a.title.localeCompare(b.title));
}

/** Documents a profile can cite: attached ones first, then any the knowledge already cites but that are detached. */
export function citableDocuments(profile: DeviceProfile): DocumentRef[] {
  const docs = [...(profile.documents ?? [])];
  const known = new Set(docs.map((d) => d.document_id));
  const extra: string[] = [];
  for (const c of profile.midi.cc_map) if (c.citation && !known.has(c.citation.document_id)) extra.push(c.citation.document_id);
  for (const n of profile.quick_reference ?? []) for (const r of n.references) if (!known.has(r.document_id)) extra.push(r.document_id);
  for (const id of [...new Set(extra)]) docs.push({ document_id: id, title: `detached document ${id.slice(4, 10)}`, kind: "other" });
  return docs;
}
