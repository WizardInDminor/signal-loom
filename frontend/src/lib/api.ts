import type { Analysis, AssetRecord, DeviceProfile, DocumentKind, DocumentRecord, DryRun, ExportStatus, Follower, LiveBindings, LiveCoverage, LiveEndpoint, LiveEvents, LiveJob, LivePanels, LiveStatus, MidiCommand, PedalboardSpec, PortDef, ResolvedMessage, Rig, RigSummary, TransportMode } from "./types";

export interface CommandUse { rig_id: string; rig_name: string; scene_id: string; scene_name: string; instance_id: string; instance_label: string; name_at_apply: string; changed: boolean; removed: boolean }
export interface DocumentMeta extends DocumentRecord { referenced_by: string[]; file_present: boolean }
export interface DocumentSearch { query: string; hits: { page: number; snippet: string }[]; truncated: boolean; has_text_layer: boolean; page_count: number }

export interface PortUsage { rig_id: string; rig_name: string; connection_id: string; connection_label: string | null; instance_id: string; instance_label: string; other_label: string; port_id?: string; change?: string }

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : (detail as { message?: string })?.message ?? `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
  let res: Response;
  const idempotent = !init?.method || init.method === "GET";
  try {
    res = await fetch(path, { headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, ...init });
  } catch {
    // A dropped connection on a read is retried once; writes are never repeated blindly.
    if (idempotent && attempt === 0) { await new Promise((r) => setTimeout(r, 200)); return request<T>(path, init, 1); }
    throw new ApiError(0, "Cannot reach the Signal Loom backend. Is it running on port 8000?");
  }
  // The dev/prod proxy answers a reset backend socket with a bare 500; a read may be retried once.
  if (res.status >= 502 || (res.status === 500 && !(res.headers.get("content-type") ?? "").includes("json"))) {
    if (idempotent && attempt === 0) { await new Promise((r) => setTimeout(r, 200)); return request<T>(path, init, 1); }
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
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Multipart upload: the browser sets the boundary, so no JSON content type here. */
async function upload<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.append("file", file, file.name);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", body: form });
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

export const api = {
  health: () => request<{ status: string; version: string }>("/api/health"),
  rigs: {
    list: () => request<RigSummary[]>("/api/rigs"),
    get: (id: string) => request<Rig>(`/api/rigs/${id}`),
    create: (body: { name: string; description?: string; board_width_mm?: number; board_depth_mm?: number; from_demo?: boolean }) =>
      request<Rig>("/api/rigs", { method: "POST", body: JSON.stringify(body) }),
    put: (rig: Rig) => request<Rig>(`/api/rigs/${rig.id}`, { method: "PUT", body: JSON.stringify(rig) }),
    rename: (id: string, name: string) => request<Rig>(`/api/rigs/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    remove: (id: string) => request<void>(`/api/rigs/${id}`, { method: "DELETE" }),
    duplicate: (id: string) => request<Rig>(`/api/rigs/${id}/duplicate`, { method: "POST" }),
    analysis: (id: string) => request<Analysis>(`/api/rigs/${id}/analysis`),
    analyzeDocument: (rig: Rig) => request<Analysis>("/api/rigs/analyze", { method: "POST", body: JSON.stringify(rig) }),
    exportProject: (id: string, includeImages = false, includeDocuments = false) => {
      const p = new URLSearchParams();
      if (includeImages) p.set("include_images", "1");
      if (includeDocuments) p.set("include_documents", "1");
      const qs = p.toString();
      return request<unknown>(`/api/rigs/${id}/export${qs ? `?${qs}` : ""}`);
    },
    importProject: (text: string, name?: string) =>
      request<{ rig: Rig; warnings: string[]; imported_profiles: string[] }>(`/api/rigs/import${name ? `?name=${encodeURIComponent(name)}` : ""}`, { method: "POST", body: text }),
    exportStatus: (id: string) => request<ExportStatus>(`/api/rigs/${id}/exports/status`),
    mc8Bank: (id: string, bank: number) => request<{ filename: string; evidence_level: string; warning: string; self_check: { ok: boolean; problems: string[]; hash_matches: boolean | null }; dump: unknown }>(`/api/rigs/${id}/exports/mc8-bank/${bank}`),
    inspectMc8: (text: string) => request<{ ok: boolean; problems: string[]; dump_type: string | null; device_model: number | null; hash_matches: boolean | null; banks: { bank_number: number | null; bank_name: string; used_presets: { position: string; short_name: string; message_count: number; types: string[] }[] }[] }>("/api/rigs/inspect/mc8-backup", { method: "POST", body: text }),
    importMc8Bank: (id: string, text: string, replace = false) => request<{ rig: Rig; bank_number: number; imported_presets: number; skipped: { position: string; slot: number; type_code: number; type_name: string }[] }>(`/api/rigs/${id}/import/mc8-bank${replace ? "?replace=1" : ""}`, { method: "POST", body: text }),
    diffBackups: (a: string, b: string) => request<{ ok: boolean; problems: string[]; same_model: boolean | null; device_model: number | null; changes: { path: string[]; label: string; change: string; before: unknown; after: unknown }[]; summary: { total: number; by_kind: Record<string, number>; truncated: boolean; touched: string[] }; metadata_differences: Record<string, { a: unknown; b: unknown }> }>("/api/rigs/inspect/backup-diff", { method: "POST", body: JSON.stringify({ a, b }) }),
    inspectMl10x: (text: string) => request<{ ok: boolean; problems: string[]; midi_channel: number | null; device_id: number | null; connectors: { id: number; name: string; short_name: string; trails: boolean }[]; presets: { bank: number; number: number; global_number: number; name: string; advanced_mode: boolean }[]; settings: Record<string, unknown> }>("/api/rigs/inspect/ml10x-backup", { method: "POST", body: text }),
  },
  assets: {
    list: () => request<(AssetRecord & { referenced: boolean })[]>("/api/assets/images"),
    removeUnreferenced: () => request<{ removed: string[]; count: number }>("/api/assets/images/unreferenced", { method: "DELETE" }),
    upload: (file: File) => upload<AssetRecord>("/api/assets/images", file),
    meta: (id: string) => request<AssetRecord & { referenced_by: { profiles: string[]; rigs: string[] } }>(`/api/assets/images/${encodeURIComponent(id)}/meta`),
    remove: (id: string) => request<void>(`/api/assets/images/${encodeURIComponent(id)}`, { method: "DELETE" }),
  },
  documents: {
    list: () => request<DocumentMeta[]>("/api/documents"),
    meta: (id: string) => request<DocumentMeta>(`/api/documents/${encodeURIComponent(id)}`),
    /** URL of one page rendered to PNG (1-based). Pages are pictures: nothing inside the PDF runs in the app. */
    pageUrl: (id: string, page: number, width = 1000) => `/api/documents/${encodeURIComponent(id)}/pages/${page}?width=${width}`,
    downloadUrl: (id: string) => `/api/documents/${encodeURIComponent(id)}/file`,
    search: (id: string, q: string) => request<DocumentSearch>(`/api/documents/${encodeURIComponent(id)}/search?q=${encodeURIComponent(q)}`),
    remove: (id: string, force = false) => request<void>(`/api/documents/${encodeURIComponent(id)}${force ? "?force=1" : ""}`, { method: "DELETE" }),
    removeUnreferenced: () => request<{ removed: string[]; count: number }>("/api/documents/unreferenced", { method: "DELETE" }),
  },
  /** Live MIDI control (Session 4). The backend owns every port; these calls never send unless armed. */
  live: {
    status: () => request<LiveStatus>("/api/live/status"),
    endpoints: (rigId?: string) => request<LiveEndpoint[]>(`/api/live/endpoints${rigId ? `?rig_id=${encodeURIComponent(rigId)}` : ""}`),
    setMode: (mode: TransportMode) => request<LiveStatus>("/api/live/mode", { method: "POST", body: JSON.stringify({ mode }) }),
    refresh: () => request<LiveStatus>("/api/live/refresh", { method: "POST" }),
    release: (endpointId: string) => request<LiveStatus>("/api/live/release", { method: "POST", body: JSON.stringify({ endpoint_id: endpointId }) }),
    reacquire: (endpointId: string) => request<LiveStatus>("/api/live/reacquire", { method: "POST", body: JSON.stringify({ endpoint_id: endpointId }) }),
    bindings: (rigId: string) => request<LiveBindings>(`/api/live/rigs/${rigId}/bindings`),
    saveBindings: (rigId: string, b: LiveBindings) => request<LiveBindings>(`/api/live/rigs/${rigId}/bindings`, { method: "PUT", body: JSON.stringify(b) }),
    suggestBindings: (rigId: string) => request<LiveBindings>(`/api/live/rigs/${rigId}/bindings/suggest`, { method: "POST" }),
    coverage: (rigId: string) => request<LiveCoverage>(`/api/live/rigs/${rigId}/coverage`),
    connect: (rigId: string) => request<LiveStatus>(`/api/live/rigs/${rigId}/connect`, { method: "POST" }),
    disconnect: () => request<LiveStatus>("/api/live/disconnect", { method: "POST" }),
    arm: (confirm: string) => request<LiveStatus>("/api/live/arm", { method: "POST", body: JSON.stringify({ confirm }) }),
    disarm: () => request<LiveStatus>("/api/live/disarm", { method: "POST" }),
    stop: () => request<LiveStatus & { cancelled: number }>("/api/live/stop", { method: "POST" }),
    dryRun: (rigId: string, sceneId: string) => request<DryRun>(`/api/live/rigs/${rigId}/scenes/${sceneId}/dry-run`, { method: "POST" }),
    audition: (rigId: string, sceneId: string, body: { delay_ms?: number | null; confirm_nondeterministic?: boolean; acknowledge?: string[] }) =>
      request<{ job: LiveJob; warnings: string[]; messages: ResolvedMessage[]; delay_ms: number }>(`/api/live/rigs/${rigId}/scenes/${sceneId}/audition`, { method: "POST", body: JSON.stringify(body) }),
    send: (rigId: string, body: { instance_id: string; type: "pc" | "cc"; number: number; value?: number | null; confirm_nondeterministic?: boolean; coalesce?: boolean; label?: string | null; deterministic?: boolean | null; acknowledge?: string[] }) =>
      request<{ job: LiveJob; warnings: string[]; message: ResolvedMessage }>(`/api/live/rigs/${rigId}/send`, { method: "POST", body: JSON.stringify(body) }),
    panels: (rigId: string) => request<LivePanels>(`/api/live/rigs/${rigId}/panels`),
    follower: (rigId: string) => request<Follower>(`/api/live/rigs/${rigId}/follower`),
    events: (sinceLog = 0, sinceObserved = 0, rigId?: string) => request<LiveEvents>(`/api/live/events?since_log=${sinceLog}&since_observed=${sinceObserved}${rigId ? `&rig_id=${encodeURIComponent(rigId)}` : ""}`),
    inject: (body: { endpoint_id: string; type: "pc" | "cc"; channel: number; number: number; value?: number | null }) => request<{ delivered: boolean; hex: string }>("/api/live/virtual/inject", { method: "POST", body: JSON.stringify(body) }),
  },
  catalog: {
    boards: () => request<PedalboardSpec[]>("/api/catalog/boards"),
    /** Upload a PDF and attach it to the profile in one step. */
    attachDocument: (id: string, file: File, title: string, kind: DocumentKind) => upload<DeviceProfile>(`/api/catalog/devices/${id}/documents`, file, { title, kind }),
    renameDocument: (id: string, docId: string, patch: { title?: string; kind?: DocumentKind; note?: string | null }) =>
      request<DeviceProfile>(`/api/catalog/devices/${id}/documents/${docId}`, { method: "PATCH", body: JSON.stringify(patch.note === null ? { ...patch, note: undefined, clear_note: true } : patch) }),
    replaceDocument: (id: string, docId: string, file: File, force = false) => upload<DeviceProfile>(`/api/catalog/devices/${id}/documents/${docId}/replace${force ? "?force=1" : ""}`, file),
    detachDocument: (id: string, docId: string, purge = false) => request<DeviceProfile>(`/api/catalog/devices/${id}/documents/${docId}${purge ? "?purge=1" : ""}`, { method: "DELETE" }),
    updateCommands: (id: string, commands: MidiCommand[]) => request<DeviceProfile>(`/api/catalog/devices/${id}/commands`, { method: "PUT", body: JSON.stringify({ commands }) }),
    commandsFromMap: (id: string) => request<{ profile: DeviceProfile; added: string[] }>(`/api/catalog/devices/${id}/commands/from-map`, { method: "POST" }),
    commandUsage: (id: string) => request<Record<string, CommandUse[]>>(`/api/catalog/devices/${id}/command-usage`),
    declareMidi: (id: string, body: { interfaces: string[]; default_channel?: number | null; note?: string | null }) =>
      request<DeviceProfile>(`/api/catalog/devices/${id}/midi-capability`, { method: "POST", body: JSON.stringify(body) }),
    list: (q?: string, category?: string) => {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (category) p.set("category", category);
      const qs = p.toString();
      return request<DeviceProfile[]>(`/api/catalog/devices${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) => request<DeviceProfile>(`/api/catalog/devices/${id}`),
    create: (p: DeviceProfile) => request<DeviceProfile>("/api/catalog/devices", { method: "POST", body: JSON.stringify(profileBody(p)) }),
    update: (p: DeviceProfile) => request<DeviceProfile>(`/api/catalog/devices/${p.id}`, { method: "PUT", body: JSON.stringify(profileBody(p)) }),
    remove: (id: string) => request<void>(`/api/catalog/devices/${id}`, { method: "DELETE" }),
    /** Replace only the jack list; 409 (code ports_in_use, with `affected` cables) unless `force`. */
    updatePorts: (id: string, ports: PortDef[], force = false) => request<DeviceProfile>(`/api/catalog/devices/${id}/ports`, { method: "PUT", body: JSON.stringify({ ports, force }) }),
    portUsage: (id: string) => request<Record<string, PortUsage[]>>(`/api/catalog/devices/${id}/port-usage`),
    importPedalPlayground: (text: string) => request<{ imported: number; skipped_existing: number; problems: string[] }>("/api/catalog/import/pedalplayground", { method: "POST", body: text }),
  },
};

/** API responses carry read-only echo fields (`unknown_attributes`, `source`, `document_files`); the server ignores them on write, but they are dropped here too. */
function profileBody(p: DeviceProfile): Omit<DeviceProfile, "unknown_attributes" | "source" | "document_files"> {
  const { unknown_attributes: _u, source: _s, document_files: _d, ...body } = p; // eslint-disable-line @typescript-eslint/no-unused-vars
  return body;
}

export function downloadText(filename: string, text: string, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function newId(prefix: string): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}
