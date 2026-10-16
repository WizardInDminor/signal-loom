"use client";

import { useRef, useState } from "react";
import type { Edge, PortDef } from "@/lib/types";
import { KIND_COLOR } from "@/components/ui/basics";

/**
 * Top-down outline of a device with its jacks; drag a jack to move it along an edge (or to
 * another edge). Positions are normalized 0..1 along the edge, exactly as stored on the profile
 * or instance override, so the board, the wiring views and the exports all see the same jack.
 */
export function JackEditor({
  widthMm,
  depthMm,
  ports,
  onChange,
  selectedId,
  onSelect,
  maxWidthPx = 300,
}: {
  widthMm: number;
  depthMm: number;
  ports: PortDef[];
  onChange: (port: PortDef) => void;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  maxWidthPx?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; edge: Edge; t: number } | null>(null);
  const pad = 24;
  // On crowded edges (e.g. the ML10X's 28 top jacks) only the selected jack gets a label;
  // every jack still has a hover tooltip.
  const perEdge: Record<string, number> = {};
  for (const p of ports) perEdge[p.edge] = (perEdge[p.edge] ?? 0) + 1;
  const crowded = (edge: Edge) => (perEdge[edge] ?? 0) > 8;
  const scale = Math.min(maxWidthPx / (widthMm + pad * 2), 220 / (depthMm + pad * 2));
  const W = (widthMm + pad * 2) * scale;
  const H = (depthMm + pad * 2) * scale;
  const toPx = (mm: number) => mm * scale;

  const place = (p: PortDef, edge = p.edge, t = p.position) => {
    const tt = t ?? 0.5;
    switch (edge) {
      case "top": return { x: pad + widthMm * tt, y: pad };
      case "bottom": return { x: pad + widthMm * tt, y: pad + depthMm };
      case "left": return { x: pad, y: pad + depthMm * tt };
      case "right": return { x: pad + widthMm, y: pad + depthMm * tt };
      default: return { x: pad + widthMm * tt, y: pad + depthMm / 2 };
    }
  };

  const toMm = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x / scale, y: p.y / scale };
  };

  const nearestEdge = (x: number, y: number): { edge: Edge; t: number } => {
    const lx = x - pad;
    const ly = y - pad;
    const cands: { edge: Edge; d: number; t: number }[] = [
      { edge: "top", d: Math.abs(ly), t: lx / widthMm },
      { edge: "bottom", d: Math.abs(ly - depthMm), t: lx / widthMm },
      { edge: "left", d: Math.abs(lx), t: ly / depthMm },
      { edge: "right", d: Math.abs(lx - widthMm), t: ly / depthMm },
    ];
    cands.sort((a, b) => a.d - b.d);
    const best = cands[0];
    return { edge: best.edge, t: Math.round(Math.min(1, Math.max(0, best.t)) * 100) / 100 };
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const { x, y } = toMm(e);
    const n = nearestEdge(x, y);
    if (n.edge !== drag.edge || n.t !== drag.t) setDrag({ ...drag, ...n });
  };
  const onUp = () => {
    if (!drag) return;
    const port = ports.find((p) => p.id === drag.id);
    if (port && (port.edge !== drag.edge || port.position !== drag.t)) onChange({ ...port, edge: drag.edge, position: drag.t, position_evidence: "user" });
    setDrag(null);
  };

  return (
    <svg
      ref={svgRef}
      role="img"
      aria-label="Jack position editor"
      data-testid="jack-editor"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className="bg-white border border-line rounded select-none touch-none"
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
    >
      <rect x={toPx(pad)} y={toPx(pad)} width={toPx(widthMm)} height={toPx(depthMm)} fill="#f3f4f6" stroke="#374151" strokeWidth={1} rx={3} />
      <text x={toPx(pad) + 4} y={toPx(pad) + 11} fontSize={9} fill="#6b7280">{Math.round(widthMm * 10) / 10} × {Math.round(depthMm * 10) / 10} mm · top edge = away from player</text>
      {selectedId && ports.some((p) => p.id === selectedId) && (
        <text x={toPx(pad) + 4} y={toPx(pad) + 22} fontSize={9} fill="#2563eb">selected: {ports.find((p) => p.id === selectedId)!.label}</text>
      )}
      {ports.map((p, idx) => {
        const live = drag?.id === p.id ? place(p, drag.edge, drag.t) : place(p);
        const sel = selectedId === p.id;
        const unknown = p.position == null && drag?.id !== p.id;
        // Stagger labels on crowded edges so neighbours stay legible.
        const stagger = (idx % 2) * 9;
        const dx = p.edge === "left" ? -8 - stagger : p.edge === "right" ? 8 + stagger : 0;
        const dy = p.edge === "top" ? -8 - stagger : p.edge === "bottom" ? 12 + stagger : 0;
        return (
          <g key={p.id} className="cursor-grab" onPointerDown={(e) => { e.stopPropagation(); onSelect?.(p.id); setDrag({ id: p.id, edge: p.edge, t: p.position ?? 0.5 }); }}>
            <circle cx={toPx(live.x)} cy={toPx(live.y)} r={sel ? 7 : 5.5} fill={KIND_COLOR[p.kind]} stroke={sel ? "#111" : "#fff"} strokeWidth={sel ? 2 : 1} strokeDasharray={unknown ? "2 2" : undefined} data-testid={`jack-${p.id}`}>
              <title>{`${p.label} (${p.kind} ${p.direction})${unknown ? " — position unknown; drag to set" : ""}`}</title>
            </circle>
            {(!crowded(p.edge) || sel) && (
              <text x={toPx(live.x) + dx} y={toPx(live.y) + dy + 3} fontSize={8} fontWeight={sel ? 600 : 400} textAnchor={p.edge === "left" ? "end" : p.edge === "right" ? "start" : "middle"} fill="#374151">{p.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
