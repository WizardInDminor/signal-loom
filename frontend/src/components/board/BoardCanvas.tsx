"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRigStore } from "@/store/rigStore";
import type { DeviceInstance, Rotation, SignalKind } from "@/lib/types";
import { KIND_COLOR } from "@/components/ui/basics";
import { OFFBOARD_GAP, boardLayout, boardViewBox, enclosureFill } from "@/lib/boardLayout";

export { boardViewBox };

const DROP_RADIUS_MM = 9;

export interface BoardViewOptions {
  zoom: number;
  cableKinds: Set<SignalKind>;
  showLabels: boolean;
  showClearance: boolean;
}

export function BoardCanvas({ view }: { view: BoardViewOptions }) {
  const { rig, analysis, profiles, selectedInstanceId, select, update, removeInstance, pendingCable, setPendingCable, addConnection } = useRigStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [pointerMm, setPointerMm] = useState<{ x: number; y: number } | null>(null);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});

  const board = rig!.board;
  const layout = boardLayout(rig!, analysis);
  const { margin, vbW, vbH, offboard, originOf, ports: portAbs } = layout;
  const pxPerMm = view.zoom;

  const toMm = useCallback((e: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const snap = (v: number) => Math.round(v / board.grid_mm) * board.grid_mm;

  const used = new Set(rig!.connections.flatMap((c) => [`${c.source.instance_id}:${c.source.port_id}`, `${c.target.instance_id}:${c.target.port_id}`]));
  const compatible = (key: string): boolean => {
    if (!pendingCable) return false;
    const t = portAbs[key];
    if (!t || t.inst.id === pendingCable.instance_id) return false;
    if (t.port.kind !== pendingCable.kind) return false;
    const pd = pendingCable.direction;
    const td = t.port.direction;
    const okDir = pd === "bidirectional" ? true : pd === "out" ? td !== "out" : td !== "in";
    if (!okDir) return false;
    if (td === "in" && used.has(key)) return false; // one plug per input
    return true;
  };
  const finishCable = (targetKey: string) => {
    if (!pendingCable || !compatible(targetKey)) return;
    const t = portAbs[targetKey];
    const src = pendingCable.direction === "in" ? { instance_id: t.inst.id, port_id: t.port.port_id } : { instance_id: pendingCable.instance_id, port_id: pendingCable.port_id };
    const dst = pendingCable.direction === "in" ? { instance_id: pendingCable.instance_id, port_id: pendingCable.port_id } : { instance_id: t.inst.id, port_id: t.port.port_id };
    addConnection({ kind: pendingCable.kind, source: src, target: dst, label: null });
    setPendingCable(null);
  };

  const onPointerDownInstance = (e: React.PointerEvent, inst: DeviceInstance) => {
    e.stopPropagation();
    select(inst.id);
    if (inst.off_board) return;
    const p = toMm(e);
    setDrag({ id: inst.id, dx: p.x - inst.x_mm, dy: p.y - inst.y_mm });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = toMm(e);
    if (pendingCable) setPointerMm(p);
    if (!drag) return;
    let x = snap(p.x - drag.dx);
    let y = snap(p.y - drag.dy);
    // Edge alignment: snap to other devices' edges when within half a grid step.
    const me = analysis?.instances[drag.id];
    const tol = board.grid_mm / 2 + 0.01;
    const g: { x?: number; y?: number } = {};
    if (me) {
      for (const other of rig!.instances) {
        if (other.id === drag.id || other.off_board) continue;
        const og = analysis?.instances[other.id];
        if (!og) continue;
        for (const cx of [other.x_mm, other.x_mm + og.width_mm]) {
          if (Math.abs(x - cx) <= tol) { x = cx; g.x = cx; }
          if (Math.abs(x + me.width_mm - cx) <= tol) { x = cx - me.width_mm; g.x = cx; }
        }
        for (const cy of [other.y_mm, other.y_mm + og.height_mm]) {
          if (Math.abs(y - cy) <= tol) { y = cy; g.y = cy; }
          if (Math.abs(y + me.height_mm - cy) <= tol) { y = cy - me.height_mm; g.y = cy; }
        }
      }
    }
    setGuides(g);
    update((r) => {
      const i = r.instances.find((k) => k.id === drag.id);
      if (i && (i.x_mm !== x || i.y_mm !== y)) {
        i.x_mm = x;
        i.y_mm = y;
      }
    });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    setDrag(null);
    setGuides({});
    if (pendingCable) {
      const p = toMm(e);
      let best: { key: string; d: number } | null = null;
      for (const [key, v] of Object.entries(portAbs)) {
        if (!compatible(key)) continue;
        const d = Math.hypot(v.x - p.x, v.y - p.y);
        if (d <= DROP_RADIUS_MM && (!best || d < best.d)) best = { key, d };
      }
      if (best) finishCable(best.key);
      else setPendingCable(null);
      setPointerMm(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pendingCable) { setPendingCable(null); return; }
      if (!selectedInstanceId || (e.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return;
      if (e.ctrlKey || e.metaKey) return;
      const step = e.shiftKey ? board.grid_mm * 4 : board.grid_mm;
      const move = (dx: number, dy: number) =>
        update((r) => {
          const i = r.instances.find((k) => k.id === selectedInstanceId);
          if (i) { i.x_mm += dx; i.y_mm += dy; }
        });
      if (e.key === "ArrowLeft") move(-step, 0);
      else if (e.key === "ArrowRight") move(step, 0);
      else if (e.key === "ArrowUp") move(0, -step);
      else if (e.key === "ArrowDown") move(0, step);
      else if (e.key.toLowerCase() === "r") update((r) => { const i = r.instances.find((k) => k.id === selectedInstanceId); if (i) i.rotation = (((i.rotation + (e.shiftKey ? 270 : 90)) % 360) as Rotation); });
      else if (e.key === "Delete" || e.key === "Backspace") {
        const inst = rig?.instances.find((k) => k.id === selectedInstanceId);
        if (inst && window.confirm(`Remove "${inst.label}" and its cables from the rig?`)) removeInstance(inst.id);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedInstanceId, board.grid_mm, update, removeInstance, rig, pendingCable, setPendingCable]);

  const diagById = new Map<string, string[]>();
  for (const d of analysis?.diagnostics ?? []) if (d.subject_type === "instance" && d.subject_id) diagById.set(d.subject_id, [...(diagById.get(d.subject_id) ?? []), d.code]);
  const gridLines: number[] = [];
  for (let x = 0; x <= board.width_mm; x += board.grid_mm * 10) gridLines.push(x);
  const pendingFrom = pendingCable ? portAbs[`${pendingCable.instance_id}:${pendingCable.port_id}`] : null;
  const selectedInst = rig!.instances.find((i) => i.id === selectedInstanceId);
  const selGeo = selectedInst ? analysis?.instances[selectedInst.id] : null;

  return (
    <svg
      ref={svgRef}
      role="img"
      aria-label="Pedalboard layout"
      data-testid="board-canvas"
      viewBox={`0 0 ${vbW} ${vbH}`}
      width={vbW * pxPerMm}
      height={vbH * pxPerMm}
      className={`bg-neutral-50 border border-line rounded select-none touch-none ${pendingCable ? "cursor-crosshair" : ""}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerDown={() => select(null)}
    >
      <defs>
        <pattern id="grid" width={board.grid_mm * 2} height={board.grid_mm * 2} patternUnits="userSpaceOnUse" x={margin} y={margin}>
          <path d={`M ${board.grid_mm * 2} 0 L 0 0 0 ${board.grid_mm * 2}`} fill="none" stroke="#e5e7eb" strokeWidth={0.3} />
        </pattern>
      </defs>
      <rect x={margin} y={margin} width={board.width_mm} height={board.depth_mm} fill="url(#grid)" stroke="#111" strokeWidth={1.2} rx={2} />
      <text x={margin} y={margin - 8} fontSize={9} fill="#374151">{board.name} — {board.width_mm} × {board.depth_mm} mm (grid {board.grid_mm} mm)</text>
      {gridLines.map((x) => <text key={x} x={margin + x} y={margin + board.depth_mm + 10} fontSize={6} fill="#9ca3af" textAnchor="middle">{x}</text>)}
      {offboard.length > 0 && <text x={margin + board.width_mm + OFFBOARD_GAP} y={margin - 8} fontSize={8} fill="#6b7280">Off-board (not on the pedalboard)</text>}
      {guides.x !== undefined && <line x1={margin + guides.x} y1={margin} x2={margin + guides.x} y2={margin + board.depth_mm} stroke="#2563eb" strokeWidth={0.6} strokeDasharray="2 2" />}
      {guides.y !== undefined && <line x1={margin} y1={margin + guides.y} x2={margin + board.width_mm} y2={margin + guides.y} stroke="#2563eb" strokeWidth={0.6} strokeDasharray="2 2" />}
      {selectedInst && selGeo && !selectedInst.off_board && (
        <g fontSize={5.5} fill="#2563eb">
          <text x={margin + selectedInst.x_mm + selGeo.width_mm / 2} y={margin + selectedInst.y_mm - 2} textAnchor="middle">↔ {selGeo.width_mm} mm · x {selectedInst.x_mm}–{selectedInst.x_mm + selGeo.width_mm}</text>
          <text x={margin + selectedInst.x_mm - 2} y={margin + selectedInst.y_mm + selGeo.height_mm / 2} textAnchor="end">↕ {selGeo.height_mm} mm</text>
          <text x={margin + selectedInst.x_mm + selGeo.width_mm + 2} y={margin + selectedInst.y_mm + selGeo.height_mm / 2}>to right edge {Math.round(board.width_mm - selectedInst.x_mm - selGeo.width_mm)} mm</text>
        </g>
      )}
      {rig!.instances.map((inst) => {
        const geo = analysis?.instances[inst.id];
        const w = geo?.width_mm ?? 70;
        const h = geo?.height_mm ?? 120;
        const pos = originOf(inst);
        const codes = diagById.get(inst.id) ?? [];
        const bad = codes.some((c) => c === "instance.out_of_bounds" || c === "instance.collision");
        const selected = selectedInstanceId === inst.id;
        const profile = profiles[inst.profile_id];
        return (
          <g
            key={inst.id}
            tabIndex={0}
            role="button"
            aria-label={`${inst.label}, ${Math.round(w)} by ${Math.round(h)} mm at ${inst.x_mm}, ${inst.y_mm}`}
            onPointerDown={(e) => onPointerDownInstance(e, inst)}
            onClick={(e) => { e.stopPropagation(); select(inst.id); }}
            onFocus={() => select(inst.id)}
            className={inst.off_board ? "cursor-default" : "cursor-move"}
          >
            <rect x={pos.x} y={pos.y} width={w} height={h} rx={3}
              fill={enclosureFill(profile?.category, { placeholder: geo?.placeholder, offBoard: inst.off_board })}
              stroke={bad ? "#dc2626" : selected ? "#2563eb" : inst.off_board ? "#9ca3af" : "#374151"} strokeWidth={selected ? 1.6 : 0.8}
              strokeDasharray={inst.intentional_overlap || geo?.placeholder || inst.off_board ? "3 2" : undefined} />
            <text x={pos.x + 3} y={pos.y + 9} fontSize={Math.min(8, w / 8)} fontWeight={600} fill="#111">{inst.label}</text>
            <text x={pos.x + 3} y={pos.y + 17} fontSize={5} fill="#4b5563">{geo?.placeholder ? "size unknown (placeholder)" : `${Math.round(w)} × ${Math.round(h)} mm`} · {inst.rotation}°</text>
          </g>
        );
      })}
      {/* Cables between actual jack positions */}
      {rig!.connections.filter((c) => view.cableKinds.has(c.kind)).map((c) => {
        const a = portAbs[`${c.source.instance_id}:${c.source.port_id}`];
        const b = portAbs[`${c.target.instance_id}:${c.target.port_id}`];
        if (!a || !b) return null;
        return (
          <path key={c.id} d={layout.cablePath(a, b)} fill="none" stroke={KIND_COLOR[c.kind]} strokeWidth={1.1} strokeOpacity={0.75} pointerEvents="none">
            <title>{c.label ?? `${a.inst.label}: ${a.port.label} → ${b.inst.label}: ${b.port.label}`}</title>
          </path>
        );
      })}
      {/* Ports (drawn last so they stay clickable above cables) */}
      {Object.entries(portAbs).map(([key, v]) => {
        const p = v.port;
        const clear = p.plug_clearance_mm ?? 0;
        const dir = p.edge === "top" ? [0, -1] : p.edge === "bottom" ? [0, 1] : p.edge === "left" ? [-1, 0] : p.edge === "right" ? [1, 0] : [0, 0];
        const isCompat = compatible(key);
        const isOrigin = pendingCable?.instance_id === v.inst.id && pendingCable?.port_id === p.port_id;
        const crowdedDevice = (analysis?.instances[v.inst.id]?.ports.length ?? 0) > 12;
        const showLabel = view.showLabels || (v.inst.id === selectedInstanceId && !crowdedDevice) || isCompat || isOrigin;
        const lx = v.x + dir[0] * 4;
        const ly = v.y + dir[1] * 4 + (dir[1] === 0 ? 2 : dir[1] < 0 ? -1 : 5);
        return (
          <g key={key}>
            {view.showClearance && clear > 0 && (dir[0] !== 0 || dir[1] !== 0) && (
              <line x1={v.x} y1={v.y} x2={v.x + dir[0] * clear} y2={v.y + dir[1] * clear} stroke={KIND_COLOR[p.kind]} strokeWidth={1.2} strokeOpacity={0.25} strokeDasharray={p.estimated ? "1.5 1.5" : undefined} />
            )}
            <circle
              cx={v.x} cy={v.y} r={isCompat ? 4 : 2.6}
              fill={KIND_COLOR[p.kind]} stroke={isCompat || isOrigin ? "#111" : "#fff"} strokeWidth={isCompat ? 1.2 : 0.6}
              strokeDasharray={p.estimated && !isCompat ? "1 1" : undefined}
              opacity={pendingCable && !isCompat && !isOrigin ? 0.35 : 1}
              className="cursor-crosshair"
              data-testid={`port-${v.inst.id}-${p.port_id}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                select(v.inst.id);
                if (p.direction === "in" && used.has(key)) return; // an input already has its one plug
                setPendingCable({ instance_id: v.inst.id, port_id: p.port_id, kind: p.kind, direction: p.direction });
                setPointerMm({ x: v.x, y: v.y });
              }}
              onPointerUp={(e) => { if (pendingCable) { e.stopPropagation(); finishCable(key); setPointerMm(null); } }}
            >
              <title>{`${v.inst.label}: ${p.label} (${p.kind} ${p.direction})${p.estimated ? " — position estimated" : ""}${used.has(key) ? " — cabled" : ""}`}</title>
            </circle>
            {showLabel && (
              <text x={lx} y={ly} fontSize={4.2} fill="#1f2937" textAnchor={dir[0] < 0 ? "end" : dir[0] > 0 ? "start" : "middle"} pointerEvents="none">{p.label}</text>
            )}
          </g>
        );
      })}
      {pendingFrom && pointerMm && (
        <line x1={pendingFrom.x} y1={pendingFrom.y} x2={pointerMm.x} y2={pointerMm.y} stroke={KIND_COLOR[pendingCable!.kind]} strokeWidth={1.2} strokeDasharray="3 2" pointerEvents="none" />
      )}
    </svg>
  );
}
