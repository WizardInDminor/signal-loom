"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRigStore } from "@/store/rigStore";
import type { DeviceInstance, Rotation } from "@/lib/types";
import { KIND_COLOR } from "@/components/ui/basics";

const OFFBOARD_GAP = 40;

export function BoardCanvas({ zoom }: { zoom: number }) {
  const { rig, analysis, selectedInstanceId, select, update, removeInstance } = useRigStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);

  const board = rig!.board;
  const offboard = rig!.instances.filter((i) => i.off_board);
  const margin = 30;
  const offboardWidth = offboard.length ? 200 : 0;
  const vbW = board.width_mm + margin * 2 + offboardWidth + (offboard.length ? OFFBOARD_GAP : 0);
  const vbH = Math.max(board.depth_mm, offboard.reduce((acc, i) => acc + (analysis?.instances[i.id]?.height_mm ?? 60) + 20, 0)) + margin * 2;
  const pxPerMm = zoom;

  const toMm = useCallback((e: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const snap = (v: number) => Math.round(v / board.grid_mm) * board.grid_mm;

  const onPointerDown = (e: React.PointerEvent, inst: DeviceInstance) => {
    e.stopPropagation();
    select(inst.id);
    const p = toMm(e);
    setDrag({ id: inst.id, dx: p.x - inst.x_mm, dy: p.y - inst.y_mm });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toMm(e);
    const x = snap(p.x - drag.dx);
    const y = snap(p.y - drag.dy);
    update((r) => {
      const i = r.instances.find((k) => k.id === drag.id);
      if (i && (i.x_mm !== x || i.y_mm !== y)) {
        i.x_mm = x;
        i.y_mm = y;
      }
    });
  };
  const onPointerUp = () => setDrag(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedInstanceId || (e.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return;
      const step = e.shiftKey ? board.grid_mm * 4 : board.grid_mm;
      const move = (dx: number, dy: number) =>
        update((r) => {
          const i = r.instances.find((k) => k.id === selectedInstanceId);
          if (i) {
            i.x_mm += dx;
            i.y_mm += dy;
          }
        });
      if (e.key === "ArrowLeft") move(-step, 0);
      else if (e.key === "ArrowRight") move(step, 0);
      else if (e.key === "ArrowUp") move(0, -step);
      else if (e.key === "ArrowDown") move(0, step);
      else if (e.key.toLowerCase() === "r") update((r) => { const i = r.instances.find((k) => k.id === selectedInstanceId); if (i) i.rotation = (((i.rotation + 90) % 360) as Rotation); });
      else if (e.key === "Delete" || e.key === "Backspace") {
        const inst = rig?.instances.find((k) => k.id === selectedInstanceId);
        if (inst && window.confirm(`Remove "${inst.label}" and its cables from the rig?`)) removeInstance(inst.id);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedInstanceId, board.grid_mm, update, removeInstance, rig]);

  const diagById = new Map<string, string[]>();
  for (const d of analysis?.diagnostics ?? []) if (d.subject_type === "instance" && d.subject_id) diagById.set(d.subject_id, [...(diagById.get(d.subject_id) ?? []), d.code]);

  let offY = margin;
  const offboardPos: Record<string, { x: number; y: number }> = {};
  for (const i of offboard) {
    offboardPos[i.id] = { x: margin + board.width_mm + OFFBOARD_GAP, y: offY };
    offY += (analysis?.instances[i.id]?.height_mm ?? 60) + 20;
  }

  const gridLines: number[] = [];
  for (let x = 0; x <= board.width_mm; x += board.grid_mm * 10) gridLines.push(x);

  return (
    <svg
      ref={svgRef}
      role="img"
      aria-label="Pedalboard layout"
      viewBox={`0 0 ${vbW} ${vbH}`}
      width={vbW * pxPerMm}
      height={vbH * pxPerMm}
      className="bg-neutral-50 border border-line rounded select-none touch-none"
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
      {gridLines.map((x) => (
        <text key={x} x={margin + x} y={margin + board.depth_mm + 10} fontSize={6} fill="#9ca3af" textAnchor="middle">{x}</text>
      ))}
      {offboard.length > 0 && (
        <text x={margin + board.width_mm + OFFBOARD_GAP} y={margin - 8} fontSize={8} fill="#6b7280">Off-board</text>
      )}
      {rig!.instances.map((inst) => {
        const geo = analysis?.instances[inst.id];
        const w = geo?.width_mm ?? 70;
        const h = geo?.height_mm ?? 120;
        const pos = inst.off_board ? offboardPos[inst.id] : { x: margin + inst.x_mm, y: margin + inst.y_mm };
        const codes = diagById.get(inst.id) ?? [];
        const bad = codes.some((c) => c === "instance.out_of_bounds" || c === "instance.collision");
        const selected = selectedInstanceId === inst.id;
        const profile = useRigStore.getState().profiles[inst.profile_id];
        const dx = pos.x - (inst.off_board ? 0 : inst.x_mm);
        const dy = pos.y - (inst.off_board ? 0 : inst.y_mm);
        return (
          <g
            key={inst.id}
            tabIndex={0}
            role="button"
            aria-label={`${inst.label}, ${Math.round(w)} by ${Math.round(h)} mm at ${inst.x_mm}, ${inst.y_mm}`}
            onPointerDown={(e) => !inst.off_board && onPointerDown(e, inst)}
            onClick={(e) => { e.stopPropagation(); select(inst.id); }}
            onFocus={() => select(inst.id)}
            className={inst.off_board ? "cursor-default" : "cursor-move"}
          >
            <rect
              x={pos.x}
              y={pos.y}
              width={w}
              height={h}
              rx={3}
              fill={geo?.placeholder ? "#fef3c7" : profile?.category === "controller" ? "#e0e7ff" : profile?.category === "switcher" ? "#dcfce7" : profile?.category === "power_supply" ? "#fee2e2" : "#f3f4f6"}
              stroke={bad ? "#dc2626" : selected ? "#2563eb" : "#374151"}
              strokeWidth={selected ? 1.6 : 0.8}
              strokeDasharray={inst.intentional_overlap || geo?.placeholder ? "3 2" : undefined}
            />
            <text x={pos.x + 3} y={pos.y + 9} fontSize={Math.min(8, w / 8)} fontWeight={600} fill="#111">{inst.label}</text>
            <text x={pos.x + 3} y={pos.y + 17} fontSize={5} fill="#4b5563">
              {geo?.placeholder ? "size unknown (placeholder)" : `${Math.round(w)} × ${Math.round(h)} mm`} · {inst.rotation}°
            </text>
            {geo?.ports.map((p) => {
              const px = p.x_mm + dx;
              const py = p.y_mm + dy;
              const clear = p.plug_clearance_mm ?? 0;
              const dir = p.edge === "top" ? [0, -1] : p.edge === "bottom" ? [0, 1] : p.edge === "left" ? [-1, 0] : p.edge === "right" ? [1, 0] : [0, 0];
              return (
                <g key={p.port_id}>
                  {clear > 0 && dir[0] + dir[1] !== 0 && (
                    <line x1={px} y1={py} x2={px + dir[0] * clear} y2={py + dir[1] * clear} stroke={KIND_COLOR[p.kind]} strokeWidth={1.2} strokeOpacity={0.25} strokeDasharray={p.estimated ? "1.5 1.5" : undefined} />
                  )}
                  <circle cx={px} cy={py} r={2.2} fill={KIND_COLOR[p.kind]} stroke="#fff" strokeWidth={0.6} strokeDasharray={p.estimated ? "1 1" : undefined}>
                    <title>{`${inst.label}: ${p.label} (${p.kind} ${p.direction})${p.estimated ? " — position estimated" : ""}`}</title>
                  </circle>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
