"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type PortUsage } from "@/lib/api";
import type { AssetRecord, DeviceImage, DeviceProfile, Edge, Evidence, PortDef } from "@/lib/types";
import { CONNECTORS, MIDI_TRS_TYPES } from "@/lib/types";
import { Badge, Button, EvidenceBadge, KIND_COLOR } from "@/components/ui/basics";
import {
  EDGE_LABEL,
  JACK_PRESETS,
  JACK_TEMPLATES,
  applyPreset,
  enclosureToImage,
  frameFromImage,
  imageToEnclosure,
  markerPoint,
  portFromPreset,
  portsFromTemplate,
  positionOnEdge,
  presetOf,
  round4,
  suggestPlacement,
  wiringPoint,
  type MappingFrame,
} from "@/lib/jackMapping";

const MAX_W = 760;
/** CSS px of dark margin kept around the photograph in the mapping viewport at every zoom. */
const FRAME_PAD = 36;
const EDGES: { edge: Edge; glyph: string }[] = [
  { edge: "top", glyph: "▲" },
  { edge: "right", glyph: "▶" },
  { edge: "bottom", glyph: "▼" },
  { edge: "left", glyph: "◀" },
  { edge: "top_face", glyph: "◎" },
];

type Conflict = { message: string; affected: PortUsage[] };
/** What a cable relies on about its jack; the server refuses to change these on a used jack until confirmed. */
const SEMANTIC_FIELDS = ["kind", "direction", "connector", "audio_channel", "trs_role", "midi_trs_type", "pair_group", "role"] as const;

/**
 * Configure Jacks: point at a connector in the photograph, say what it is, and get a wired
 * port. The photo is shown whole (plugs often sit outside the enclosure crop), the crop
 * boundary is drawn, and every marker shows a thin lead to the point on the enclosure where
 * the wiring model will start the cable (edge + position). Markers are annotations; the lead
 * is the wiring fact, and the user can pin a different edge when the suggestion is wrong.
 */
export function JackMapper({ profileId, title, ports, image, widthMm, depthMm, footprintEvidence, onSaved, onClose }: {
  profileId: string;
  title: string;
  ports: PortDef[];
  image: DeviceImage;
  widthMm: number | null;
  depthMm: number | null;
  footprintEvidence?: Evidence;
  onSaved: (profile: DeviceProfile) => void | Promise<void>;
  onClose: () => void;
}) {
  const [asset, setAsset] = useState<AssetRecord | null>(null);
  const [usage, setUsage] = useState<Record<string, PortUsage[]>>({});
  const [draft, setDraft] = useState<PortDef[]>(() => structuredClone(ports));
  const [history, setHistory] = useState<PortDef[][]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [quick, setQuick] = useState<string>("audio_in");
  const [mode, setMode] = useState<"add" | "select">("add");
  const [sticky, setSticky] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const dragStart = useRef<PortDef[] | null>(null); // the jacks as they were when the drag began
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [more, setMore] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [renderW, setRenderW] = useState(600);
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(ports);

  useEffect(() => {
    let cancelled = false;
    api.assets.meta(image.asset_id).then((m) => { if (!cancelled) setAsset(m); }).catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : String(e)); });
    api.catalog.portUsage(profileId).then((u) => { if (!cancelled) setUsage(u); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [image.asset_id, profileId]);
  useEffect(() => {
    const el = frameRef.current;
    const box = scrollRef.current;
    if (!el || !box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const w = el.getBoundingClientRect().width;
      if (w) setRenderW(w);
      setViewport({ w: box.clientWidth, h: box.clientHeight });
    });
    ro.observe(el);
    ro.observe(box);
    return () => ro.disconnect();
  }, [asset]);
  useEffect(() => { panelRef.current?.focus(); }, []);

  const frame: MappingFrame | null = useMemo(() => (asset ? frameFromImage(image, asset.width, asset.height, widthMm, depthMm) : null), [asset, image, widthMm, depthMm]);
  const dims = !!(widthMm && depthMm);

  // Drawing space (viewBox units) and finger-sized markers whatever the rendered scale.
  const scale = asset ? Math.min(MAX_W / asset.width, 1) : 1;
  const dw = asset ? Math.round(asset.width * scale) : 1;
  const dh = asset ? Math.round(asset.height * scale) : 1;
  const px = (n: number) => n * (dw / Math.max(1, renderW)); // n screen px → viewBox units
  // At zoom 1 the whole photograph fits the visible area (plugs outside the crop included) with
  // breathing room on every side, so markers and labels on a top-mounted row are not pressed
  // against the viewport edge; zoom enlarges from there and the area scrolls. A small photo is
  // scaled up to the area: this is an annotation surface, not a print.
  const fitW = asset && viewport ? Math.max(120, Math.min(viewport.w - 2 * FRAME_PAD, (viewport.h - 2 * FRAME_PAD) * (asset.width / asset.height))) : dw;
  const frameW = Math.round(fitW * zoom);

  const commit = useCallback((next: PortDef[] | ((d: PortDef[]) => PortDef[])) => {
    setDraft((d) => {
      const n = typeof next === "function" ? next(d) : next;
      setHistory((h) => [...h.slice(-49), d]);
      return n;
    });
  }, []);
  const undo = () => {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setDraft(prev);
      return h.slice(0, -1);
    });
  };

  const toNorm = (e: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: Math.min(1, Math.max(0, p.x / dw)), y: Math.min(1, Math.max(0, p.y / dh)) };
  };

  /** Put a port where the user pointed: anchor on the photo plus a suggested (or pinned) wiring edge. */
  const placeAt = (port: PortDef, p: { x: number; y: number }, f: MappingFrame, keepEdge: boolean): PortDef => {
    const { u, v } = imageToEnclosure(p, f);
    const sug = suggestPlacement(u, v, f);
    const edge = keepEdge ? port.edge : sug.edge;
    const position = keepEdge ? positionOnEdge(edge, u, v) : sug.position;
    return { ...port, image_anchor: { x: round4(p.x), y: round4(p.y), asset_id: asset!.id }, edge, position, position_evidence: "user" };
  };

  const unplaced = draft.filter((p) => p.position == null && !(p.image_anchor && p.image_anchor.asset_id === asset?.id));

  // Pointer work on the photo brings keyboard focus back to the dialog (the template buttons or
  // a closed popover may have left it on the document body), so arrows / Delete / Ctrl+Z work.
  const focusPanel = () => { if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus(); };
  const onCanvasDown = (e: React.PointerEvent) => {
    if (!frame || !asset) return;
    e.preventDefault();
    focusPanel();
    const p = toNorm(e);
    if (mode === "select") { setSelected(null); return; }
    const pending = unplaced[0];
    if (pending) {
      commit((d) => d.map((x) => (x.id === pending.id ? placeAt(x, p, frame, false) : x)));
      setSelected(pending.id);
    } else {
      const preset = JACK_PRESETS.find((x) => x.key === quick)!;
      const port = placeAt(portFromPreset(preset, draft.map((x) => x.id)), p, frame, false);
      commit((d) => [...d, port]);
      setSelected(port.id);
      if (!sticky) setMode("select");
    }
    setMore(false);
  };
  const onMarkerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    focusPanel();
    setSelected(id);
    setDrag(id);
    setMoved(false);
    dragStart.current = draft;
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag || !frame) return;
    const p = toNorm(e);
    setMoved(true);
    setDraft((d) => d.map((x) => (x.id === drag ? placeAt(x, p, frame, pinned.has(x.id)) : x)));
  };
  const onUp = () => {
    // One undo step per drag, recording where the marker *was* so Undo puts it back.
    const start = dragStart.current;
    if (drag && moved && start) setHistory((h) => [...h.slice(-49), start]);
    dragStart.current = null;
    setDrag(null);
  };

  const sel = draft.find((p) => p.id === selected) ?? null;
  const edit = (fn: (p: PortDef) => PortDef) => { if (sel) commit((d) => d.map((x) => (x.id === sel.id ? { ...fn(x), evidence: "user" } : x))); };
  const setEdge = (edge: Edge | null) => {
    if (!sel || !frame) return;
    if (edge === null) {
      setPinned((s) => { const n = new Set(s); n.delete(sel.id); return n; });
      if (sel.image_anchor) {
        const { u, v } = imageToEnclosure(sel.image_anchor, frame);
        const sug = suggestPlacement(u, v, frame);
        commit((d) => d.map((x) => (x.id === sel.id ? { ...x, edge: sug.edge, position: sug.position, position_evidence: "user" } : x)));
      }
      return;
    }
    setPinned((s) => new Set(s).add(sel.id));
    const anchor = sel.image_anchor && sel.image_anchor.asset_id === asset?.id ? sel.image_anchor : null;
    const { u, v } = anchor ? imageToEnclosure(anchor, frame) : wiringPoint(sel);
    commit((d) => d.map((x) => (x.id === sel.id ? { ...x, edge, position: positionOnEdge(edge, u, v), position_evidence: "user" } : x)));
  };
  const setChannel = (ch: "mono" | "left" | "right" | "stereo_trs") => {
    edit((p) => {
      const base = p.direction === "out" ? "out" : "in";
      if (ch === "stereo_trs") return { ...p, audio_channel: "stereo_trs", connector: "trs_1_4", trs_role: "stereo", pair_group: null };
      if (ch === "mono") return { ...p, audio_channel: "mono", connector: p.connector === "trs_1_4" && p.trs_role === "stereo" ? "ts_1_4" : p.connector, trs_role: p.trs_role === "stereo" ? null : p.trs_role, pair_group: null };
      return { ...p, audio_channel: ch, pair_group: p.pair_group ?? base, trs_role: p.trs_role === "stereo" ? null : p.trs_role, connector: p.connector === "trs_1_4" && p.trs_role === "stereo" ? "ts_1_4" : p.connector };
    });
  };
  const remove = (id: string) => {
    const used = usage[id]?.length ?? 0;
    if (used && !window.confirm(`${used} cable(s) in your rigs are plugged into this jack. Removing it leaves them dangling (they will be flagged). Remove anyway?`)) return;
    commit((d) => d.filter((x) => x.id !== id));
    if (selected === id) setSelected(null);
  };

  const save = async (force = false) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.catalog.updatePorts(profileId, draft, force);
      setConflict(null);
      await onSaved(saved);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.detail && typeof e.detail === "object" && (e.detail as { code?: string }).code === "ports_in_use") {
        const d = e.detail as { message: string; affected: PortUsage[] };
        setConflict({ message: d.message, affected: d.affected });
      } else setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const keepRemoved = () => {
    // Put back the jacks the user removed/renamed, and the original type of the ones they
    // retyped (label, position and anchor edits are kept), then continue editing.
    const ids = new Set(conflict?.affected.map((a) => a.port_id));
    const originals = ports.filter((p) => ids.has(p.id) && !draft.some((d) => d.id === p.id));
    commit((d) => [
      ...d.map((x) => {
        const o = ids.has(x.id) ? ports.find((p) => p.id === x.id) : undefined;
        if (!o) return x;
        const back = { ...x };
        for (const f of SEMANTIC_FIELDS) (back as Record<string, unknown>)[f] = o[f];
        return back;
      }),
      ...originals,
    ]);
    setConflict(null);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) { if (e.key === "Escape") (e.target as HTMLElement).blur(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
    if (e.key === "Escape") { e.preventDefault(); if (selected) setSelected(null); else if (!dirty || window.confirm("Discard the unsaved jack changes?")) onClose(); return; }
    if (!sel || !frame) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(sel.id); return; }
    const step = e.shiftKey ? 0.02 : 0.004;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const v = d[e.key];
    if (!v) return;
    e.preventDefault();
    const a = sel.image_anchor && sel.image_anchor.asset_id === asset?.id ? sel.image_anchor : markerPoint(sel, frame, asset!.id);
    commit((dd) => dd.map((x) => (x.id === sel.id ? placeAt(x, { x: Math.min(1, Math.max(0, a.x + v[0])), y: Math.min(1, Math.max(0, a.y + v[1])) }, frame, pinned.has(x.id)) : x)));
  };

  // Crop boundary and the enclosure's top edge, in image space (so the user sees which way is up).
  const cropPts = frame ? [imageToCorner(frame, 0, 0), imageToCorner(frame, 1, 0), imageToCorner(frame, 1, 1), imageToCorner(frame, 0, 1)] : null;
  const topA = frame ? enclosureToImage({ u: 0, v: 0 }, frame) : null;
  const topB = frame ? enclosureToImage({ u: 1, v: 0 }, frame) : null;
  const foreign = draft.filter((p) => p.image_anchor && p.image_anchor.asset_id !== asset?.id);
  const selMarker = sel && frame && asset ? markerPoint(sel, frame, asset.id) : null;
  const floating = renderW >= 640;

  const editorCard = () => sel && (
    <>
                      <div className="flex items-center gap-1">
                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: KIND_COLOR[sel.kind] }} />
                        <input aria-label="Jack label" className="flex-1 font-medium" value={sel.label} onChange={(e) => edit((p) => ({ ...p, label: e.target.value }))} data-testid="jack-label" />
                        <Button variant="ghost" aria-label="Done" onClick={() => setSelected(null)}>✓</Button>
                      </div>
                      <select aria-label="Jack type" value={presetOf(sel)} onChange={(e) => edit((p) => applyPreset(p, JACK_PRESETS.find((q) => q.key === e.target.value)!))} data-testid="jack-type">
                        {JACK_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                      </select>
                      {sel.kind === "audio" && (
                        <div className="flex items-center gap-1" role="group" aria-label="Audio channel">
                          <span className="text-neutral-500">carries</span>
                          {(["mono", "left", "right", "stereo_trs"] as const).map((ch) => (
                            <button key={ch} type="button" aria-pressed={(sel.audio_channel ?? "mono") === ch} data-testid={`jack-channel-${ch}`} onClick={() => setChannel(ch)} className={`px-1.5 py-0.5 rounded border ${(sel.audio_channel ?? "mono") === ch ? "bg-accent text-white border-accent" : "border-line hover:bg-neutral-100"}`}>
                              {ch === "mono" ? "mono" : ch === "left" ? "L" : ch === "right" ? "R" : "TRS L+R"}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-1" role="group" aria-label="Cable exits at">
                        <span className="text-neutral-500">cable exits</span>
                        {EDGES.map(({ edge, glyph }) => (
                          <button key={edge} type="button" title={EDGE_LABEL[edge]} aria-label={`Cable exits at ${EDGE_LABEL[edge]}`} aria-pressed={sel.edge === edge} data-testid={`jack-edge-${edge}`} onClick={() => setEdge(edge)} className={`w-6 h-6 rounded border ${sel.edge === edge ? "bg-accent text-white border-accent" : "border-line hover:bg-neutral-100"}`}>{glyph}</button>
                        ))}
                        {pinned.has(sel.id) && <button type="button" className="underline text-neutral-500" onClick={() => setEdge(null)}>auto</button>}
                        <span className="text-neutral-500 ml-auto">{sel.position != null ? `${Math.round(sel.position * 100)}%` : "—"}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 text-[10px] text-neutral-500">
                        {sel.image_anchor?.asset_id === asset?.id ? <Badge tone="ok">placed on this photo</Badge> : <Badge tone="warn">position from the profile</Badge>}
                        {sel.evidence ? <EvidenceBadge evidence={sel.evidence} /> : <Badge>profile data</Badge>}
                        {(usage[sel.id]?.length ?? 0) > 0 && <Badge tone="warn">{usage[sel.id].length} cable(s) use this jack</Badge>}
                        <button type="button" className="underline ml-auto" onClick={() => setMore((m) => !m)} data-testid="jack-more">{more ? "less" : "more…"}</button>
                      </div>
                      {more && (
                        <div className="grid grid-cols-2 gap-1.5 border-t border-line pt-1.5">
                          <label className="flex flex-col"><span className="text-neutral-500">id</span><input className="font-mono" value={sel.id} disabled={ports.some((p) => p.id === sel.id)} onChange={(e) => { const nid = e.target.value.replace(/[^a-z0-9_]/gi, "_").toLowerCase(); if (nid && !draft.some((p) => p.id === nid)) { const old = sel.id; commit((d) => d.map((x) => (x.id === old ? { ...x, id: nid } : x))); setSelected(nid); } }} /></label>
                          <label className="flex flex-col"><span className="text-neutral-500">direction</span><select value={sel.direction} onChange={(e) => edit((p) => ({ ...p, direction: e.target.value as PortDef["direction"] }))}>{["in", "out", "bidirectional"].map((d) => <option key={d}>{d}</option>)}</select></label>
                          <label className="flex flex-col"><span className="text-neutral-500">connector</span><select value={sel.connector} onChange={(e) => edit((p) => ({ ...p, connector: e.target.value as PortDef["connector"] }))} data-testid="jack-connector">{CONNECTORS.map((c) => <option key={c}>{c}</option>)}</select></label>
                          {sel.kind === "midi" && <label className="flex flex-col"><span className="text-neutral-500">TRS MIDI wiring</span><select value={sel.midi_trs_type ?? "unknown"} onChange={(e) => edit((p) => ({ ...p, midi_trs_type: e.target.value as PortDef["midi_trs_type"] }))}>{MIDI_TRS_TYPES.map((c) => <option key={c}>{c}</option>)}</select></label>}
                          {sel.kind === "audio" && <label className="flex flex-col"><span className="text-neutral-500">shares a socket with (pair group)</span><input value={sel.pair_group ?? ""} placeholder="e.g. in" onChange={(e) => edit((p) => ({ ...p, pair_group: e.target.value || null }))} /></label>}
                          <label className="flex flex-col"><span className="text-neutral-500">plug clearance (mm)</span><input type="number" min={0} value={sel.plug_clearance_mm ?? ""} onChange={(e) => edit((p) => ({ ...p, plug_clearance_mm: e.target.value === "" ? null : Number(e.target.value) }))} /></label>
                          <label className="flex flex-col col-span-2"><span className="text-neutral-500">notes</span><input value={sel.notes ?? ""} onChange={(e) => edit((p) => ({ ...p, notes: e.target.value || null }))} /></label>
                          {(usage[sel.id]?.length ?? 0) > 0 && (
                            <ul className="col-span-2 text-[10px] text-neutral-600 list-disc pl-4">{usage[sel.id].slice(0, 5).map((u) => <li key={u.connection_id}>{u.rig_name}: {u.instance_label} → {u.other_label}</li>)}</ul>
                          )}
                        </div>
                      )}
                      <div className="flex justify-between">
                        <Button variant="danger" onClick={() => remove(sel.id)} data-testid="jack-remove">Remove</Button>
                        <Button variant="primary" onClick={() => setSelected(null)}>Done</Button>
                      </div>
    </>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/55 flex items-start justify-center p-2 sm:p-4 overflow-auto" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget && (!dirty || window.confirm("Discard the unsaved jack changes?"))) onClose(); }}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Configure jacks: ${title}`} data-testid="jack-mapper" className="bg-panel rounded-lg shadow-xl w-full max-w-[1180px] max-h-[94vh] flex flex-col outline-none" onKeyDown={onKey}>
        <header className="flex items-center gap-3 px-4 py-2 border-b border-line">
          <h2 className="font-semibold text-sm">Configure jacks · {title}</h2>
          <span className="text-[11px] text-neutral-500 hidden sm:inline">Click a connector in the photo, tell Signal Loom what it is, drag to adjust. Esc closes.</span>
          <div className="ml-auto flex items-center gap-2 text-xs">
            {dirty && <Badge tone="warn">unsaved</Badge>}
            <Button onClick={undo} disabled={!history.length} aria-label="Undo">↶ Undo</Button>
            <Button variant="primary" onClick={() => void save(false)} disabled={!dirty || saving || !asset} data-testid="jacks-save">{saving ? "Saving…" : "Save jacks"}</Button>
            <Button onClick={() => { if (!dirty || window.confirm("Discard the unsaved jack changes?")) onClose(); }} aria-label="Close">✕</Button>
          </div>
        </header>
        {error && <div role="alert" className="mx-4 mt-2 rounded border border-red-200 bg-red-50 text-red-800 text-xs px-2 py-1" data-testid="jacks-error">{error}</div>}
        {foreign.length > 0 && (
          <div role="status" className="mx-4 mt-2 rounded border border-amber-300 bg-amber-50 text-amber-900 text-xs px-2 py-1" data-testid="jacks-foreign">
            {foreign.length} marker{foreign.length > 1 ? "s were" : " was"} placed on a previous photograph ({foreign.map((p) => p.label).join(", ")}). They are shown at their wiring position; drag each one onto the connector to confirm it on this picture.
          </div>
        )}

        <div className="grid md:grid-cols-[minmax(0,1fr)_300px] gap-3 p-3 min-h-0 overflow-auto">
          {/* ------------------------------------------------ photo + markers */}
          <div className="min-w-0 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="inline-flex rounded border border-line overflow-hidden">
                <button type="button" className={`px-2 py-1 ${mode === "add" ? "bg-accent text-white" : "bg-panel hover:bg-neutral-100"}`} onClick={() => setMode("add")} data-testid="jacks-mode-add" aria-pressed={mode === "add"}>+ Add jacks</button>
                <button type="button" className={`px-2 py-1 ${mode === "select" ? "bg-accent text-white" : "bg-panel hover:bg-neutral-100"}`} onClick={() => setMode("select")} aria-pressed={mode === "select"}>Select / move</button>
              </div>
              {mode === "add" && (
                <>
                  <label className="flex items-center gap-1">
                    next click adds
                    <select aria-label="Jack type to add" value={quick} onChange={(e) => setQuick(e.target.value)} data-testid="jacks-quick" disabled={unplaced.length > 0}>
                      {JACK_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={sticky} onChange={(e) => setSticky(e.target.checked)} /> keep adding</label>
                  {unplaced.length > 0 && <Badge tone="warn">click the photo to place “{unplaced[0].label}” ({unplaced.length} to place)</Badge>}
                </>
              )}
              <label className="ml-auto flex items-center gap-1">Zoom <input type="range" min={1} max={3} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" /> {zoom.toFixed(2)}×</label>
            </div>
            {/* The photo sits centred in the dark area (auto margins inside a flex box: centred while it
                fits, scrollable from the top-left corner once zoomed past the area), with FRAME_PAD of
                margin on every side so markers and labels at the photo's edge stay visible. */}
            <div ref={scrollRef} className="overflow-auto h-[62vh] min-h-[320px] rounded border border-line bg-neutral-900/90 relative flex" data-testid="jacks-scroll">
              {!asset ? <div className="p-6 text-xs text-neutral-300">Loading the picture…</div> : (
                <div className="m-auto shrink-0" style={{ padding: FRAME_PAD }}>
                <div ref={frameRef} className="relative select-none touch-none" style={{ width: frameW, aspectRatio: `${asset.width} / ${asset.height}` }} data-testid="jacks-frame">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.url} alt="Device photograph" width={dw} height={dh} className="block w-full h-auto" draggable={false} />
                  <svg ref={svgRef} viewBox={`0 0 ${dw} ${dh}`} width="100%" height="100%" className="absolute inset-0 overflow-visible" style={{ cursor: mode === "add" ? "crosshair" : "default" }} data-testid="jacks-overlay" onPointerDown={onCanvasDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
                    {/* enclosure crop and its top edge */}
                    {cropPts && (
                      <polygon points={cropPts.map((p) => `${p.x * dw},${p.y * dh}`).join(" ")} fill="none" stroke="#fbbf24" strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`} pointerEvents="none" data-testid="jacks-crop" />
                    )}
                    {topA && topB && (
                      <g pointerEvents="none">
                        <line x1={topA.x * dw} y1={topA.y * dh} x2={topB.x * dw} y2={topB.y * dh} stroke="#fbbf24" strokeWidth={px(4)} strokeOpacity={0.9} />
                        <text x={((topA.x + topB.x) / 2) * dw} y={((topA.y + topB.y) / 2) * dh - px(6)} fontSize={px(11)} fill="#fbbf24" textAnchor="middle" fontWeight={700} paintOrder="stroke" stroke="#0f172a" strokeWidth={px(3)}>enclosure top (away from player)</text>
                      </g>
                    )}
                    {/* markers */}
                    {frame && draft.map((p) => {
                      const m = markerPoint(p, frame, asset.id);
                      if (p.position == null && m.derived) return null; // still to place: listed on the right, not drawn
                      const w = enclosureToImage(wiringPoint(p), frame);
                      const isSel = p.id === selected;
                      const col = KIND_COLOR[p.kind];
                      const used = usage[p.id]?.length ?? 0;
                      const r = px(isSel ? 12 : 10);
                      return (
                        <g key={p.id} data-testid={`jack-marker-${p.id}`} data-x={m.x.toFixed(4)} data-y={m.y.toFixed(4)} data-edge={p.edge} data-position={p.position ?? ""} data-derived={m.derived ? "true" : "false"}>
                          {/* lead from the visible connector to where the cable is modelled to start */}
                          <line x1={m.x * dw} y1={m.y * dh} x2={w.x * dw} y2={w.y * dh} stroke="#fff" strokeWidth={px(1.2)} strokeOpacity={0.85} strokeDasharray={p.edge === "top_face" ? `${px(2)} ${px(2)}` : undefined} pointerEvents="none" />
                          <rect x={w.x * dw - px(4)} y={w.y * dh - px(4)} width={px(8)} height={px(8)} fill="#fff" stroke={col} strokeWidth={px(1.5)} pointerEvents="none" transform={`rotate(45 ${w.x * dw} ${w.y * dh})`} />
                          <circle cx={m.x * dw} cy={m.y * dh} r={r} fill={col} fillOpacity={0.92} stroke={isSel ? "#fff" : "#0f172a"} strokeWidth={px(isSel ? 3 : 1.5)} strokeDasharray={m.derived ? `${px(3)} ${px(3)}` : undefined} style={{ cursor: "grab" }} onPointerDown={(e) => onMarkerDown(e, p.id)}>
                            <title>{`${p.label} · ${p.kind} ${p.direction}${m.derived ? " · position from the profile, not placed on this photo" : ""}${used ? ` · ${used} cable(s)` : ""}`}</title>
                          </circle>
                          <text x={m.x * dw} y={m.y * dh + px(4)} fontSize={px(9)} fontWeight={700} fill="#fff" textAnchor="middle" pointerEvents="none">{JACK_PRESETS.find((q) => q.key === presetOf(p))?.short ?? "?"}</text>
                          <text x={m.x * dw + r + px(3)} y={m.y * dh + px(4)} fontSize={px(11)} fill="#fff" paintOrder="stroke" stroke="#0f172a" strokeWidth={px(3)} pointerEvents="none">{p.label}{used ? " 🔌" : ""}</text>
                        </g>
                      );
                    })}
                  </svg>
                  {/* contextual editor floats next to the marker when the photo is wide enough; otherwise it
                      lives at the top of the side column so it never covers the connectors */}
                  {sel && selMarker && frame && floating && (
                    <div
                      className="absolute z-10 w-[280px] rounded-md border border-line bg-panel shadow-lg p-2 text-xs flex flex-col gap-1.5"
                      style={{ left: `min(calc(${selMarker.x * 100}% + 18px), calc(100% - 290px))`, top: `min(calc(${selMarker.y * 100}% + 14px), calc(100% - 260px))` }}
                      data-testid="jack-popover"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      {editorCard()}
                    </div>
                  )}
                </div>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-500">
              <span><i className="inline-block w-3 border-t-2 border-dashed border-amber-400 align-middle" /> enclosure crop</span>
              <span><i className="inline-block w-3 border-t-[3px] border-amber-400 align-middle" /> top edge</span>
              <span><i className="inline-block w-2.5 h-2.5 rounded-full bg-neutral-700 align-middle" /> connector as seen</span>
              <span><i className="inline-block w-2 h-2 bg-white border border-neutral-700 rotate-45 align-middle" /> where the cable is modelled to start</span>
              <span><i className="inline-block w-2.5 h-2.5 rounded-full border border-dashed border-neutral-700 align-middle" /> from the profile, not yet confirmed on this photo</span>
              {dims ? <span>footprint {widthMm} × {depthMm} mm {footprintEvidence && <EvidenceBadge evidence={footprintEvidence} />}</span> : <Badge tone="warn">no dimensions: edges are suggested from the crop only</Badge>}
            </div>
          </div>

          {/* ------------------------------------------------ side column */}
          <div className="flex flex-col gap-3 text-xs min-w-0">
            {sel && !floating && (
              <div className="rounded-md border-2 border-accent bg-panel p-2 flex flex-col gap-1.5" data-testid="jack-popover">
                {editorCard()}
              </div>
            )}
            {draft.length === 0 && (
              <div className="rounded border border-line p-2 flex flex-col gap-1" data-testid="jack-templates">
                <h3 className="font-semibold">Start from a template</h3>
                <p className="text-neutral-500">Proposals, not manufacturer facts: you place and confirm each jack, and they are stored as your own entries.</p>
                {JACK_TEMPLATES.map((t) => (
                  <button key={t.key} type="button" className="text-left rounded border border-line px-2 py-1 hover:bg-neutral-100" data-testid={`jack-template-${t.key}`} onClick={() => { commit(portsFromTemplate(t, [])); setMode("add"); }}>
                    <b>{t.name}</b> <span className="text-neutral-500">· {t.description}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="rounded border border-line p-2 flex flex-col gap-1 min-h-0">
              <div className="flex items-center justify-between"><h3 className="font-semibold">Jacks ({draft.length})</h3>{draft.length > 0 && <button type="button" className="underline text-neutral-500" onClick={() => { if (window.confirm("Remove every jack from this profile?")) { commit([]); setSelected(null); } }}>clear</button>}</div>
              {draft.length === 0 && <p className="text-neutral-500">None yet. Pick a template or click a connector in the photo.</p>}
              <ul className="flex flex-col divide-y divide-line max-h-[40vh] overflow-auto" data-testid="jack-list">
                {draft.map((p) => {
                  const m = frame && asset ? markerPoint(p, frame, asset.id) : null;
                  const placed = !!m && !m.derived;
                  const toPlace = p.position == null && !placed;
                  return (
                    <li key={p.id} className={`flex items-center gap-2 py-1 cursor-pointer ${p.id === selected ? "bg-blue-50" : ""}`} onClick={() => setSelected(p.id)} data-testid={`jack-row-${p.id}`}>
                      <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: KIND_COLOR[p.kind] }} />
                      <span className="flex-1 truncate"><b>{p.label}</b> <span className="text-neutral-500">{JACK_PRESETS.find((q) => q.key === presetOf(p))?.label}{p.audio_channel && p.audio_channel !== "mono" && p.kind === "audio" ? ` · ${p.audio_channel.replace("_", " ")}` : ""}</span></span>
                      {toPlace ? <Badge tone="warn">to place</Badge> : placed ? <Badge tone="ok">on photo</Badge> : <Badge>{p.edge.replace("_", " ")}</Badge>}
                      {(usage[p.id]?.length ?? 0) > 0 && <span title="used by cables">🔌{usage[p.id].length}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="text-[11px] text-neutral-500 flex flex-col gap-1">
              <p><b>How placement works.</b> The marker records where the connector appears in the photo. The cable start is suggested from the nearest enclosure edge (or the side a plug sticks out of); connectors deep inside the outline become top-face jacks. Override the edge if the guess is wrong; positions you set are stored as user evidence.</p>
              <p>Shortcuts: arrows nudge the selected marker (Shift = faster), Delete removes it, Ctrl+Z undoes, Esc deselects / closes.</p>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------ conflict dialog */}
        {conflict && (
          <div className="absolute inset-0 z-20 bg-black/40 flex items-center justify-center p-4" role="presentation">
            <div role="alertdialog" aria-modal="true" aria-label="Cables use the jacks you are changing" className="bg-panel rounded-lg shadow-xl max-w-[560px] w-full p-4 text-xs flex flex-col gap-2" data-testid="jacks-conflict">
              <h3 className="font-semibold text-sm">Cables are plugged into jacks you are {conflict.affected.every((a) => a.change && a.change !== "removed") ? "changing" : conflict.affected.some((a) => a.change && a.change !== "removed") ? "removing or changing" : "removing or renaming"}</h3>
              <p>{conflict.message}. A removed jack leaves its cables pointing at nothing; a retyped one makes them join signals that do not match. Nothing is deleted, and the wiring check will flag each of them.</p>
              <ul className="list-disc pl-4 max-h-48 overflow-auto">
                {conflict.affected.map((a) => <li key={`${a.port_id}-${a.connection_id}`}><b>{a.port_id}</b>{a.change && a.change !== "removed" ? <span className="text-amber-700"> ({a.change})</span> : " (removed)"} · {a.rig_name}: {a.instance_label} → {a.other_label}{a.connection_label ? ` (“${a.connection_label}”)` : ""}</li>)}
              </ul>
              <div className="flex justify-end gap-2">
                <Button onClick={keepRemoved} data-testid="jacks-conflict-keep">Keep those jacks as they were</Button>
                <Button variant="danger" onClick={() => void save(true)} data-testid="jacks-conflict-force">{conflict.affected.some((a) => a.change === "removed" || !a.change) ? "Remove anyway" : "Change anyway"}</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function imageToCorner(f: MappingFrame, cu: 0 | 1, cv: 0 | 1) {
  // Corners of the enclosure (U,V ∈ {0,1}) drawn in image space: the crop as the footprint sees it.
  return enclosureToImage({ u: cu, v: cv }, f);
}

/** The thumbnail-sized "Configure jacks" entry used by the catalog and the inspector. */
export function ConfigureJacksButton({ image, onOpen, count, testId = "configure-jacks" }: { image: DeviceImage | null | undefined; onOpen: () => void; count: number; testId?: string }) {
  if (!image) return <span className="text-[11px] text-neutral-500" data-testid={`${testId}-hint`}>Add a picture to configure jacks by pointing at them; the table below still works without one.</span>;
  return <Button variant={count ? "default" : "primary"} onClick={onOpen} data-testid={testId}>⌖ Configure jacks on the photo{count ? ` (${count})` : ""}</Button>;
}
