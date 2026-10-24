// Morningstar Bridge (Session 7): types and API client for /api/morningstar. Kept apart from
// lib/api.ts and lib/types.ts so the bridge can evolve without touching the shared modules.
import { ApiError } from "@/lib/api";

export type MessageStatus = "empty" | "known" | "third_party" | "unknown";
export type Evidence = "sample" | "documented" | "third_party" | "named" | "unknown";

export interface UnknownKey { path: string; key: string; value_preview: string }

export interface NativeSummary {
  ok: boolean;
  problems: string[];
  warnings: string[];
  device_model: number | null;
  dump_type: string | null;
  schema_version: number | null;
  download_date: string | null;
  description?: string | null;
  hash: number | null;
  hash_matches: boolean | null;
  hash_evidence?: string;
  byte_exact: boolean | null;
  bank_count?: number;
  size_bytes: number;
  unknown_keys: UnknownKey[];
}

export interface Mc8Message {
  slot: number;
  status: MessageStatus;
  summary: string;
  anomalies: string[];
  unknown_keys: string[];
  type_code?: number | null;
  type_name?: string;
  type_enum?: string | null;
  type_evidence?: Evidence;
  channel?: number | null;
  action_code?: number | null;
  action?: string | null;
  action_label?: string | null;
  action_evidence?: Evidence;
  toggle_position_code?: number | null;
  toggle_position?: string | null;
  data?: (number | null)[];
  mi?: unknown;
  raw?: Record<string, unknown>;
}

export interface Mc8Preset {
  index: number;
  position: string;
  is_exp: boolean;
  short_name: string;
  toggle_name: string;
  long_name: string;
  toggle_mode: boolean;
  blink: boolean;
  message_scroll: boolean;
  toggle_group: number | null;
  used: boolean;
  active_messages: number;
  message_counts: Record<MessageStatus, number>;
  messages: Mc8Message[];
  unknown_keys: string[];
  anomalies: string[];
}

export interface Mc8Bank {
  index: number;
  number: number;
  name: string;
  clear_toggle: boolean;
  used: boolean;
  bank_messages: Mc8Message[];
  bank_message_note: string;
  presets: Mc8Preset[];
  exp_presets: Mc8Preset[];
  presets_used: number;
  exp_used: number;
  message_counts: Record<MessageStatus, number>;
  unknown_keys: string[];
  anomalies: string[];
}

export interface Mc8ControllerSettings {
  type: string | null;
  general: { key: string; value: unknown; evidence: Evidence; note: string | null }[];
  midi_channels: { channel: number; name: string; evidence: Evidence; raw: unknown }[];
  bank_arrangement: { is_active: unknown; num_banks_active: unknown; banks: { bank: number; name: string }[]; evidence: Evidence } | null;
  sections: { key: string; type: string | null; interpreted: boolean; count?: number; raw: unknown }[];
  anomalies: string[];
}

export interface Mc8Report {
  device: "mc8";
  native: NativeSummary;
  interpreted: { banks: Mc8Bank[]; controller_settings: Mc8ControllerSettings | null; legend: Record<string, string> } | null;
  coverage: {
    messages: Record<MessageStatus, number>;
    banks: number;
    banks_used: number;
    presets_used: number;
    exp_presets_used: number;
    unknown_keys: number;
    anomalies: number;
    controller_settings_present: boolean;
    lossless_reserialization: boolean;
  } | null;
}

export interface Ml10xPreset {
  bank: number;
  number: number;
  global_number: number | null;
  name: string;
  advanced_mode: boolean;
  mode_evidence: string;
  spillover: { tip: number | null; ring: number | null; tip_label: string; ring_label: string; evidence: string };
  bypass_raw: number | null;
  bypass_note: string;
  routing: {
    status: string;
    matrix: Record<string, number[]>;
    nonzero_rows: { row: string; values: number[]; bits: string[]; hypothesis: string | null }[];
    row_hypothesis_note: string;
  };
  used: boolean;
  unknown_keys: string[];
  anomalies: string[];
}

export interface Ml10xReport {
  device: "ml10x";
  native: NativeSummary;
  interpreted: {
    controller: {
      fields: { key: string; label: string; value: unknown; evidence: Evidence; note: string }[];
      connectors: { id: number; pos: number; label: string; loop: number | null; name: string; short_name: string; trails: boolean; input_name: string; output_name: string; unknown_keys: string[] }[];
    };
    banks: { bank: number; preset_count: number; used: number }[];
    presets: Ml10xPreset[];
    preset_names: Ml10xSlotName[];
    routing_status: string;
    anomalies: string[];
  } | null;
  coverage: {
    presets_total: number;
    presets_used: number;
    presets_advanced: number;
    presets_with_matrix_data: number;
    presets_empty: number;
    connectors: number;
    unknown_keys: number;
    anomalies: number;
    routing_decoded: boolean;
    native_export_available: boolean;
    proposal_available: boolean;
  } | null;
}

/** One of the 512 slots as the inspector lists it; `occupancy` is the structural empty-slot rule, never the name alone. */
export interface Ml10xSlotName {
  bank: number;
  number: number;
  name: string;
  used: boolean;
  advanced: boolean;
  occupancy: "empty" | "occupied" | "malformed";
  occupancy_reason: string;
}

// ---------------------------------------------------------------------------- ML10X proposals (V2)

export interface Ml10xSlotRef { bank: number; preset: number }
export type Ml10xOperation =
  | { op: "rename"; slot: Ml10xSlotRef; name: string; accept_unverified_length?: boolean }
  | { op: "copy"; source: Ml10xSlotRef; destination: Ml10xSlotRef; overwrite?: boolean }
  | { op: "move"; source: Ml10xSlotRef; destination: Ml10xSlotRef; on_occupied?: "refuse" | "swap" | "overwrite" }
  | { op: "swap"; a: Ml10xSlotRef; b: Ml10xSlotRef }
  | { op: "rename_connector"; connector: number; field: "name" | "shortName" | "inputName" | "outputName"; value: string };

export interface Ml10xSlotSnapshot { bank: number; preset: number; name: string; occupancy: "empty" | "occupied" | "malformed"; reason: string; advanced: boolean }
export interface Ml10xSlotSummary {
  name: string;
  occupancy: "empty" | "occupied" | "malformed";
  reason: string;
  advanced: boolean;
  matrix_rows_with_data: number;
  bypass: number;
  spillover: [number, number];
  unknown_keys: string[];
}
export type Ml10xEffect =
  | { op: "rename"; slot: Ml10xSlotSnapshot; after: Ml10xSlotSnapshot; name_before: string; verified: Record<string, boolean> }
  | { op: "copy"; source: Ml10xSlotSnapshot; destination: Ml10xSlotSnapshot; after: Ml10xSlotSnapshot; overwrote: Ml10xSlotSnapshot | null; verified: Record<string, boolean> }
  | { op: "move"; source: Ml10xSlotSnapshot; destination: Ml10xSlotSnapshot; after: Ml10xSlotSnapshot; source_after: Ml10xSlotSnapshot; overwrote: Ml10xSlotSnapshot | null; cleared_with: string; verified: Record<string, boolean> }
  | { op: "swap"; via: "move" | "swap"; a: Ml10xSlotSnapshot; b: Ml10xSlotSnapshot; a_after: Ml10xSlotSnapshot; b_after: Ml10xSlotSnapshot; verified: Record<string, boolean> }
  | { op: "rename_connector"; connector: number; field: string; before: string; after: string };

export interface Ml10xProposeResult {
  ok: boolean;
  problems: string[];
  warnings: string[];
  text: string;
  filename: string;
  diff: {
    changes: { path: string[]; label: string; change: string; before: unknown; after: unknown }[];
    total: number;
    metadata: { download_date: { before: string | null; after: string | null }; hash: { before: number | null; after: number | null } };
  };
  effects: Ml10xEffect[];
  slots: { bank: number; preset: number; before: Ml10xSlotSummary; after: Ml10xSlotSummary; fields_changed: string[] }[];
  self_check: { ok: boolean; problems: string[]; hash_matches: boolean | null };
  preservation: { check: string; ok: boolean; detail: string }[];
  preserved: {
    untouched_presets: number;
    touched_presets: number;
    unknown_keys_before: number;
    unknown_keys_after: number;
    routing_fields_authored: number;
    byte_identical_to_input: boolean;
    structurally_identical_to_input: boolean;
  };
  identity: { device_model: number; dump_type: string; schema_version: number; download_date: string; hash: number; presets: number; size_bytes: number };
  evidence: Record<string, unknown> & { editor_validated: boolean; hardware_validated: boolean };
  operations_applied: number;
}

export interface Ml10xSlotMap {
  ok: boolean;
  problems: string[];
  slots: Ml10xSlotSnapshot[];
  empty_rule: { template_available: boolean; note: string } | null;
}

export interface UnknownReport { device: null; native: NativeSummary; interpreted: null; coverage: null }
export type InspectReport = Mc8Report | Ml10xReport | UnknownReport;

export interface CompareMessage { slot: number; summary: string; tuple: (number | null)[]; supported: boolean }
export interface ComparePosition {
  position: string;
  status: "same" | "differs" | "only_native" | "only_modeled" | "both_empty";
  differences: string[];
  native: { short_name: string | null; long_name: string | null; toggle_name: string | null; toggle_mode: boolean; messages: CompareMessage[] };
  modeled: { short_name: string; long_name: string; toggle_name: string; toggle_mode: boolean; scene_name: string | null; messages: CompareMessage[] };
}
export interface CompareReport {
  ok: boolean;
  plan_diagnostics: { code: string; severity: string; message: string }[];
  bank: { native_name: string; modeled_name: string; name_same: boolean; native_clear_toggle: boolean; native_bank_messages: number; note: string };
  positions: ComparePosition[];
  summary: { same: number; differs: number; only_native: number; only_modeled: number; both_empty: number; modeled_bank_number: number; native_bank_number: number | null; identical: boolean };
  rig: { id: string; name: string; bank_number: number; bank_name: string };
}

export interface Edit { path: (string | number)[]; value: unknown }
export interface ProposeResult {
  ok: boolean;
  problems: string[];
  warnings: string[];
  dump: unknown;
  text: string;
  filename: string;
  diff: { changes: { path: string[]; label: string; change: string; before: unknown; after: unknown }[]; total: number };
  self_check: { ok: boolean; problems: string[]; hash_matches: boolean | null };
  preserved: { third_party_messages: number; unknown_type_messages: number; unknown_keys: number; byte_identical_to_input: boolean };
  edits_applied: number;
}

export interface MatrixDiff {
  ok: boolean;
  presets: { bank: number; number: number; name_a: string | null; name_b: string | null; matrix_rows: { row: string; hypothesis: string | null; before: number[] | null; after: number[] | null; bits_before: string[]; bits_after: string[] }[]; other_fields: { field: string; before: unknown; after: unknown }[] }[];
  controller_changes: { field: string; before: unknown; after: unknown }[];
  summary: { presets_changed: number; matrix_rows_changed: number; controller_fields_changed: number; hash_a: number | null; hash_b: number | null; hint: string };
  structural: { total: number; by_kind: Record<string, number>; truncated: boolean; touched: string[] };
}

export type BridgeStatus = Record<string, { level: string; available: boolean; note: string }>;

async function call<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "Cannot reach the Signal Loom backend. Is it running on port 8000?");
  }
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? body;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export const bridgeApi = {
  status: () => call<BridgeStatus>("/api/morningstar/status", { method: "GET" }),
  /** The file text is posted as-is (never stored); the backend auto-detects MC8 vs ML10X. */
  inspect: (text: string) => call<InspectReport>("/api/morningstar/inspect", { method: "POST", body: text, headers: { "Content-Type": "application/json" } }),
  compare: (file: string, rigId: string, bankNumber: number | null, bankIndex: number | null) =>
    call<CompareReport>("/api/morningstar/mc8/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file, rig_id: rigId, bank_number: bankNumber, bank_index: bankIndex }) }),
  propose: (file: string, edits: Edit[], bankIndex: number | null) =>
    call<ProposeResult>("/api/morningstar/mc8/propose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file, edits, bank_index: bankIndex }) }),
  matrixDiff: (a: string, b: string) => call<MatrixDiff>("/api/morningstar/ml10x/matrix-diff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a, b }) }),
  /** One transaction of routing-free ML10X preset operations → a reviewable candidate Device Backup (422 with diagnostics on refusal). */
  ml10xPropose: (file: string, operations: Ml10xOperation[]) =>
    call<Ml10xProposeResult>("/api/morningstar/ml10x/propose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file, operations }) }),
  ml10xSlots: (file: string) => call<Ml10xSlotMap>("/api/morningstar/ml10x/slots", { method: "POST", body: file, headers: { "Content-Type": "application/json" } }),
};

/** Human text for an ApiError detail of the shape {message, problems?}. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.detail as { message?: string; problems?: string[] } | string;
    if (typeof d === "object" && d) return [d.message, ...(d.problems ?? [])].filter(Boolean).join(" ");
    return String(d);
  }
  return e instanceof Error ? e.message : String(e);
}
