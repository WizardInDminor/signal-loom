"use client";

import { create } from "zustand";
import { api, ApiError, newId } from "@/lib/api";
import type { Analysis, Connection, DeviceInstance, DeviceProfile, Rig, Scene } from "@/lib/types";

interface RigState {
  rig: Rig | null;
  analysis: Analysis | null;
  profiles: Record<string, DeviceProfile>;
  catalog: DeviceProfile[];
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  selectedInstanceId: string | null;
  selectedSceneId: string | null;
  load: (id: string) => Promise<void>;
  refreshCatalog: () => Promise<void>;
  update: (fn: (rig: Rig) => void) => void;
  saveNow: () => Promise<void>;
  flush: () => void;
  select: (id: string | null) => void;
  selectScene: (id: string | null) => void;
  addInstance: (profile: DeviceProfile) => string;
  removeInstance: (id: string) => void;
  addConnection: (c: Omit<Connection, "id" | "intentional"> & { intentional?: boolean }) => string;
  removeConnection: (id: string) => void;
  addScene: (name: string) => string;
  removeScene: (id: string) => void;
  clearError: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let analyzeTimer: ReturnType<typeof setTimeout> | null = null;
let analyzeSeq = 0;

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (typeof e.detail === "string") return e.detail;
    if (Array.isArray(e.detail)) return e.detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).join(".")}: ${d.msg}`).join("; ");
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export const useRigStore = create<RigState>((set, get) => ({
  rig: null,
  analysis: null,
  profiles: {},
  catalog: [],
  loading: false,
  saving: false,
  dirty: false,
  error: null,
  selectedInstanceId: null,
  selectedSceneId: null,

  async load(id) {
    set({ loading: true, error: null, rig: null, analysis: null, selectedInstanceId: null, selectedSceneId: null });
    try {
      const [rig, analysis, catalog] = await Promise.all([api.rigs.get(id), api.rigs.analysis(id), api.catalog.list()]);
      const profiles: Record<string, DeviceProfile> = {};
      for (const p of catalog) profiles[p.id] = p;
      set({ rig, analysis, catalog, profiles, loading: false, dirty: false, selectedSceneId: rig.scenes[0]?.id ?? null });
    } catch (e) {
      set({ loading: false, error: errorText(e) });
    }
  },

  async refreshCatalog() {
    const catalog = await api.catalog.list();
    const profiles: Record<string, DeviceProfile> = {};
    for (const p of catalog) profiles[p.id] = p;
    set({ catalog, profiles });
  },

  update(fn) {
    const current = get().rig;
    if (!current) return;
    const next: Rig = structuredClone(current);
    fn(next);
    set({ rig: next, dirty: true });
    // Debounced persistence of the single underlying model, then live re-analysis.
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().saveNow(), 500);
    if (analyzeTimer) clearTimeout(analyzeTimer);
    const seq = ++analyzeSeq;
    analyzeTimer = setTimeout(async () => {
      try {
        const analysis = await api.rigs.analyzeDocument(next);
        if (seq === analyzeSeq) set({ analysis });
      } catch (e) {
        set({ error: errorText(e) });
      }
    }, 250);
  },

  async saveNow() {
    const rig = get().rig;
    if (!rig) return;
    set({ saving: true });
    try {
      const saved = await api.rigs.put(rig);
      // Keep local edits made while the request was in flight; only adopt server timestamps.
      set((s) => ({ saving: false, dirty: s.rig !== rig ? s.dirty : false, rig: s.rig ? { ...s.rig, updated_at: saved.updated_at } : saved }));
    } catch (e) {
      set({ saving: false, error: `Save failed: ${errorText(e)}` });
    }
  },

  flush() {
    // Called on page unload: push the pending document with a keepalive request.
    if (saveTimer) clearTimeout(saveTimer);
    const rig = get().rig;
    if (!rig || !get().dirty) return;
    void fetch(`/api/rigs/${rig.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rig), keepalive: true });
  },

  select: (id) => set({ selectedInstanceId: id }),
  selectScene: (id) => set({ selectedSceneId: id }),

  addInstance(profile) {
    const id = newId("inst");
    const rig = get().rig;
    const n = rig?.instances.length ?? 0;
    get().update((r) => {
      r.instances.push({
        id,
        profile_id: profile.id,
        label: profile.model,
        x_mm: 20 + (n % 4) * 110,
        y_mm: 20 + Math.floor(n / 4) * 130,
        rotation: 0,
        intentional_overlap: false,
        off_board: ["instrument", "amp"].includes(profile.category),
        midi_channel: profile.midi.default_channel ?? null,
        port_overrides: [],
        removed_port_ids: [],
      });
    });
    set({ selectedInstanceId: id });
    return id;
  },

  removeInstance(id) {
    get().update((r) => {
      r.instances = r.instances.filter((i) => i.id !== id);
      r.connections = r.connections.filter((c) => c.source.instance_id !== id && c.target.instance_id !== id);
      for (const s of r.scenes) s.device_states = s.device_states.filter((d) => d.instance_id !== id);
      if (r.controllers.mc8.instance_id === id) r.controllers.mc8.instance_id = null;
      if (r.controllers.ml10x.instance_id === id) r.controllers.ml10x.instance_id = null;
    });
    if (get().selectedInstanceId === id) set({ selectedInstanceId: null });
  },

  addConnection(c) {
    const id = newId("conn");
    get().update((r) => {
      r.connections.push({ id, intentional: false, ...c });
    });
    return id;
  },

  removeConnection(id) {
    get().update((r) => {
      r.connections = r.connections.filter((c) => c.id !== id);
    });
  },

  addScene(name) {
    const id = newId("scene");
    get().update((r) => {
      const scene: Scene = { id, name, order: r.scenes.length, ml10x: { preset_number: null, loop_states: {} }, device_states: [], manual_steps: [] };
      r.scenes.push(scene);
    });
    set({ selectedSceneId: id });
    return id;
  },

  removeScene(id) {
    get().update((r) => {
      r.scenes = r.scenes.filter((s) => s.id !== id);
      for (const b of r.controllers.mc8.banks) for (const p of b.presets) if (p.scene_id === id) p.scene_id = null;
    });
    if (get().selectedSceneId === id) set({ selectedSceneId: get().rig?.scenes[0]?.id ?? null });
  },

  clearError: () => set({ error: null }),
}));

export function instanceLabel(rig: Rig | null, id: string): string {
  return rig?.instances.find((i) => i.id === id)?.label ?? id;
}

export function effectivePorts(analysis: Analysis | null, inst: DeviceInstance) {
  return analysis?.instances[inst.id]?.effective_ports ?? [];
}
