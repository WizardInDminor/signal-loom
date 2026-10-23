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

// ---------------------------------------------------------------------------- MIDI control knowledge (Session 6)
// Mirror of backend CcDef / SourceCitation / DeviceNote. Everything beyond cc/name is optional and
// defaults to "not stated"; nothing is inferred by the app.
export type ControlBehavior = "continuous" | "discrete" | "toggle" | "trigger" | "unknown";
export type ControlMapping = "manufacturer_default" | "user_configured";
export type HardwareStatus = "unverified" | "verified" | "failed";
export type ReviewStatus = "proposed" | "reviewed";
/** Where in an attached document a fact is described. `page` is the PDF page index (1-based), not the printed number. */
export interface SourceCitation { document_id: string; page?: number | null; note?: string | null }
/** `continuous`: documented as a repeatable 0–127 sweep (true), discrete (false) or not stated (null/absent). Only true makes a CC eligible for modulation. `behavior` is the richer statement and is kept in agreement with it (derive `continuous` before saving: see lib/knowledge.ts). */
export interface CcDef {
  cc: number; name: string; value_semantics?: string | null; evidence: Evidence; continuous?: boolean | null;
  behavior?: ControlBehavior | null;
  min_value?: number | null; max_value?: number | null;
  citation?: SourceCitation | null;
  mapping?: ControlMapping; factory_cc?: number | null;
  hardware_status?: HardwareStatus; hardware_note?: string | null;
  /** null/absent = reviewed (legacy or hand-entered); "proposed" = came from PDF text and awaits a human. */
  review_status?: ReviewStatus | null;
  notes?: string | null;
}
export type NoteCategory = "presets" | "modes" | "midi_setup" | "global_settings" | "startup" | "firmware" | "troubleshooting" | "technique" | "other";
/** A Quick Reference note: on a profile it describes the model, on a placed instance that one unit. */
export interface DeviceNote {
  id: string; title: string; body: string; category: NoteCategory; steps: string[]; references: SourceCitation[];
  evidence: Evidence; source_note?: string | null; pinned: boolean; created_at?: string | null; updated_at?: string | null;
}
/** A control proposed from one page's text (`GET /api/documents/{id}/pages/{n}/proposals`): a CcDef plus the matched snippet; always `review_status: "proposed"`. */
export interface ControlProposal extends CcDef { snippet: string }
export interface ControlSceneUse { rig_id: string; rig_name: string; scene_id: string; scene_name: string; instance_id: string; instance_label: string; value: number; command: string | null }
export interface ControlTextureUse { rig_id: string; rig_name: string; texture_id: string; texture_name: string; macro_name: string; instance_id: string; instance_label: string; output_min: number; output_max: number; enabled: boolean }
export type ControlUsage = Record<string, { scenes: ControlSceneUse[]; textures: ControlTextureUse[] }>;

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
export type CommandCitation = SourceCitation;
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
  /** Model-level Quick Reference notes (Session 6); absent on older profiles. */
  quick_reference?: DeviceNote[];
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
  /** Quick Reference notes about this one unit (Session 6); absent on older rigs. */
  quick_reference?: DeviceNote[];
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
// ---------------------------------------------------------------------------- Textures (Session 5)
// Mirror of backend/app/models/texture.py: authored musical intent that travels with the rig.
export type LfoShape = "triangle";
export type TextureOrigin = "user" | "virtual_fixture";
export const FUNCTION_ROLES = ["drive", "dynamics", "pitch", "modulation", "delay", "space", "routing", "other"] as const;
export type FunctionRole = (typeof FUNCTION_ROLES)[number];
export const TEMPO_MIN_BPM = 20;
export const TEMPO_MAX_BPM = 300;
export interface Lfo { enabled: boolean; shape: LfoShape; beats_per_cycle: number; depth: number }
/** One macro destination: a CC on a placed device scaled into an authored range (min > max = inverse). */
export interface Mapping {
  id: string; instance_id: string; cc: number; output_min: number; output_max: number; label?: string | null; enabled: boolean;
  /** The user's explicit claim that this CC is safe to sweep on this device; needs a note and is always shown with a warning. */
  user_override: boolean; override_note?: string | null;
}
export interface Macro { id: string; name: string; base: number; mappings: Mapping[]; lfo: Lfo }
export interface Texture {
  id: string; name: string; intent?: string | null; notes?: string | null; base_scene_id?: string | null; tempo_bpm: number;
  macros: Macro[]; function_roles: Record<string, string>; origin: TextureOrigin; created_at?: string | null; updated_at?: string | null;
}
export type EligibilityBasis = "documented" | "synthetic" | "user_declared";
export interface Eligibility { eligible: boolean; reason: string; basis: EligibilityBasis | null; warnings: string[]; control_name: string | null; evidence: string | null; channel: number | null; instance_label: string | null; synthetic: boolean; hard_refusal: boolean }
/** `analysis.textures[texture_id]`: per mapping its eligibility and the backend's values at macro 0 / ½ / 1. */
/** `conflict`: set when another *enabled* mapping of the same texture addresses the same device and CC (two sources cannot drive one control; Start is refused until repaired). */
export interface TextureReport { id: string; name: string; base_scene_missing: boolean; mappings: Record<string, Eligibility & { at_0: number; at_half: number; at_1: number; macro_id: string; inverted: boolean; conflict?: string | null }>; eligible_devices: string[] }

export interface Rig {
  id: string; name: string; description?: string | null; created_at: string; updated_at: string; revision: number;
  board: Board; instances: DeviceInstance[]; connections: Connection[]; scenes: Scene[];
  /** Musical ideas (Session 5); absent/empty on older rigs. */
  textures: Texture[];
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
  textures: Record<string, TextureReport>;
}
export interface ExportStatus { [key: string]: { level: string; available: boolean; note: string } }

// ---------------------------------------------------------------------------- Live control (Session 4)
// Mirror of backend/app/models/live.py and the shapes produced by app/live/*. Workstation-local.

export type TransportMode = "virtual" | "rtmidi";
export type MessageKind = "pc" | "cc" | "clock" | "sysex_read";
export type RouteEvidence = "published" | "unknown" | "simulation_tested" | "hardware_verified";
export type CoverageStatus = "supported" | "unverified" | "unsupported" | "unreachable";

export interface LiveEndpoint { id: string; name: string; direction: "in" | "out"; transport: string; available: boolean; busy: boolean; note: string | null; peer_count: number }
export interface EndpointBinding { endpoint_id: string; instance_id: string; port_id: string; direction: "out" | "in" | "both"; note?: string | null; peer_count?: number | null }
export interface ChannelGroup { channel: number; instance_ids: string[]; note?: string | null }
export interface LiveBindings { rig_id: string; transport_mode: TransportMode; bindings: EndpointBinding[]; channel_groups: ChannelGroup[]; send_delay_ms: number; verified_hops: Record<string, string>; updated_at?: string | null }

export interface LiveJob { id: string; label: string; total: number; sent: number; failed: number; cancelled: number; pending: number; started_at: string; finished_at: string | null; done: boolean }
export interface LiveEndpointState { endpoint_id: string; name: string; direction: string; open: boolean; busy: boolean; missing: boolean; released: boolean; ambiguous: boolean; peer_count: number | null; error: string | null; bound_to: string[] }
export interface LiveStatus {
  mode: TransportMode;
  transports: Record<TransportMode, { available: boolean; reason: string | null; label: string }>;
  connected_rig_id: string | null;
  endpoints: LiveEndpointState[];
  released: string[];
  notes: string[];
  watching: boolean;
  watch_interval_s: number;
  last_check_at: string | null;
  armed: boolean;
  armed_at: string | null;
  queue_length: number;
  /** Summary of the one message currently being handed to the driver, if any. */
  in_flight: string | null;
  seq: number;
  arm_phrase: string;
  /** Route prerequisites / unverified hops acknowledged in this connection session. */
  acknowledged: string[];
  jobs: LiveJob[];
  /** Session 5: the performance engine. */
  performance: PerformanceStatus;
}

// ---------------------------------------------------------------------------- Performance (Session 5)
export type PerformanceState = "idle" | "performing" | "stopped" | "fault";
export interface PerformanceMacro { macro_id: string; name: string; base: number; lfo_enabled: boolean; depth: number; beats_per_cycle: number; phase: number; lfo: number; effective: number }
export interface PerformanceDestination { mapping_id: string; macro_id: string; instance_id: string; label: string; cc: number; channel: number; output_min: number; output_max: number; endpoint_name: string | null; route_status: CoverageStatus; last_commanded: number | null; handed: number }
export interface PerformanceCounters { ticks: number; evaluations: number; planned: number; handed: number; deduplicated: number; deferred: number; refused: number }
export interface PerformanceStatus {
  state: PerformanceState; tick_s: number; max_per_tick: number; budget: { aggregate_per_s: number; per_destination_per_s: number }; lease_s: number;
  texture_id: string | null; texture_name: string | null; rig_id: string | null; job_id: string | null;
  started_at: string | null; stopped_at: string | null; stop_reason: string | null; stopped_by: string | null;
  elapsed_s: number | null; lease_remaining_s: number | null; heartbeats: number; has_controller: boolean; tempo_bpm: number | null;
  counters: PerformanceCounters; macros: PerformanceMacro[]; destinations: PerformanceDestination[]; note: string;
}
export interface ReadinessMapping {
  mapping_id: string; macro_id: string; macro_name: string; instance_id: string; label: string; cc: number; channel: number | null;
  output_min: number; output_max: number; inverted: boolean; enabled: boolean; eligibility: Eligibility;
  route: { status: CoverageStatus; evidence: RouteEvidence | null; reason: string; endpoint_id: string | null; endpoint_name: string | null; open: boolean };
  needs_ack: string[]; pending_ack: string[]; values: { at_0: number; at_half: number; at_1: number }; ready: boolean; problems: string[];
}
export interface Readiness { rig_id: string; texture_id: string; texture_name: string; connected: boolean; armed: boolean; mode: TransportMode; performing: boolean; mappings: ReadinessMapping[]; distinct_devices: string[]; confirmations_required: string[]; can_start: boolean; blockers: string[]; note: string }

export interface HopCapability { status: "supported" | "unsupported" | "unknown"; evidence: RouteEvidence; reason: string; prerequisites: string[] }
export interface RouteHop { key: string; from: { node: string; label: string; port_id: string | null }; to: { node: string; label: string; port_id: string | null }; medium: string; connection_id: string | null; capabilities: Record<MessageKind, HopCapability>; note: string | null }
export interface KindCoverage { status: CoverageStatus; evidence: RouteEvidence | null; reason: string; prerequisites: string[]; blocking_hop: string | null }
export interface LiveRoute { endpoint_id: string; hops: RouteHop[]; coverage: Record<MessageKind, KindCoverage> }
export interface LiveTarget { instance_id: string; label: string; profile_id: string; category: string; channel: number | null; has_midi: boolean; routes: LiveRoute[]; best: Record<MessageKind, number | null>; coverage: Record<MessageKind, KindCoverage>; suggestions: string[] }
export interface CoverageRow { instance_id: string; label: string; kind: MessageKind; channel: number | null; endpoint_id: string | null; endpoint_name: string | null; hops: string[]; hop_keys: string[]; status: CoverageStatus; evidence: RouteEvidence | null; reason: string; prerequisites: string[]; suggestions: string[] }
export interface ReceiverNetwork { endpoint_id: string; endpoint_name: string; members: { instance_id: string; label: string; channel: number | null; kinds: MessageKind[] }[]; collisions: Diagnostic[] }
export interface LiveCoverage { targets: Record<string, LiveTarget>; networks: ReceiverNetwork[]; rows: CoverageRow[]; diagnostics: Diagnostic[] }

export interface ResolvedMessage { type: "pc" | "cc"; channel: number; number: number; value: number | null; target_instance_id: string; target_label: string; endpoint_id: string | null; endpoint_name: string | null; hex: string; route_status: CoverageStatus; route_evidence: RouteEvidence | null; route_reason: string; deterministic: boolean; explanation: string; source_kind: string; needs_ack: string[]; summary: string }
export interface DryRun { scene_id: string; scene_name: string; messages: ResolvedMessage[]; confirmations_required: string[]; manual_steps: string[]; diagnostics: Diagnostic[]; sent: false; note: string }
export interface LiveLogEntry { seq: number; at: string; kind: "armed" | "disarmed" | "queued" | "sent" | "failed" | "cancelled" | "stopped" | "refused" | "note"; message: string; job_id: string | null; resolved: ResolvedMessage | null; rig_id: string | null }
export interface ObservedMessage { seq: number; at: string; endpoint_id: string; endpoint_name: string; type: string; channel: number | null; number: number | null; value: number | null; hex: string; summary: string }
export interface LastSent { program: number | null; bank_msb: number | null; bank_lsb: number | null; cc: Record<string, { value: number; source_kind: string; at: string }>; at: string | null; last?: string }
export interface SimulatedPedal { instance_id: string; label: string; channel: number; program: number | null; bank_msb: number | null; bank_lsb: number | null; bypassed: boolean | null; cc: Record<string, number>; received_count: number; last_received: string | null; routes: Record<string, string>; simulated: true }
export interface ObservedChannel { program: number | null; cc: Record<string, number>; at: string | null; endpoint_name: string }
export interface LiveEvents { status: LiveStatus; log: LiveLogEntry[]; observed: ObservedMessage[]; log_seq: number; observed_seq: number; last_sent: Record<string, LastSent>; simulated: Record<string, SimulatedPedal> }

export interface PanelControls {
  program: { min: number; max: number; display_numbering: string | null; bank_select_supported: boolean | null; supported: boolean | null; evidence: string; note: string | null } | null;
  bypass: { cc: number; on_value: number; off_value: number; deterministic: boolean | null; evidence: string; note: string | null } | null;
  cc: { cc: number; name: string; value_semantics: string | null; evidence: string }[];
  commands: MidiCommand[];
}
export interface LivePanel { instance_id: string; label: string; profile: string; category: string; channel: number | null; coverage: Record<"pc" | "cc", KindCoverage>; controls: PanelControls; last_sent: LastSent | null; observed: ObservedChannel | null; simulated: SimulatedPedal | null }
export interface LivePanels { rig_id: string; mode: TransportMode; connected: boolean; panels: LivePanel[] }
export interface Follower { status: "no_evidence" | "possible" | "ambiguous"; text: string; candidates: { scene_id: string; scene_name: string; matched: number; total: number; complete: boolean }[]; observed_count: number; window_s: number; inputs: LiveEndpointState[]; listening: boolean }
