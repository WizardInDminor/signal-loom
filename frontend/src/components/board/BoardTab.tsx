"use client";

import { useEffect, useRef, useState } from "react";
import { useRigStore } from "@/store/rigStore";
import type { SignalKind } from "@/lib/types";
import { Badge, Button, DiagnosticList, Field, KIND_COLOR, Panel } from "@/components/ui/basics";
import { BoardCanvas, boardViewBox } from "./BoardCanvas";
import { InstanceInspector } from "./InstanceInspector";

const KINDS: SignalKind[] = ["audio", "midi", "expression", "power", "usb"];

export function BoardTab() {
  const { rig, analysis, catalog, addInstance, update, pendingCable, setPendingCable, canUndo, canRedo, undo, redo } = useRigStore();
  const [zoom, setZoom] = useState(1.4);
  const [q, setQ] = useState("");
  const [cableKinds, setCableKinds] = useState<Set<SignalKind>>(new Set(["audio", "midi"]));
  const [showLabels, setShowLabels] = useState(false);
  const [showClearance, setShowClearance] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const fit = () => {
    if (!rig || !containerRef.current) return;
    const { vbW } = boardViewBox(rig, analysis);
    setZoom(Math.max(0.3, Math.min(4, Math.round(((containerRef.current.clientWidth - 24) / vbW) * 10) / 10)));
  };
  useEffect(() => { fit(); }, [rig?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rig) return null;
  const boardDiags = analysis?.diagnostics.filter((d) => d.code.startsWith("instance.")) ?? [];
  const matches = catalog.filter((p) => `${p.manufacturer} ${p.model}`.toLowerCase().includes(q.toLowerCase())).slice(0, 12);
  const toggleKind = (k: SignalKind) => setCableKinds((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-3 items-start">
      <div className="flex flex-col gap-3 min-w-0">
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <Field label="Board name"><input value={rig.board.name} onChange={(e) => update((r) => { r.board.name = e.target.value; })} /></Field>
          <Field label="Width (mm)"><input type="number" className="w-20" value={rig.board.width_mm} min={50} onChange={(e) => update((r) => { r.board.width_mm = Math.max(50, Number(e.target.value)); })} /></Field>
          <Field label="Depth (mm)"><input type="number" className="w-20" value={rig.board.depth_mm} min={50} onChange={(e) => update((r) => { r.board.depth_mm = Math.max(50, Number(e.target.value)); })} /></Field>
          <Field label="Grid (mm)"><input type="number" className="w-16" value={rig.board.grid_mm} min={1} onChange={(e) => update((r) => { r.board.grid_mm = Math.max(1, Number(e.target.value)); })} /></Field>
          <Field label={`Zoom ${zoom.toFixed(1)} px/mm`}><input type="range" min={0.3} max={4} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" /></Field>
          <Button onClick={fit}>Fit</Button>
          <Button onClick={undo} disabled={!canUndo} aria-label="Undo">↶ Undo</Button>
          <Button onClick={redo} disabled={!canRedo} aria-label="Redo">↷ Redo</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-neutral-600">Show cables:</span>
          {KINDS.map((k) => (
            <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={cableKinds.has(k)} onChange={() => toggleKind(k)} /><span className="inline-block w-2 h-2 rounded-full" style={{ background: KIND_COLOR[k] }} />{k}</label>
          ))}
          <label className="flex items-center gap-1 ml-2"><input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> jack labels</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={showClearance} onChange={(e) => setShowClearance(e.target.checked)} /> plug clearance</label>
          <span className="text-neutral-500 ml-auto">Drag device to move (edges snap to neighbours) · arrows nudge · R rotates · Delete removes · Ctrl+Z / Ctrl+Shift+Z undo/redo · <b>drag from a jack to a compatible jack to add a cable</b></span>
        </div>
        <div className="relative">
          {/* Overlay, not inline: inserting a banner above the canvas mid-drag would shift the jacks under the pointer. */}
          {pendingCable && (
            <div role="status" className="absolute left-3 top-3 z-10 text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded px-2 py-1 flex items-center gap-2 shadow pointer-events-none">
              Connecting a {pendingCable.kind} cable from {rig.instances.find((i) => i.id === pendingCable.instance_id)?.label}: drop on a highlighted jack (same signal kind, opposite direction, input not already used). Esc cancels.
            </div>
          )}
          <div ref={containerRef} className="overflow-auto max-h-[70vh] border border-line rounded bg-white p-2">
            <BoardCanvas view={{ zoom, cableKinds, showLabels, showClearance }} />
          </div>
        </div>
        <Panel title="Board diagnostics">
          <DiagnosticList items={boardDiags} empty="Every device fits and nothing collides." onFocus={(d) => d.subject_id && useRigStore.getState().select(d.subject_id)} />
        </Panel>
      </div>
      <div className="flex flex-col gap-3">
        <Panel title="Add device">
          <input aria-label="Search device library" placeholder="Search library…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full mb-2" />
          <ul className="flex flex-col gap-1 max-h-56 overflow-auto">
            {matches.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate">
                  {p.manufacturer} {p.model}{" "}
                  {p.footprint.width.value_mm == null && <Badge tone="warn">size unknown</Badge>}
                </span>
                <Button onClick={() => addInstance(p)} aria-label={`Add ${p.manufacturer} ${p.model}`}>+ Add</Button>
              </li>
            ))}
            {!matches.length && <li className="text-xs text-neutral-500">No match. Create custom devices in the Device library.</li>}
          </ul>
        </Panel>
        <InstanceInspector />
      </div>
    </div>
  );
}
