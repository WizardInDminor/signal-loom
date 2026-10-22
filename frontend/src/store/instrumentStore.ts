"use client";

import { create } from "zustand";
import { api, ApiError } from "@/lib/api";
import type { PerformanceStatus, Readiness } from "@/lib/types";
import { useLiveStore } from "./liveStore";

/**
 * The browser's side of a performance. The backend owns every send; this store only holds which
 * texture is open, the readiness report, the controller id the backend issued on Start, and runs
 * the heartbeat that keeps the lease alive (separate from the UI's passive polling, so a frozen or
 * closed tab lets the lease expire and the backend stops on its own).
 */
interface InstrumentState {
  selectedTextureId: string | null;
  readiness: Readiness | null;
  controllerId: string | null;
  starting: boolean;
  error: string | null;
  /** Route prerequisites to acknowledge before the first Start over these routes (409 live.confirm_route). */
  pendingConfirm: { items: string[]; messages: { summary: string; explanation: string }[] } | null;
  /** Last performance status that ended on the backend's side (lease, disarm, fault), to explain it once. */
  lastEnded: PerformanceStatus | null;
  selectTexture: (id: string | null) => void;
  refreshReadiness: (rigId: string) => Promise<void>;
  start: (rigId: string, textureId: string, acknowledge?: string[]) => Promise<boolean>;
  stop: () => Promise<void>;
  pushParams: (body: { tempo_bpm?: number; macros?: Record<string, { base?: number; enabled?: boolean; depth?: number; beats_per_cycle?: number }> }) => void;
  /** Called by the poll loop with every fresh status so the heartbeat and controller id track the backend. */
  observe: (perf: PerformanceStatus | undefined) => void;
  dismissConfirm: () => void;
  clearError: () => void;
  teardown: () => void;
}

const HEARTBEAT_MS = 1500;
const PARAMS_THROTTLE_MS = 90;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let paramsTimer: ReturnType<typeof setTimeout> | null = null;
let pendingParams: { tempo_bpm?: number; macros: Record<string, { base?: number; enabled?: boolean; depth?: number; beats_per_cycle?: number }> } = { macros: {} };

function text(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.detail as { message?: string } | string | undefined;
    if (typeof d === "string") return d;
    if (d && typeof d === "object" && d.message) return d.message;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

function stopHeartbeat() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}

export const useInstrumentStore = create<InstrumentState>((set, get) => ({
  selectedTextureId: null,
  readiness: null,
  controllerId: null,
  starting: false,
  error: null,
  pendingConfirm: null,
  lastEnded: null,

  selectTexture: (id) => set({ selectedTextureId: id, readiness: null, pendingConfirm: null }),

  async refreshReadiness(rigId) {
    const id = get().selectedTextureId;
    if (!id) return;
    try {
      const readiness = await api.live.textureReadiness(rigId, id);
      if (get().selectedTextureId === id) set({ readiness });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) set({ readiness: null });
      else set({ error: text(e) });
    }
  },

  async start(rigId, textureId, acknowledge = []) {
    set({ starting: true, error: null, pendingConfirm: null, lastEnded: null });
    try {
      const r = await api.live.startPerformance(rigId, textureId, acknowledge);
      set({ controllerId: r.controller_id });
      useLiveStore.setState({ status: r.status });
      stopHeartbeat();
      heartbeat = setInterval(() => {
        const c = get().controllerId;
        if (!c) return stopHeartbeat();
        api.live.performanceHeartbeat(c).catch(() => {
          // The backend no longer recognises us (stopped, lease expired, another controller): drop the id.
          set({ controllerId: null });
          stopHeartbeat();
        });
      }, HEARTBEAT_MS);
      await get().refreshReadiness(rigId);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && (e.detail as { code?: string })?.code === "live.confirm_route") {
        const d = e.detail as { items?: string[]; messages?: { summary: string; explanation: string }[] };
        set({ pendingConfirm: { items: d.items ?? [], messages: d.messages ?? [] } });
      } else {
        set({ error: text(e) });
      }
      return false;
    } finally {
      set({ starting: false });
    }
  },

  async stop() {
    stopHeartbeat();
    if (paramsTimer) clearTimeout(paramsTimer);
    paramsTimer = null;
    pendingParams = { macros: {} };
    try {
      const status = await api.live.stopPerformance();
      useLiveStore.setState({ status });
      set({ controllerId: null, lastEnded: status.performance });
    } catch (e) {
      set({ error: text(e) });
    }
  },

  pushParams(body) {
    const c = get().controllerId;
    if (!c) return;
    if (body.tempo_bpm != null) pendingParams.tempo_bpm = body.tempo_bpm;
    for (const [k, v] of Object.entries(body.macros ?? {})) pendingParams.macros[k] = { ...(pendingParams.macros[k] ?? {}), ...v };
    if (paramsTimer) return; // newest value wins within the throttle window
    paramsTimer = setTimeout(() => {
      paramsTimer = null;
      const send = pendingParams;
      pendingParams = { macros: {} };
      const cid = get().controllerId;
      if (!cid) return;
      api.live.performanceParams(cid, send).catch((e) => set({ error: text(e) }));
    }, PARAMS_THROTTLE_MS);
  },

  observe(perf) {
    if (!perf) return;
    const { controllerId } = get();
    if (controllerId && perf.state !== "performing") {
      // Ended on the backend's side (lease, disarm, unplug, fault, another client's Stop).
      stopHeartbeat();
      set({ controllerId: null, lastEnded: perf });
    }
  },

  dismissConfirm: () => set({ pendingConfirm: null }),
  clearError: () => set({ error: null }),
  teardown: () => {
    stopHeartbeat();
    if (paramsTimer) clearTimeout(paramsTimer);
    paramsTimer = null;
    set({ controllerId: null, readiness: null, pendingConfirm: null });
  },
}));
