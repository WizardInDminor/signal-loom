"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRigStore } from "@/store/rigStore";
import type { PedalboardSpec, SignalKind } from "@/lib/types";
import { Badge, Button, DiagnosticList, EvidenceBadge, Field, KIND_COLOR, Panel } from "@/components/ui/basics";
import { BoardCanvas, boardViewBox } from "./BoardCanvas";
import { InstanceInspector } from "./InstanceInspector";
import { api } from "@/lib/api";
import { surfaceOf } from "@/lib/mounting";

const KINDS: SignalKind[] = ["audio", "midi", "expression", "power", "usb"];
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 4;
/** Breathing room (CSS px) kept around the whole drawing when fitting it into the canvas area. */
const FIT_PAD = 16;

/** Zoom (px/mm) at which a drawing of vbW × vbH mm fits a visible area of w × h px with padding on every side. */
export function fitZoom(w: number, h: number, vbW: number, vbH: number): number {
  const z = Math.min((w - 2 * FIT_PAD) / vbW, (h - 2 * FIT_PAD) / vbH);
  if (!Number.isFinite(z) || z <= 0) return ZOOM_MIN;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.floor(z * 100) / 100));
}

export function BoardTab() {
  const { rig, analysis, catalog, addInstance, update, pendingCable, canUndo, canRedo, undo, redo } = useRigStore();
  const [zoom, setZoom] = useState(1.4);
  // The zoom follows the visible area (on open, after Fit, and whenever the area resizes) until
  // the user touches the slider for this rig; Fit hands control back. Keyed by rig so opening
  // another rig starts fitted again.
  const [manualZoomRig, setManualZoomRig] = useState<string | null>(null);
  const rigId = rig?.id;
  const fitted = manualZoomRig !== (rigId ?? null);
  const [expanded, setExpanded] = useState(false);
  const [sideOpen, setSideOpen] = useState(true);
  const [q, setQ] = useState("");
  const [cableKinds, setCableKinds] = useState<Set<SignalKind>>(new Set(["audio", "midi"]));
  const [showLabels, setShowLabels] = useState(false);
  const [showClearance, setShowClearance] = useState(true);
  // Which surface of the board is being edited. Both views share x/y (the underside is seen
  // through the board from above, not mirrored); off-board devices appear in both.
  const [viewSurface, setViewSurface] = useState<"top" | "underside">("top");
  const [showGhosts, setShowGhosts] = useState(true);
  const [boards, setBoards] = useState<PedalboardSpec[]>([]);
  useEffect(() => { api.catalog.boards().then(setBoards).catch(() => setBoards([])); }, []);
  const containerRef = useRef<HTMLDivElement>(null);
  // Normal layout: the canvas area runs from where it starts down to the bottom of the window, so
  // "fit" means the board is fully on screen without scrolling the page. Re-measured on window
  // resizes (the toolbar above may wrap); the diagnostics sit below, reachable by scrolling.
  const [canvasH, setCanvasH] = useState<number | null>(null);
  useEffect(() => {
    if (expanded) return;
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      // Where the canvas starts with the page (and any scrolling ancestor) unscrolled.
      let top = el.getBoundingClientRect().top + window.scrollY;
      for (let a = el.parentElement; a; a = a.parentElement) top += a.scrollTop;
      setCanvasH(Math.max(320, Math.floor(window.innerHeight - top - 12)));
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", measure); };
  }, [expanded, rigId]);

  const fit = useCallback(() => {
    const el = containerRef.current;
    const r = useRigStore.getState().rig;
    if (!r || !el) return;
    const { vbW, vbH } = boardViewBox(r, useRigStore.getState().analysis);
    // clientWidth/Height exclude the scrollbars; the container's padding is part of FIT_PAD's job.
    setZoom(fitZoom(el.clientWidth, el.clientHeight, vbW, vbH));
  }, []);
  const pressFit = () => { setManualZoomRig(null); fit(); };

  // Fit on open, and keep fitting while the visible area changes size (window resize, the side
  // column collapsing, entering or leaving the expanded workspace) until the user picks a zoom.
  useEffect(() => { if (fitted) fit(); }, [rigId, fitted, fit]);
  useEffect(() => {
    const el = containerRef.current;
    if (!fitted || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitted, fit, expanded]);
  // The drawing itself can change size (off-board devices come and go): refit then too.
  const vb = rig ? boardViewBox(rig, analysis) : null;
  const vbKey = vb ? `${vb.vbW}x${vb.vbH}` : "";
  useEffect(() => { if (fitted) fit(); }, [vbKey, fitted, fit]);

  // Esc leaves the expanded workspace, unless a cable is being drawn (the canvas uses Esc to
  // cancel it) or a form control has focus.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || pendingCable) return;
      if ((e.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return;
      setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, pendingCable]);

  if (!rig) return null;
  const boardDiags = analysis?.diagnostics.filter((d) => d.code.startsWith("instance.")) ?? [];
  const matches = catalog.filter((p) => `${p.manufacturer} ${p.model}`.toLowerCase().includes(q.toLowerCase())).slice(0, 12);
  const toggleKind = (k: SignalKind) => setCableKinds((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const counts = { top: rig.instances.filter((i) => surfaceOf(i) === "top").length, underside: rig.instances.filter((i) => surfaceOf(i) === "underside").length };
  const spec = analysis?.mounting?.spec ?? null;
  const clearance = analysis?.mounting?.clearance_mm ?? null;
  const pickBoard = (id: string) => {
    const b = boards.find((x) => x.id === id);
    update((r) => {
      r.board.model_id = id || null;
      if (b?.width.value_mm && b.depth.value_mm) { r.board.width_mm = b.width.value_mm; r.board.depth_mm = b.depth.value_mm; }
      if (b && !r.board.name.trim()) r.board.name = `${b.manufacturer} ${b.model}`;
    });
  };

  const surfaceSwitch = (
    <div role="group" aria-label="Board surface" className="flex rounded border border-line overflow-hidden text-xs self-end" data-testid="surface-switch">
      {(["top", "underside"] as const).map((sf) => (
        <button key={sf} type="button" aria-pressed={viewSurface === sf} data-testid={`surface-${sf}`} onClick={() => setViewSurface(sf)} className={`px-2 py-1 ${viewSurface === sf ? "bg-accent text-white" : "bg-panel hover:bg-neutral-100"}`}>
          {sf === "top" ? "Top" : "Underside"} <span className="opacity-70">{counts[sf]}</span>
        </button>
      ))}
    </div>
  );
  const boardModel = (
    <>
      <Field label="Pedalboard">
        <select value={rig.board.model_id ?? ""} onChange={(e) => pickBoard(e.target.value)} data-testid="board-model" aria-label="Pedalboard model">
          <option value="">Custom</option>
          {boards.map((b) => <option key={b.id} value={b.id}>{b.manufacturer} {b.model}</option>)}
        </select>
      </Field>
      <Field label="Clearance under (mm)" hint={clearance == null ? "unverified" : analysis?.mounting?.clearance_source === "user" ? "your measurement" : analysis?.mounting?.clearance_source}>
        <input type="number" className="w-20" min={1} value={rig.board.underside_clearance_mm ?? ""} placeholder="?" aria-label="Clearance under the board (mm)" data-testid="board-clearance" onChange={(e) => update((r) => { r.board.underside_clearance_mm = e.target.value === "" ? null : Math.max(1, Number(e.target.value)); })} />
      </Field>
    </>
  );
  const specLine = spec && (
    <div className="text-[11px] text-neutral-600 flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="board-spec">
      <span><b>{spec.manufacturer} {spec.model}</b>{spec.width.value_mm && spec.depth.value_mm ? ` · ${spec.width.value_mm} × ${spec.depth.value_mm} mm` : ""}{spec.height.value_mm ? ` · ${spec.height.value_mm} mm tall` : ""} <EvidenceBadge evidence={spec.width.evidence} /></span>
      {spec.rails != null && <span>· {spec.rails} rails{spec.rail_pitch.value_mm == null && <> <Badge tone="warn">spacing unverified</Badge></>}</span>}
      <span>· underside {spec.underside_mountable === false ? <Badge tone="bad">none</Badge> : spec.underside_mountable ? <Badge tone="ok">mountable</Badge> : <Badge tone="warn">unknown</Badge>}{spec.underside_mountable !== false && <>, clearance {spec.underside_clearance.value_mm != null ? `${spec.underside_clearance.value_mm} mm` : <Badge tone="warn">unverified</Badge>}</>}</span>
      {spec.compatible_brackets.length > 0 && <span className="text-neutral-500" title={spec.compatible_brackets.join("; ")}>· brackets: third-party list</span>}
    </div>
  );

  const viewControls = (
    <>
      {surfaceSwitch}
      <Field label={`Zoom ${zoom.toFixed(1)} px/mm`}><input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.1} value={zoom} onChange={(e) => { setManualZoomRig(rigId ?? null); setZoom(Number(e.target.value)); }} aria-label="Zoom" /></Field>
      <Button onClick={pressFit} title="Fit the whole board into the visible area" aria-pressed={fitted} data-testid="board-fit">Fit</Button>
      <Button onClick={() => setExpanded((x) => !x)} aria-pressed={expanded} title={expanded ? "Back to the normal layout (Esc)" : "Give the board the whole window"} data-testid="board-expand">{expanded ? "⤡ Exit" : "⤢ Expand"}</Button>
      <Button onClick={undo} disabled={!canUndo} aria-label="Undo">↶ Undo</Button>
      <Button onClick={redo} disabled={!canRedo} aria-label="Redo">↷ Redo</Button>
    </>
  );
  const cableControls = (
    <>
      <span className="text-neutral-600">Show cables:</span>
      {KINDS.map((k) => (
        <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={cableKinds.has(k)} onChange={() => toggleKind(k)} /><span className="inline-block w-2 h-2 rounded-full" style={{ background: KIND_COLOR[k] }} />{k}</label>
      ))}
      <label className="flex items-center gap-1 ml-2"><input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> jack labels</label>
      <label className="flex items-center gap-1"><input type="checkbox" checked={showClearance} onChange={(e) => setShowClearance(e.target.checked)} /> plug clearance</label>
      <label className="flex items-center gap-1" title="Draw the other surface's devices faintly for reference"><input type="checkbox" checked={showGhosts} onChange={(e) => setShowGhosts(e.target.checked)} data-testid="show-ghosts" /> show {viewSurface === "top" ? "underside" : "top"} as ghosts</label>
    </>
  );
  const canvasArea = (
    <div className={`relative ${expanded ? "flex-1 min-h-0 flex flex-col" : ""}`}>
      {/* Overlay, not inline: inserting a banner above the canvas mid-drag would shift the jacks under the pointer. */}
      {pendingCable && (
        <div role="status" className="absolute left-3 top-3 z-10 text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded px-2 py-1 flex items-center gap-2 shadow pointer-events-none">
          Connecting a {pendingCable.kind} cable from {rig.instances.find((i) => i.id === pendingCable.instance_id)?.label}: drop on a highlighted jack (same signal kind, opposite direction, input not already used). Esc cancels.
        </div>
      )}
      {/* A definite height (not max-height) so Fit can measure the space the board may use. */}
      <div ref={containerRef} className={`overflow-auto border border-line rounded bg-white p-2 ${expanded ? "flex-1 min-h-0" : "min-h-[320px]"}`} style={expanded ? undefined : { height: canvasH ?? "60vh" }} data-testid="board-viewport">
        <BoardCanvas view={{ zoom, cableKinds, showLabels, showClearance, surface: viewSurface, showGhosts }} />
      </div>
    </div>
  );
  const sidePanels = (
    <>
      <Panel title="Add device">
        <input aria-label="Search device library" placeholder="Search library…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full mb-2" />
        <ul className="flex flex-col gap-1 max-h-56 overflow-auto">
          {matches.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-xs">
              <span className="flex-1 truncate">
                {p.manufacturer} {p.model}{" "}
                {p.footprint.width.value_mm == null && <Badge tone="warn">size unknown</Badge>}
              </span>
              <Button onClick={() => addInstance(p, viewSurface)} aria-label={`Add ${p.manufacturer} ${p.model}`} title={`Add to the ${viewSurface === "top" ? "top of the board" : "underside"}`}>+ Add</Button>
            </li>
          ))}
          {!matches.length && <li className="text-xs text-neutral-500">No match. Create custom devices in the Device library.</li>}
        </ul>
      </Panel>
      <InstanceInspector />
    </>
  );

  if (expanded) {
    // The expanded workspace: the board takes the window, the side column is a toggle, Esc leaves.
    return (
      <div className="fixed inset-0 z-40 bg-background flex gap-2 p-2" data-testid="board-workspace" data-expanded="true" role="region" aria-label="Expanded board workspace">
        <div className="flex flex-col gap-2 min-w-0 flex-1 min-h-0">
          <div className="flex flex-wrap items-end gap-3 text-xs">
            <span className="font-semibold text-sm self-center">{rig.name} · {rig.board.width_mm} × {rig.board.depth_mm} mm</span>
            {viewControls}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {cableControls}
            <span className="text-neutral-500 hidden 2xl:inline">Drag device to move · arrows nudge · R rotates · Delete removes · Ctrl+Z / Ctrl+Shift+Z · <b>drag from a jack to a compatible jack to add a cable</b> · Esc exits</span>
            <Button onClick={() => setSideOpen((o) => !o)} aria-pressed={sideOpen} className="ml-auto" data-testid="board-side-toggle">{sideOpen ? "Hide inspector ▸" : "◂ Inspector"}</Button>
          </div>
          {canvasArea}
        </div>
        {sideOpen && (
          <div className="w-[340px] shrink-0 overflow-auto flex flex-col gap-3" data-testid="board-side">
            {sidePanels}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-3 items-start" data-testid="board-workspace" data-expanded="false">
      <div className="flex flex-col gap-3 min-w-0">
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <Field label="Board name"><input value={rig.board.name} onChange={(e) => update((r) => { r.board.name = e.target.value; })} /></Field>
          <Field label="Width (mm)"><input type="number" className="w-20" value={rig.board.width_mm} min={50} onChange={(e) => update((r) => { r.board.width_mm = Math.max(50, Number(e.target.value)); })} /></Field>
          <Field label="Depth (mm)"><input type="number" className="w-20" value={rig.board.depth_mm} min={50} onChange={(e) => update((r) => { r.board.depth_mm = Math.max(50, Number(e.target.value)); })} /></Field>
          <Field label="Grid (mm)"><input type="number" className="w-16" value={rig.board.grid_mm} min={1} onChange={(e) => update((r) => { r.board.grid_mm = Math.max(1, Number(e.target.value)); })} /></Field>
          {boardModel}
          {viewControls}
        </div>
        {specLine}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {cableControls}
          <span className="text-neutral-500 ml-auto">Drag device to move (edges snap to neighbours) · arrows nudge · R rotates · Delete removes · Ctrl+Z / Ctrl+Shift+Z undo/redo · <b>drag from a jack to a compatible jack to add a cable</b></span>
        </div>
        {canvasArea}
        <Panel title="Board diagnostics">
          <DiagnosticList items={boardDiags} empty="Every device fits and nothing collides." onFocus={(d) => d.subject_id && useRigStore.getState().select(d.subject_id)} />
        </Panel>
      </div>
      <div className="flex flex-col gap-3" data-testid="board-side">
        {sidePanels}
      </div>
    </div>
  );
}
