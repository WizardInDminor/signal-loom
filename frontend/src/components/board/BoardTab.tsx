"use client";

import { useState } from "react";
import { useRigStore } from "@/store/rigStore";
import { Badge, Button, DiagnosticList, Field, Panel } from "@/components/ui/basics";
import { BoardCanvas } from "./BoardCanvas";
import { InstanceInspector } from "./InstanceInspector";

export function BoardTab() {
  const { rig, analysis, catalog, addInstance, update } = useRigStore();
  const [zoom, setZoom] = useState(1.4);
  const [q, setQ] = useState("");
  if (!rig) return null;
  const boardDiags = analysis?.diagnostics.filter((d) => d.code.startsWith("instance.")) ?? [];
  const matches = catalog.filter((p) => `${p.manufacturer} ${p.model}`.toLowerCase().includes(q.toLowerCase())).slice(0, 12);

  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-3 items-start">
      <div className="flex flex-col gap-3 min-w-0">
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <Field label="Board name"><input value={rig.board.name} onChange={(e) => update((r) => { r.board.name = e.target.value; })} /></Field>
          <Field label="Width (mm)"><input type="number" className="w-20" value={rig.board.width_mm} min={50} onChange={(e) => update((r) => { r.board.width_mm = Math.max(50, Number(e.target.value)); })} /></Field>
          <Field label="Depth (mm)"><input type="number" className="w-20" value={rig.board.depth_mm} min={50} onChange={(e) => update((r) => { r.board.depth_mm = Math.max(50, Number(e.target.value)); })} /></Field>
          <Field label="Grid (mm)"><input type="number" className="w-16" value={rig.board.grid_mm} min={1} onChange={(e) => update((r) => { r.board.grid_mm = Math.max(1, Number(e.target.value)); })} /></Field>
          <Field label={`Zoom ${zoom.toFixed(1)} px/mm`}><input type="range" min={0.5} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></Field>
          <span className="text-neutral-500">Drag to move · arrow keys nudge · R rotates · Delete removes</span>
        </div>
        <div className="overflow-auto max-h-[70vh] border border-line rounded bg-white p-2">
          <BoardCanvas zoom={zoom} />
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
