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

/** Where a connector appears in the device's photograph (stored-image coordinates, 0–1; may lie outside the crop). */
export interface ImageAnchor { x: number; y: number; asset_id: string }
export interface PortDef {
  id: string;
  label: string;
  kind: SignalKind;
  direction: PortDirection;
  /** Provenance of the connector's description; null = shares the profile's provenance, "user" = entered by the user. */
  evidence?: Evidence | null;
  image_anchor?: ImageAnchor | null;
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
  supply_ac_dc?: "dc" | "ac" | null;
  /** Settings of a selectable outlet; `supply_voltage_v` / `supply_current_ma_max` are the default. */
  supply_options?: SupplyOption[];
  supply_isolated?: boolean | null;
  supply_shared_group?: string | null;
  notes?: string | null;
}
export interface SupplyOption { voltage_v: number; current_ma_max: number | null; note?: string | null }

export interface CcDef { cc: number; name: string; value_semantics?: string | null; evidence: Evidence }

/** A user-supplied PDF attached to a profile, by reference only (bytes live in the local document store). */
export type DocumentKind = "manual" | "quick_start" | "midi_chart" | "other";
export const DOCUMENT_KINDS: { value: DocumentKind; label: string }[] = [
  { value: "manual", label: "Manual" }, { value: "quick_start", label: "Quick start" }, { value: "midi_chart", label: "MIDI chart" }, { value: "other", label: "Other" },
];
export interface DocumentRef { document_id: string; title: string; kind: DocumentKind; note?: string | null }
export interface DocumentRecord { id: string; kind: string; content_type: string; byte_size: number; sha256: string; page_count: number | null; original_name: string | null; created_at: string; updated_at: string; url: string; download_url: string }
export interface DocumentFile { document_id: string; present: boolean; page_count?: number | null; byte_size?: number | null }

/** One named MIDI command of a device (see backend MidiCommand). The channel is never part of it. */
export type CommandKind = "cc" | "pc";
export type ValueMode = "fixed" | "choice" | "any";
export type CommandIntent = "engage" | "bypass" | "set" | "toggle" | "recall" | "other";
export const COMMAND_INTENTS: CommandIntent[] = ["engage", "bypass", "set", "toggle", "recall", "other"];
export interface ValueChoice { value: number; label: string }
export interface CommandCitation { document_id: string; page?: number | null; note?: string | null }
export interface MidiCommand {
  id: string; name: string; category?: string | null; tags: string[]; description?: string | null; favorite: boolean;
  kind: CommandKind;
  cc?: number | null; value_mode: ValueMode; value?: number | null; choices: ValueChoice[];
  pc?: number | null; bank_msb?: number | null; bank_lsb?: number | null;
  intent?: CommandIntent | null; deterministic?: boolean | null;
  evidence: Evidence; citation?: CommandCitation | null; verified_on_hardware: boolean; note?: string | null;
}

/** Normalized selection (0–1) in the stored, orientation-corrected photograph: the enclosure. */
export interface ImageCrop { x: number; y: number; w: number; h: number }
/** A user photograph fitted to a device's physical footprint (which stays the source of truth for size). */
export interface DeviceImage {
  asset_id: string;
  crop: ImageCrop;
  /** Quarter turns (clockwise) applied to the cropped picture so its top matches the device's top edge. */
  rotation_quarter: number;
  /** contain = whole selection visible, margins show the enclosure colour; cover = fill the footprint, clip the overhang. */
  fit: "contain" | "cover";
  /** True only when the selection was made against a known width and depth. */
  calibrated: boolean;
  note?: string | null;
}
/** A stored image asset as the API reports it. */
export interface AssetRecord { id: string; kind: string; content_type: string; width: number; height: number; byte_size: number; sha256: string; original_name: string | null; created_at: string; url: string }
/** The effective picture of a placed device, resolved by the backend (instance override or profile). */
export type ResolvedImage =
  | { asset_id: string; missing: true; source: "instance" | "profile" }
  | { asset_id: string; missing: false; source: "instance" | "profile"; url: string; width: number; height: number; crop: ImageCrop; rotation_quarter: number; fit: "contain" | "cover"; calibrated: boolean };
export interface DeviceProfile {
  id: string;
  manufacturer: string;
  model: string;
  category: (typeof CATEGORIES)[number];
  revision?: string | null;
  image_ref?: string | null;
  image?: DeviceImage | null;
  provenance: { source: string; url?: string | null; evidence: Evidence; license?: string | null; attribution?: string | null; retrieved?: string | null };
  footprint: Footprint;
  ports: PortDef[];
  power: { voltage_v: number | null; voltage_max_v?: number | null; polarity: string; ac_dc?: string | null; current_ma_min: number | null; connector: Connector; evidence: Evidence; note?: string | null };
  midi: {
    interfaces: string[]; default_channel: number | null; channel_configurable?: boolean | null;
    program_change: { supported: boolean | null; min: number | null; max: number | null; display_numbering?: string | null; bank_select_supported?: boolean | null; note?: string | null; evidence: Evidence };
    cc_map: CcDef[];
    bypass: { method?: string | null; cc?: number | null; on_value?: number | null; off_value?: number | null; deterministic?: boolean | null; evidence: Evidence; note?: string | null };
    /** The user's named command library; absent on profiles saved before it existed. */
    commands?: MidiCommand[];
    source_url?: string | null; evidence: Evidence; note?: string | null;
  };
  /** Attached PDF documents by reference; absent on older profiles. */
  documents?: DocumentRef[];
  capabilities: { bypass_method?: string | null; patch_selection?: string | null; params_via_midi?: boolean | null; is_stereo?: boolean | null; notes?: string | null };
  declared_unknowns: string[];
  tags: string[];
  notes?: string | null;
  builtin: boolean;
  // only on API responses
  unknown_attributes?: string[];
  source?: string;
  /** What this computer knows about each referenced document (attached or cited). */
  document_files?: DocumentFile[];
}

/** Where a device is mounted: on the board, under it (same x/y, seen through the board from above, not mirrored), or off the board. */
export type Surface = "top" | "underside" | "off_board";
export interface Board {
  name: string; width_mm: number; depth_mm: number; grid_mm: number;
  /** Manufacturer pedalboard (catalog id) or null for a custom board. */
  model_id?: string | null;
  /** Usable height under the board as measured by the user; null = not stated. */
  underside_clearance_mm?: number | null; underside_clearance_note?: string | null;
  notes?: string | null;
}
/** A manufacturer pedalboard as the catalog describes it (every figure with its evidence). */
export interface PedalboardSpec {
  id: string; manufacturer: string; model: string;
  width: Measure; depth: Measure; height: Measure;
  rails: number | null; rail_pitch: Measure;
  underside_mountable: boolean | null; underside_clearance: Measure; open_front: boolean | null;
  mounting_notes?: string | null; compatible_brackets: string[];
  provenance: { source: string; url?: string | null; evidence: Evidence; license?: string | null; attribution?: string | null; retrieved?: string | null };
  declared_unknowns: string[]; tags: string[];
}
export interface DeviceInstance {
  id: string; profile_id: string; label: string; x_mm: number; y_mm: number; rotation: Rotation;
  intentional_overlap: boolean;
  /** Legacy flag (pre-surfaces rigs). Read the effective surface with `surfaceOf()`. */
  off_board: boolean;
  /** Mounting surface; null/absent on older rigs (derived from off_board). */
  surface?: Surface | null;
  midi_channel: number | null;
  port_overrides: PortDef[]; removed_port_ids: string[];
  /** Selected voltage per selectable outlet (port id → V) on a power supply. */
  supply_settings?: Record<string, number>;
  image?: DeviceImage | null; notes?: string | null;
}
export interface PortRef { instance_id: string; port_id: string }
export interface Connection {
  id: string; kind: SignalKind; source: PortRef; target: PortRef; label?: string | null;
  cable_length_cm?: number | null; connector_style?: string | null; intentional: boolean; notes?: string | null;
}
/** Snapshot of the library command a scene value was applied from. The numeric fields beside it stay authoritative. */
export interface AppliedCommand { command_id: string; name: string; definition: string; value_label?: string | null; deterministic?: boolean | null; applied_at?: string | null }
export interface ProgramSelection { pc: number; bank_msb?: number | null; bank_lsb?: number | null; command?: AppliedCommand | null }
export interface CcValue { cc: number; value: number; label?: string | null; command?: AppliedCommand | null }
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
  id: string; name: string; description?: string | null; created_at: string; updated_at: string; revision: number;
  board: Board; instances: DeviceInstance[]; connections: Connection[]; scenes: Scene[];
  controllers: {
    mc8: { instance_id: string | null; banks: Mc8Bank[]; firmware_version: string | null };
    ml10x: { instance_id: string | null; firmware_version: string | null; advanced_mode: boolean; loop_assignments: { loop: number; label?: string | null; stereo_pair_with?: number | null }[]; presets: Ml10xPreset[] };
  };
  notes?: string | null;
}
export interface PreviewDevice { x_mm: number; y_mm: number; width_mm: number; height_mm: number; category: string; off_board: boolean; surface: Surface; placeholder: boolean; rotation: number; image: ResolvedImage | null }
export interface RigPreview { width_mm: number; depth_mm: number; devices: PreviewDevice[]; cable_count: number }
export interface RigSummary { id: string; name: string; description?: string | null; created_at: string; updated_at: string; revision: number; instance_count: number; scene_count: number; preview?: RigPreview | null }

export interface Diagnostic { code: string; severity: Severity; message: string; subject_type: string; subject_id: string | null; related_ids: string[] }
export interface PlacedPort { port_id: string; label: string; kind: SignalKind; direction: PortDirection; x_mm: number; y_mm: number; edge: Edge; estimated: boolean; plug_clearance_mm: number | null; role: string | null; loop: number | null }
export interface CompiledMessage { type: "pc" | "cc"; channel: number; number: number; value: number | null; target_instance_id: string; target_label: string; source_kind: string; scene_id: string; explanation: string; deterministic: boolean; summary: string }
export interface ScenePlan { scene_id: string; scene_name: string; messages: CompiledMessage[]; manual_steps: string[]; diagnostics: Diagnostic[]; message_count: number }
export interface SwitchPlan { bank_number: number; position: string; short_name: string; scene_id: string | null; scene_name: string | null; action: string; messages: CompiledMessage[]; extra_messages: Mc8Message[]; manual_steps: string[]; diagnostics: Diagnostic[]; message_count: number; message_limit: number }
export interface PathStep {
  node: string; label: string; device: string | null; device_instance_id: string | null;
  state: "through" | "engaged" | "bypassed" | "return_only" | "missing";
  send_jack: string | null; return_jack: string | null; note: string | null;
  /** Switcher jack the conductor leaves through (Send / main Output) and comes back in through (Return / main Input). */
  out_port_id: string | null; in_port_id: string | null;
  /** Physical cables of this step in signal order (send then return; one cable for an input/output node). */
  cables: string[];
}
export interface ConductorPath { name: string; source: string; steps: PathStep[]; ends_at: string[]; branches: string[][]; complete: boolean; summary: string }
export interface PresetPaths { preset_number: number; preset_name: string; mode: string; paths: ConductorPath[]; stereo_output: boolean; stereo_input: boolean }
export interface CableItem { kind: string; description: string; ends: string[]; connection_ids: string[]; length_cm: number | null; notes: string[] }
/** One supply outlet as set up in this rig, with what is cabled to it (derived from the power cables). */
export interface PowerOutlet {
  port_id: string; label: string; voltage_v: number | null; current_ma_max: number | null;
  polarity: string | null; ac_dc: string | null; connector: string; selectable: boolean;
  options: { voltage_v: number; current_ma_max: number | null }[]; selected_voltage_v: number | null; setting_valid: boolean;
  expansion: boolean; isolated: boolean | null; shared_group: string | null; evidence: string | null;
  assigned: PowerConsumer[]; required_known_ma: number; unknown_count: number; remaining_ma: number | null;
  status: "ok" | "warning" | "error" | "unknown" | "unused" | "expansion"; issues: Record<string, Severity>;
}
export interface PowerConsumer {
  instance_id: string; label: string; surface: Surface; voltage_v: number | null; voltage_max_v: number | null; polarity: string | null; ac_dc: string | null;
  current_ma_min: number | null; requirement_known: boolean; current_known: boolean; evidence: string | null;
  connection_id?: string; port_id?: string; inlet_port_id?: string; powered?: boolean;
}
export interface PowerPlan {
  supplies: { instance_id: string; label: string; profile: string; surface: Surface; evidence: string | null; outputs: PowerOutlet[] }[];
  consumers: PowerConsumer[]; unpowered: string[]; unknown_requirements: string[]; note: string;
}
export interface Analysis {
  rig_id: string;
  diagnostics: Diagnostic[];
  summary: { errors: number; warnings: number; infos: number };
  ml10x: { topology: null | { instance_id: string; label: string; input_cabled: boolean; output_cabled: boolean; stereo_pairs: { tip: number; ring: number; label: string }[]; loops: { loop: number; name: string; send_to: string | null; send_to_instance_id: string | null; return_from: string | null; return_from_instance_id: string | null; complete: boolean; occupied: boolean }[] }; diagnostics: Diagnostic[]; preset_paths: PresetPaths[] };
  cable_kit: CableItem[];
  /** MIDI cables from the MC8 to every device it reaches, in order (through MIDI Thru and the Omniport). */
  midi: { controller_id: string | null; routes: Record<string, string[]> };
  power: PowerPlan;
  /** The board as a physical object: its catalog spec (if any) and the usable height underneath. */
  mounting: { spec: PedalboardSpec | null; clearance_mm: number | null; clearance_source: string; counts: Record<Surface, number> };
  instances: Record<string, { width_mm: number; height_mm: number; placeholder: boolean; surface: Surface; tall_mm: number | null; ports: PlacedPort[]; effective_ports: PortDef[]; unknowns: string[]; image: ResolvedImage | null }>;
  compiled: { scenes: ScenePlan[]; mc8: { instance_id: string | null; firmware_assumed: string; limits: { banks: number; presets_per_bank: number; messages_per_preset: number; footswitch_positions: string[] }; banks: { number: number; name: string; diagnostics: Diagnostic[]; switches: SwitchPlan[] }[] }; diagnostics: Diagnostic[] };
}
export interface ExportStatus { [key: string]: { level: string; available: boolean; note: string } }
