// Hand-written mirror of the backend Pydantic models (backend/app/models). Keep in sync.

export type Evidence = "documented" | "third_party" | "approximate" | "user" | "unknown";
export type SignalKind = "audio" | "midi" | "expression" | "power" | "usb";
export type PortDirection = "in" | "out" | "bidirectional";
export type Edge = "top" | "bottom" | "left" | "right" | "top_face";
export type Rotation = 0 | 90 | 180 | 270;
export type Severity = "error" | "warning" | "info";

export const CONNECTORS = [
  "ts_1_4", "trs_1_4", "trs_1_8", "din5", "usb_c", "usb_b", "usb_mini", "usb_micro",
  "dc_barrel_2_1mm", "dc_barrel_2_5mm", "xlr", "other", "unknown",
] as const;
export type Connector = (typeof CONNECTORS)[number];
export const AUDIO_CHANNELS = ["mono", "left", "right", "stereo_trs", "unknown"] as const;
export const TRS_ROLES = ["stereo", "mono", "balanced", "insert", "midi", "expression", "unknown"] as const;
export const MIDI_TRS_TYPES = ["type_a", "type_b", "din", "proprietary", "unknown"] as const;
export const CATEGORIES = ["instrument", "controller", "switcher", "effect", "amp", "power_supply", "utility", "other"] as const;

export interface Measure { value_mm: number | null; evidence: Evidence; note?: string | null }
export interface Footprint { width: Measure; depth: Measure; height: Measure; includes_jacks: boolean | null; display_unit: string }

export interface PortDef {
  id: string;
  label: string;
  kind: SignalKind;
  direction: PortDirection;
  connector: Connector;
  audio_channel?: (typeof AUDIO_CHANNELS)[number] | null;
  trs_role?: (typeof TRS_ROLES)[number] | null;
  midi_trs_type?: (typeof MIDI_TRS_TYPES)[number] | null;
  edge: Edge;
  position: number | null;
  position_evidence: Evidence;
  plug_clearance_mm?: number | null;
  exclusive?: boolean | null;
  pair_group?: string | null;
  role?: string | null;
  loop?: number | null;
  supply_voltage_v?: number | null;
  supply_polarity?: "center_negative" | "center_positive" | "unknown" | null;
  supply_current_ma_max?: number | null;
  notes?: string | null;
}

export interface CcDef { cc: number; name: string; value_semantics?: string | null; evidence: Evidence }
export interface DeviceProfile {
  id: string;
  manufacturer: string;
  model: string;
  category: (typeof CATEGORIES)[number];
  revision?: string | null;
  image_ref?: string | null;
  provenance: { source: string; url?: string | null; evidence: Evidence; license?: string | null; attribution?: string | null; retrieved?: string | null };
  footprint: Footprint;
  ports: PortDef[];
  power: { voltage_v: number | null; polarity: string; ac_dc?: string | null; current_ma_min: number | null; connector: Connector; evidence: Evidence; note?: string | null };
  midi: {
    interfaces: string[]; default_channel: number | null; channel_configurable?: boolean | null;
    program_change: { supported: boolean | null; min: number | null; max: number | null; display_numbering?: string | null; bank_select_supported?: boolean | null; note?: string | null; evidence: Evidence };
    cc_map: CcDef[];
    bypass: { method?: string | null; cc?: number | null; on_value?: number | null; off_value?: number | null; deterministic?: boolean | null; evidence: Evidence; note?: string | null };
    source_url?: string | null; evidence: Evidence; note?: string | null;
  };
  capabilities: { bypass_method?: string | null; patch_selection?: string | null; params_via_midi?: boolean | null; is_stereo?: boolean | null; notes?: string | null };
  declared_unknowns: string[];
  tags: string[];
  notes?: string | null;
  builtin: boolean;
  // only on API responses
  unknown_attributes?: string[];
  source?: string;
}

export interface Board { name: string; width_mm: number; depth_mm: number; grid_mm: number; notes?: string | null }
export interface DeviceInstance {
  id: string; profile_id: string; label: string; x_mm: number; y_mm: number; rotation: Rotation;
  intentional_overlap: boolean; off_board: boolean; midi_channel: number | null;
  port_overrides: PortDef[]; removed_port_ids: string[]; notes?: string | null;
}
export interface PortRef { instance_id: string; port_id: string }
export interface Connection {
  id: string; kind: SignalKind; source: PortRef; target: PortRef; label?: string | null;
  cable_length_cm?: number | null; connector_style?: string | null; intentional: boolean; notes?: string | null;
}
export interface ProgramSelection { pc: number; bank_msb?: number | null; bank_lsb?: number | null }
export interface CcValue { cc: number; value: number; label?: string | null }
export interface DeviceSceneState { instance_id: string; program: ProgramSelection | null; enabled: boolean | null; cc_values: CcValue[]; manual_note?: string | null }
export interface Scene {
  id: string; name: string; song?: string | null; section?: string | null; order: number; color?: string | null;
  ml10x: { preset_number: number | null; loop_states: Record<string, boolean> };
  device_states: DeviceSceneState[]; manual_steps: string[]; notes?: string | null;
}
export interface Mc8Message { type: string; channel: number | null; number: number | null; value: number | null; action: string; toggle_position: string; label?: string | null }
export interface Mc8Preset { position: string; short_name: string; long_name?: string | null; toggle_name?: string | null; toggle_mode: boolean; scene_id: string | null; action: string; extra_messages: Mc8Message[] }
export interface Mc8Bank { number: number; name: string; presets: Mc8Preset[] }
export interface Ml10xPreset { number: number; name: string; mode: "simple" | "advanced"; chain: number[]; bypassed_loops: number[]; advanced_edges: string[][]; notes?: string | null }
export interface Rig {
  id: string; name: string; description?: string | null; created_at: string; updated_at: string;
  board: Board; instances: DeviceInstance[]; connections: Connection[]; scenes: Scene[];
  controllers: {
    mc8: { instance_id: string | null; banks: Mc8Bank[]; firmware_version: string | null };
    ml10x: { instance_id: string | null; firmware_version: string | null; advanced_mode: boolean; loop_assignments: { loop: number; label?: string | null; stereo_pair_with?: number | null }[]; presets: Ml10xPreset[] };
  };
  notes?: string | null;
}
export interface RigSummary { id: string; name: string; description?: string | null; created_at: string; updated_at: string; instance_count: number; scene_count: number }

export interface Diagnostic { code: string; severity: Severity; message: string; subject_type: string; subject_id: string | null; related_ids: string[] }
export interface PlacedPort { port_id: string; label: string; kind: SignalKind; direction: PortDirection; x_mm: number; y_mm: number; edge: Edge; estimated: boolean; plug_clearance_mm: number | null; role: string | null; loop: number | null }
export interface CompiledMessage { type: "pc" | "cc"; channel: number; number: number; value: number | null; target_instance_id: string; target_label: string; source_kind: string; scene_id: string; explanation: string; deterministic: boolean; summary: string }
export interface ScenePlan { scene_id: string; scene_name: string; messages: CompiledMessage[]; manual_steps: string[]; diagnostics: Diagnostic[]; message_count: number }
export interface SwitchPlan { bank_number: number; position: string; short_name: string; scene_id: string | null; scene_name: string | null; action: string; messages: CompiledMessage[]; extra_messages: Mc8Message[]; manual_steps: string[]; diagnostics: Diagnostic[]; message_count: number; message_limit: number }
export interface Analysis {
  rig_id: string;
  diagnostics: Diagnostic[];
  summary: { errors: number; warnings: number; infos: number };
  ml10x: { topology: null | { instance_id: string; label: string; input_cabled: boolean; output_cabled: boolean; stereo_pairs: { tip: number; ring: number; label: string }[]; loops: { loop: number; name: string; send_to: string | null; send_to_instance_id: string | null; return_from: string | null; return_from_instance_id: string | null; complete: boolean; occupied: boolean }[] }; diagnostics: Diagnostic[] };
  instances: Record<string, { width_mm: number; height_mm: number; placeholder: boolean; ports: PlacedPort[]; effective_ports: PortDef[]; unknowns: string[] }>;
  compiled: { scenes: ScenePlan[]; mc8: { instance_id: string | null; firmware_assumed: string; limits: { banks: number; presets_per_bank: number; messages_per_preset: number; footswitch_positions: string[] }; banks: { number: number; name: string; diagnostics: Diagnostic[]; switches: SwitchPlan[] }[] }; diagnostics: Diagnostic[] };
}
export interface ExportStatus { [key: string]: { level: string; available: boolean; note: string } }
