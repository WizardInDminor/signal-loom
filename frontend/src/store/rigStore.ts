"use client";

import { create } from "zustand";
import { api, ApiError, newId } from "@/lib/api";
import type { Analysis, Connection, DeviceInstance, DeviceProfile, PortDirection, Rig, Scene, SignalKind, Surface } from "@/lib/types";
import { surfaceOf } from "@/lib/mounting";

interface RigState {
  rig: Rig | null;
  analysis: Analysis | null;
  profiles: Record<string, DeviceProfile>;
  catalog: DeviceProfile[];
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  /** Highest revision the server has confirmed for the loaded rig. */
  savedRevision: number;
  error: string | null;
  /** Set when the server rejected our revision: another tab/session changed the rig. */
  conflict: boolean;
  selectedInstanceId: string | null;
  selectedSceneId: string | null;
  /** Undo/redo over whole-document snapshots (bounded). */
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Pending port-to-port cable started on the board (drag-to-connect). */
  pendingCable: { instance_id: string; port_id: string; kind: SignalKind; direction: PortDirection } | null;
  setPendingCable: (p: RigState["pendingCable"]) => void;
  load: (id: string) => Promise<void>;
  /** Set when a rig switch was refused because the current document could not be saved. */
  blockedSwitch: { targetId: string; fromName: string; reason: string } | null;
  retrySwitch: () => Promise<void>;
  discardAndSwitch: () => Promise<void>;
  /** Adopt a rig document the server already stored (e.g. after a server-side import) without a loading cycle. */
  replaceRig: (rig: Rig) => void;
  refreshCatalog: () => Promise<void>;
  /** Re-run the analysis of the current document (e.g. after a profile changed) without editing it. */
  reanalyze: () => Promise<void>;
  update: (fn: (rig: Rig) => void) => void;
  /** Persist every pending edit, in order. Resolves true once the latest revision is saved. */
  ensureSaved: () => Promise<boolean>;
  flush: () => void;
  select: (id: string | null) => void;
  selectScene: (id: string | null) => void;
  /** Place a device; `surface` defaults by category (instrument/amp off-board, otherwise top). */
  addInstance: (profile: DeviceProfile, surface?: Surface) => string;
  removeInstance: (id: string) => void;
  addConnection: (c: Omit<Connection, "id" | "intentional"> & { intentional?: boolean }) => string;
  removeConnection: (id: string) => void;
  addScene: (name: string) => string;
  duplicateScene: (id: string) => string | null;
  removeScene: (id: string) => void;
  /** Assign a scene to an MC8 bank/position (creating the bank if needed); position "" clears it. */
  assignSceneToSwitch: (sceneId: string, bank: number, position: string) => void;
  clearError: () => void;
}

const SAVE_DEBOUNCE_MS = 500;
const HISTORY_LIMIT = 100;
let undoStack: Rig[] = [];
let redoStack: Rig[] = [];
const ANALYZE_DEBOUNCE_MS = 250;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let analyzeTimer: ReturnType<typeof setTimeout> | null = null;
let analyzeSeq = 0;
// Single writer: at most one PUT in flight; a newer revision waits for it and is sent after.
let writer: Promise<boolean> | null = null;

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (typeof e.detail === "string") return e.detail;
    if (Array.isArray(e.detail)) return e.detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).join(".")}: ${d.msg}`).join("; ");
    if (e.detail && typeof e.detail === "object" && "message" in e.detail) return String((e.detail as { message: unknown }).message);
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

function isStale(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409 && !!e.detail && typeof e.detail === "object" && (e.detail as { code?: string }).code === "stale_revision";
}

export const useRigStore = create<RigState>((set, get) => ({
  rig: null,
  analysis: null,
  profiles: {},
  catalog: [],
  loading: false,
  saving: false,
  dirty: false,
  savedRevision: 0,
  error: null,
  conflict: false,
  selectedInstanceId: null,
  selectedSceneId: null,
  canUndo: false,
  canRedo: false,
  pendingCable: null,
  setPendingCable: (p) => set({ pendingCable: p }),
  blockedSwitch: null,

  async retrySwitch() {
    const b = get().blockedSwitch;
    if (!b) return;
    set({ error: null, conflict: false });
    const ok = await get().ensureSaved();
    if (!ok) {
      set({ blockedSwitch: { ...b, reason: get().error ?? b.reason } });
      return;
    }
    set({ blockedSwitch: null });
    await get().load(b.targetId);
  },

  async discardAndSwitch() {
    const b = get().blockedSwitch;
    if (!b) return;
    // Explicit user choice: drop the unsaved edits of the current document.
    if (saveTimer) clearTimeout(saveTimer);
    set({ dirty: false, error: null, conflict: false, blockedSwitch: null });
    await get().load(b.targetId);
  },

  undo() {
    const current = get().rig;
    const prev = undoStack.pop();
    if (!current || !prev) return;
    redoStack.push(current);
    applySnapshot(prev);
  },

  redo() {
    const current = get().rig;
    const next = redoStack.pop();
    if (!current || !next) return;
    undoStack.push(current);
    applySnapshot(next);
  },

  async load(id) {
    // Never drop pending edits of the previous rig when switching: if they cannot be saved,
    // keep the current document in memory and let the user retry or discard explicitly.
    const current = get().rig;
    if (current && get().dirty && current.id !== id) {
      const ok = await get().ensureSaved();
      if (!ok) {
        set({
          loading: false,
          blockedSwitch: {
            targetId: id,
            fromName: current.name,
            reason: get().error ?? "The latest edits could not be saved.",
          },
        });
        return;
      }
    }
    set({ blockedSwitch: null });
    undoStack = [];
    redoStack = [];
    set({ loading: true, error: null, conflict: false, rig: null, analysis: null, selectedInstanceId: null, selectedSceneId: null, canUndo: false, canRedo: false, pendingCable: null });
    try {
      const [rig, analysis, catalog] = await Promise.all([api.rigs.get(id), api.rigs.analysis(id), api.catalog.list()]);
      const profiles: Record<string, DeviceProfile> = {};
      for (const p of catalog) profiles[p.id] = p;
      set({ rig, analysis, catalog, profiles, loading: false, dirty: false, savedRevision: rig.revision, selectedSceneId: rig.scenes[0]?.id ?? null });
    } catch (e) {
      set({ loading: false, error: errorText(e) });
    }
  },

  replaceRig(rig) {
    undoStack.push(get().rig ?? rig);
    redoStack = [];
    set({ rig, dirty: false, savedRevision: rig.revision, canUndo: true, canRedo: false });
    const seq = ++analyzeSeq;
    void api.rigs.analyzeDocument(rig).then((analysis) => { if (seq === analyzeSeq) set({ analysis }); }).catch((e) => set({ error: errorText(e) }));
  },

  async refreshCatalog() {
    const catalog = await api.catalog.list();
    const profiles: Record<string, DeviceProfile> = {};
    for (const p of catalog) profiles[p.id] = p;
    set({ catalog, profiles });
  },

  async reanalyze() {
    const rig = get().rig;
    if (!rig) return;
    const seq = ++analyzeSeq;
    try {
      const analysis = await api.rigs.analyzeDocument(rig);
      if (seq === analyzeSeq) set({ analysis });
    } catch (e) {
      set({ error: errorText(e) });
    }
  },

  update(fn) {
    const current = get().rig;
    if (!current || get().conflict) return;
    const next: Rig = structuredClone(current);
    fn(next);
    next.revision = current.revision + 1; // monotonic: the server refuses anything older
    undoStack.push(current);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
    set({ rig: next, dirty: true, canUndo: true, canRedo: false });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().ensureSaved(), SAVE_DEBOUNCE_MS);
    if (analyzeTimer) clearTimeout(analyzeTimer);
    const seq = ++analyzeSeq;
    analyzeTimer = setTimeout(async () => {
      try {
        const analysis = await api.rigs.analyzeDocument(next);
        if (seq === analyzeSeq) set({ analysis });
      } catch (e) {
        set({ error: errorText(e) });
      }
    }, ANALYZE_DEBOUNCE_MS);
  },

  ensureSaved() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (writer) return writer; // the running writer drains every revision that exists when it loops
    writer = (async () => {
      let ok = true;
      try {
        // Drain: keep sending the newest document until the server has confirmed it.
        for (;;) {
          const snapshot = get().rig;
          if (!snapshot || snapshot.revision <= get().savedRevision) break;
          set({ saving: true });
          try {
            const saved = await api.rigs.put(snapshot);
            set((s) => ({
              savedRevision: Math.max(s.savedRevision, saved.revision),
              dirty: (s.rig?.revision ?? 0) > Math.max(s.savedRevision, saved.revision),
              // Adopt the server timestamp only if nothing newer was edited meanwhile.
              rig: s.rig && s.rig.revision === saved.revision ? { ...s.rig, updated_at: saved.updated_at } : s.rig,
            }));
          } catch (e) {
            const latest = get().rig;
            if (isStale(e) && latest && latest.revision > snapshot.revision) continue; // superseded locally; send the newer one
            ok = false;
            set({
              error: isStale(e)
                ? "This rig was changed elsewhere (another tab or session). Reload the page to continue; your unsaved edits here are not applied."
                : `Save failed: ${errorText(e)}`,
              conflict: isStale(e),
            });
            break;
          }
        }
      } finally {
        set({ saving: false });
        writer = null;
      }
      return ok;
    })();
    return writer;
  },

  flush() {
    // Page unload: send the newest document with a keepalive request. The server's revision
    // rule guarantees an older in-flight PUT cannot overwrite it.
    if (saveTimer) clearTimeout(saveTimer);
    const rig = get().rig;
    if (!rig || !get().dirty || get().conflict) return;
    void fetch(`/api/rigs/${rig.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rig), keepalive: true });
  },

  select: (id) => set({ selectedInstanceId: id }),
  selectScene: (id) => set({ selectedSceneId: id }),

  addInstance(profile, surface) {
    const id = newId("inst");
    const rig = get().rig;
    const external = ["instrument", "amp"].includes(profile.category);
    const where: Surface = external ? "off_board" : (surface ?? "top");
    const n = rig?.instances.filter((i) => surfaceOf(i) === where).length ?? 0;
    get().update((r) => {
      r.instances.push({
        id,
        profile_id: profile.id,
        label: profile.model,
        x_mm: 20 + (n % 4) * 110,
        y_mm: 20 + Math.floor(n / 4) * 130,
        rotation: 0,
        intentional_overlap: false,
        off_board: where === "off_board",
        surface: where,
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

  duplicateScene(id) {
    const src = get().rig?.scenes.find((s) => s.id === id);
    if (!src) return null;
    const newId_ = newId("scene");
    get().update((r) => {
      const copy: Scene = structuredClone(src);
      copy.id = newId_;
      copy.name = `${src.name} (copy)`;
      copy.order = r.scenes.length;
      r.scenes.push(copy);
    });
    set({ selectedSceneId: newId_ });
    return newId_;
  },

  assignSceneToSwitch(sceneId, bank, position) {
    get().update((r) => {
      for (const b of r.controllers.mc8.banks) for (const p of b.presets) if (p.scene_id === sceneId) p.scene_id = null;
      for (const b of r.controllers.mc8.banks) b.presets = b.presets.filter((p) => p.scene_id || p.short_name);
      if (!position) return;
      let b = r.controllers.mc8.banks.find((x) => x.number === bank);
      if (!b) {
        b = { number: bank, name: `Bank ${bank}`, presets: [] };
        r.controllers.mc8.banks.push(b);
      }
      const scene = r.scenes.find((s) => s.id === sceneId);
      let p = b.presets.find((x) => x.position === position);
      if (!p) {
        p = { position, short_name: "", toggle_mode: false, scene_id: null, action: "press", extra_messages: [] };
        b.presets.push(p);
      }
      p.scene_id = sceneId;
      if (!p.short_name) p.short_name = (scene?.name ?? "").slice(0, 10);
    });
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

/** Replace the document with a history snapshot, bumping the revision so the server accepts it. */
function applySnapshot(snapshot: Rig) {
  const state = useRigStore.getState();
  const current = state.rig!;
  const next = structuredClone(snapshot);
  next.revision = current.revision + 1;
  useRigStore.setState({ rig: next, dirty: true, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void useRigStore.getState().ensureSaved(), SAVE_DEBOUNCE_MS);
  if (analyzeTimer) clearTimeout(analyzeTimer);
  const seq = ++analyzeSeq;
  analyzeTimer = setTimeout(async () => {
    try {
      const analysis = await api.rigs.analyzeDocument(next);
      if (seq === analyzeSeq) useRigStore.setState({ analysis });
    } catch (e) {
      useRigStore.setState({ error: errorText(e) });
    }
  }, ANALYZE_DEBOUNCE_MS);
}

export function instanceLabel(rig: Rig | null, id: string): string {
  return rig?.instances.find((i) => i.id === id)?.label ?? id;
}

export function effectivePorts(analysis: Analysis | null, inst: DeviceInstance) {
  return analysis?.instances[inst.id]?.effective_ports ?? [];
}
