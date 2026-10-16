import type { Analysis, DeviceProfile, ExportStatus, Rig, RigSummary } from "./types";

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : (detail as { message?: string })?.message ?? `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, ...init });
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
  if (res.status === 204) return undefined as T;
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
    exportProject: (id: string) => request<unknown>(`/api/rigs/${id}/export`),
    importProject: (text: string, name?: string) =>
      request<{ rig: Rig; warnings: string[]; imported_profiles: string[] }>(`/api/rigs/import${name ? `?name=${encodeURIComponent(name)}` : ""}`, { method: "POST", body: text }),
    exportStatus: (id: string) => request<ExportStatus>(`/api/rigs/${id}/exports/status`),
    mc8Bank: (id: string, bank: number) => request<{ filename: string; evidence_level: string; warning: string; self_check: { ok: boolean; problems: string[]; hash_matches: boolean | null }; dump: unknown }>(`/api/rigs/${id}/exports/mc8-bank/${bank}`),
    inspectMc8: (text: string) => request<{ ok: boolean; problems: string[]; dump_type: string | null; device_model: number | null; hash_matches: boolean | null; banks: { bank_number: number | null; bank_name: string; used_presets: { position: string; short_name: string; message_count: number; types: string[] }[] }[] }>("/api/rigs/inspect/mc8-backup", { method: "POST", body: text }),
    inspectMl10x: (text: string) => request<{ ok: boolean; problems: string[]; midi_channel: number | null; device_id: number | null; connectors: { id: number; name: string; short_name: string; trails: boolean }[]; presets: { bank: number; number: number; global_number: number; name: string; advanced_mode: boolean }[]; settings: Record<string, unknown> }>("/api/rigs/inspect/ml10x-backup", { method: "POST", body: text }),
  },
  catalog: {
    list: (q?: string, category?: string) => {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (category) p.set("category", category);
      const qs = p.toString();
      return request<DeviceProfile[]>(`/api/catalog/devices${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) => request<DeviceProfile>(`/api/catalog/devices/${id}`),
    create: (p: DeviceProfile) => request<DeviceProfile>("/api/catalog/devices", { method: "POST", body: JSON.stringify(p) }),
    update: (p: DeviceProfile) => request<DeviceProfile>(`/api/catalog/devices/${p.id}`, { method: "PUT", body: JSON.stringify(p) }),
    remove: (id: string) => request<void>(`/api/catalog/devices/${id}`, { method: "DELETE" }),
    importPedalPlayground: (text: string) => request<{ imported: number; skipped_existing: number; problems: string[] }>("/api/catalog/import/pedalplayground", { method: "POST", body: text }),
  },
};

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
