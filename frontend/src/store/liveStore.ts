"use client";

import { create } from "zustand";
import { api, ApiError } from "@/lib/api";
import type { DryRun, Follower, LiveBindings, LiveCoverage, LiveEndpoint, LiveEvents, LiveLogEntry, LivePanels, LiveStatus, ObservedMessage, TransportMode } from "@/lib/types";

/**
 * Client view of the backend's live-MIDI state. The browser never touches MIDI: every action here
 * is an HTTP call, and the backend decides. Polling keeps the send log, observations and simulated
 * pedal state current while a rig page is open; the ARMED badge in the rig header reads this store.
 */
interface LiveState {
  rigId: string | null;
  status: LiveStatus | null;
  endpoints: LiveEndpoint[];
  bindings: LiveBindings | null;
  coverage: LiveCoverage | null;
  panels: LivePanels | null;
  follower: Follower | null;
  log: LiveLogEntry[];
  observed: ObservedMessage[];
  events: LiveEvents | null;
  dryRun: DryRun | null;
  lastWarnings: string[];
  error: string | null;
  busy: boolean;
  /** Pending confirmation for messages the backend refused to send without it. */
  pendingConfirm: {
    kind: "audition" | "send";
    /** "toggle": state-dependent messages; "route": hardware prerequisites / unverified hops to acknowledge for this session. */
    reason: "toggle" | "route";
    items: string[];
    messages: { summary: string; explanation: string }[];
    retry: () => Promise<void>;
  } | null;

  attach: (rigId: string) => Promise<void>;
  detach: () => void;
  refreshAll: () => Promise<void>;
  refreshStatic: () => Promise<void>;
  poll: () => Promise<void>;
  setMode: (mode: TransportMode) => Promise<void>;
  saveBindings: (b: LiveBindings) => Promise<void>;
  suggestBindings: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshEndpoints: () => Promise<void>;
  arm: (phrase: string) => Promise<boolean>;
  disarm: () => Promise<void>;
  stop: () => Promise<void>;
  release: (endpointId: string) => Promise<void>;
  reacquire: (endpointId: string) => Promise<void>;
  runDryRun: (sceneId: string) => Promise<void>;
  audition: (sceneId: string, delayMs: number | null, confirm?: boolean, acknowledge?: string[]) => Promise<void>;
  send: (body: { instance_id: string; type: "pc" | "cc"; number: number; value?: number | null; coalesce?: boolean; label?: string | null; deterministic?: boolean | null }, confirm?: boolean, acknowledge?: string[]) => Promise<void>;
  inject: (endpointId: string, type: "pc" | "cc", channel: number, number: number, value?: number | null) => Promise<void>;
  clearError: () => void;
  dismissConfirm: () => void;
}

const LOG_LIMIT = 300;
let timer: ReturnType<typeof setInterval> | null = null;
let polling = false;

function text(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.detail as { message?: string; code?: string } | string | undefined;
    if (typeof d === "string") return d;
    if (d && typeof d === "object" && d.message) return d.message;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

function code(e: unknown): string | null {
  if (e instanceof ApiError && e.detail && typeof e.detail === "object") return (e.detail as { code?: string }).code ?? null;
  return null;
}

export const useLiveStore = create<LiveState>((set, get) => ({
  rigId: null,
  status: null,
  endpoints: [],
  bindings: null,
  coverage: null,
  panels: null,
  follower: null,
  log: [],
  observed: [],
  events: null,
  dryRun: null,
  lastWarnings: [],
  error: null,
  busy: false,
  pendingConfirm: null,

  async attach(rigId) {
    if (get().rigId !== rigId) set({ rigId, log: [], observed: [], dryRun: null, coverage: null, panels: null, follower: null, bindings: null, lastWarnings: [], pendingConfirm: null });
    await get().refreshAll();
    if (timer) clearInterval(timer);
    timer = setInterval(() => void get().poll(), 700);
  },

  detach() {
    if (timer) clearInterval(timer);
    timer = null;
  },

  async refreshStatic() {
    const rigId = get().rigId;
    if (!rigId) return;
    try {
      const [status, endpoints, bindings, coverage] = await Promise.all([api.live.status(), api.live.endpoints(rigId), api.live.bindings(rigId), api.live.coverage(rigId)]);
      set({ status, endpoints, bindings, coverage });
    } catch (e) {
      set({ error: text(e) });
    }
  },

  async refreshAll() {
    const rigId = get().rigId;
    if (!rigId) return;
    await get().refreshStatic();
    try {
      const [panels, follower, events] = await Promise.all([api.live.panels(rigId), api.live.follower(rigId), api.live.events(0, 0, rigId)]);
      set({ panels, follower, events, status: events.status, log: events.log.slice(-LOG_LIMIT), observed: events.observed.slice(-LOG_LIMIT) });
    } catch (e) {
      set({ error: text(e) });
    }
  },

  async poll() {
    const rigId = get().rigId;
    if (!rigId || polling) return;
    polling = true;
    try {
      const sinceLog = get().log.at(-1)?.seq ?? 0;
      const sinceObs = get().observed.at(-1)?.seq ?? 0;
      const events = await api.live.events(sinceLog, sinceObs, rigId);
      const changed = events.log.length > 0 || events.observed.length > 0;
      set((s) => ({
        events,
        status: events.status,
        log: [...s.log, ...events.log].slice(-LOG_LIMIT),
        observed: [...s.observed, ...events.observed].slice(-LOG_LIMIT),
      }));
      if (changed || events.status.queue_length > 0) {
        const [panels, follower] = await Promise.all([api.live.panels(rigId), api.live.follower(rigId)]);
        set({ panels, follower });
      }
    } catch {
      /* transient: the next tick retries */
    } finally {
      polling = false;
    }
  },

  async setMode(mode) {
    set({ busy: true, error: null });
    try {
      set({ status: await api.live.setMode(mode) });
      await get().refreshAll();
    } catch (e) {
      set({ error: text(e) });
    } finally {
      set({ busy: false });
    }
  },

  async saveBindings(b) {
    const rigId = get().rigId;
    if (!rigId) return;
    set({ busy: true, error: null });
    try {
      set({ bindings: await api.live.saveBindings(rigId, b) });
      await get().refreshAll();
    } catch (e) {
      set({ error: text(e) });
    } finally {
      set({ busy: false });
    }
  },

  async suggestBindings() {
    const rigId = get().rigId;
    if (!rigId) return;
    set({ busy: true, error: null });
    try {
      set({ bindings: await api.live.suggestBindings(rigId) });
      await get().refreshAll();
    } catch (e) {
      set({ error: text(e) });
    } finally {
      set({ busy: false });
    }
  },

  async connect() {
    const rigId = get().rigId;
    if (!rigId) return;
    set({ busy: true, error: null });
    try {
      set({ status: await api.live.connect(rigId) });
      await get().refreshAll();
    } catch (e) {
      set({ error: text(e) });
    } finally {
      set({ busy: false });
    }
  },

  async disconnect() {
    set({ busy: true, error: null });
    try {
      set({ status: await api.live.disconnect() });
      await get().refreshAll();
    } catch (e) {
      set({ error: text(e) });
    } finally {
      set({ busy: false });
    }
  },

  async refreshEndpoints() {
    try {
      set({ status: await api.live.refresh() });
      await get().refreshAll();
    } catch (e) {
      set({ error: text(e) });
    }
  },

  async arm(phrase) {
    set({ error: null });
    try {
      set({ status: await api.live.arm(phrase) });
      return true;
    } catch (e) {
      set({ error: text(e) });
      return false;
    }
  },

  async disarm() {
    try {
      set({ status: await api.live.disarm() });
      await get().poll();
    } catch (e) {
      set({ error: text(e) });
    }
  },

  async stop() {
    try {
      const r = await api.live.stop();
      set({ status: r });
      await get().poll();
    } catch (e) {
      set({ error: text(e) });
    }
  },

  async release(endpointId) {
    try {
      set({ status: await api.live.release(endpointId) });
      await get().refreshAll();
    } catch (e) {
      set({ error: text(e) });
    }
  },

  async reacquire(endpointId) {
    try {
      set({ status: await api.live.reacquire(endpointId) });
      await get().refreshAll();
    } catch (e) {
      set({ error: text(e) });
    }
  },

  async runDryRun(sceneId) {
    const rigId = get().rigId;
    if (!rigId) return;
    set({ error: null });
    try {
      set({ dryRun: await api.live.dryRun(rigId, sceneId) });
    } catch (e) {
      set({ error: text(e) });
    }
  },

  async audition(sceneId, delayMs, confirm = false, acknowledge = []) {
    const rigId = get().rigId;
    if (!rigId) return;
    set({ error: null, pendingConfirm: null });
    try {
      const r = await api.live.audition(rigId, sceneId, { delay_ms: delayMs, confirm_nondeterministic: confirm, acknowledge });
      set({ lastWarnings: r.warnings });
      await get().poll();
    } catch (e) {
      const c = code(e);
      if (c === "live.confirm_route" || c === "live.confirm_nondeterministic") {
        const d = (e as ApiError).detail as { items?: string[]; messages?: { summary: string; explanation: string }[] };
        const items = d.items ?? [];
        set({
          pendingConfirm: {
            kind: "audition",
            reason: c === "live.confirm_route" ? "route" : "toggle",
            items,
            messages: d.messages ?? [],
            // Acknowledging a route keeps the toggle confirmation separate: the second question may follow.
            retry: () => (c === "live.confirm_route" ? get().audition(sceneId, delayMs, confirm, [...acknowledge, ...items]) : get().audition(sceneId, delayMs, true, acknowledge)),
          },
        });
        return;
      }
      set({ error: text(e) });
    }
  },

  async send(body, confirm = false, acknowledge = []) {
    const rigId = get().rigId;
    if (!rigId) return;
    set({ error: null });
    try {
      const r = await api.live.send(rigId, { ...body, confirm_nondeterministic: confirm, acknowledge });
      if (r.warnings.length) set({ lastWarnings: r.warnings });
    } catch (e) {
      const c = code(e);
      if (c === "live.confirm_route" || c === "live.confirm_nondeterministic") {
        const d = (e as ApiError).detail as { items?: string[]; messages?: { summary: string; explanation: string }[] };
        const items = d.items ?? [];
        set({
          pendingConfirm: {
            kind: "send",
            reason: c === "live.confirm_route" ? "route" : "toggle",
            items,
            messages: d.messages ?? [],
            retry: () => (c === "live.confirm_route" ? get().send(body, confirm, [...acknowledge, ...items]) : get().send(body, true, acknowledge)),
          },
        });
        return;
      }
      set({ error: text(e) });
    }
  },

  async inject(endpointId, type, channel, number, value) {
    set({ error: null });
    try {
      await api.live.inject({ endpoint_id: endpointId, type, channel, number, value });
      await get().poll();
      const rigId = get().rigId;
      if (rigId) set({ follower: await api.live.follower(rigId) });
    } catch (e) {
      set({ error: text(e) });
    }
  },

  clearError: () => set({ error: null }),
  dismissConfirm: () => set({ pendingConfirm: null }),
}));
