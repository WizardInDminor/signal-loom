"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRigStore } from "@/store/rigStore";
import type { DeviceInstance, Rotation, SignalKind, Surface } from "@/lib/types";
import { KIND_COLOR } from "@/components/ui/basics";
import { OFFBOARD_GAP, boardLayout, boardViewBox, enclosureFill } from "@/lib/boardLayout";
import { DeviceImageGlyph } from "@/components/images/DeviceImageGlyph";
import { surfaceOf } from "@/lib/mounting";

export { boardViewBox };

const DROP_RADIUS_MM = 9;

export interface BoardViewOptions {
  zoom: number;
  cableKinds: Set<SignalKind>;
  showLabels: boolean;
  showClearance: boolean;
  /** Which board surface is being edited; off-board devices show in both views. */
  surface: "top" | "underside";
  /** Draw the other surface's devices as faint ghosts for reference (never interactive). */
  showGhosts: boolean;
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
  const under = view.surface === "underside";
  const spec = analysis?.mounting?.spec ?? null;
  // A device is editable when it sits on the surface being viewed; off-board devices are always
  // shown (they belong to neither surface); the other surface's devices are ghosts or hidden.
  const onView = (inst: DeviceInstance): boolean => { const sf = surfaceOf(inst); return sf === view.surface || sf === "off_board"; };
  const visible = (id: string): boolean => { const i = rig!.instances.find((k) => k.id === id); return !!i && onView(i); };
  const otherSurface: Surface = under ? "top" : "underside";
  const visiblePorts = Object.fromEntries(Object.entries(portAbs).filter(([, v]) => onView(v.inst)));

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
    const t = visiblePorts[key];
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
    if (surfaceOf(inst) !== view.surface) return;
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
        if (other.id === drag.id || surfaceOf(other) !== view.surface) continue; // snap to neighbours on this surface only
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
      for (const [key, v] of Object.entries(visiblePorts)) {
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
  const pendingFrom = pendingCable ? visiblePorts[`${pendingCable.instance_id}:${pendingCable.port_id}`] : null;
  const selectedInst = rig!.instances.find((i) => i.id === selectedInstanceId);
  const selGeo = selectedInst ? analysis?.instances[selectedInst.id] : null;
  const ghosts = view.showGhosts ? rig!.instances.filter((i) => surfaceOf(i) === otherSurface) : [];
  const clearance = analysis?.mounting?.clearance_mm ?? null;
  // A short stub shows that a cable continues to the other surface; where it passes the board is
  // not known, so nothing longer is drawn.
  const stub = (v: { x: number; y: number; port: { edge: string } }) => {
    const d = v.port.edge === "top" ? [0, -1] : v.port.edge === "bottom" ? [0, 1] : v.port.edge === "left" ? [-1, 0] : v.port.edge === "right" ? [1, 0] : [0, -1];
    return { x: v.x + d[0] * 14, y: v.y + d[1] * 14 };
  };

  return (
    <svg
      ref={svgRef}
      role="img"
      aria-label="Pedalboard layout"
      data-testid="board-canvas"
      viewBox={`0 0 ${vbW} ${vbH}`}
      width={vbW * pxPerMm}
      height={vbH * pxPerMm}
      className={`bg-[#fafafa] border border-line rounded select-none touch-none ${pendingCable ? "cursor-crosshair" : ""}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerDown={() => select(null)}
    >
      <defs>
        <pattern id="grid" width={board.grid_mm * 2} height={board.grid_mm * 2} patternUnits="userSpaceOnUse" x={margin} y={margin}>
          <path d={`M ${board.grid_mm * 2} 0 L 0 0 0 ${board.grid_mm * 2}`} fill="none" stroke="#e5e7eb" strokeWidth={0.3} />
        </pattern>
      </defs>
      <rect x={margin} y={margin} width={board.width_mm} height={board.depth_mm} fill={under ? "#e2e8f0" : "url(#grid)"} stroke="#111" strokeWidth={1.2} rx={2} data-testid="board-surface" data-surface={view.surface} />
      {under && (
        <g pointerEvents="none" data-testid="underside-frame">
          {/* The frame as a frame: a second outline inside the perimeter; rails are drawn only when their
              spacing is documented (never for a count alone), so nothing here invents geometry. */}
          <rect x={margin} y={margin} width={board.width_mm} height={board.depth_mm} fill="url(#grid)" opacity={0.5} rx={2} />
          <rect x={margin + 6} y={margin + 6} width={Math.max(0, board.width_mm - 12)} height={Math.max(0, board.depth_mm - 12)} fill="none" stroke="#475569" strokeWidth={0.8} strokeDasharray="4 3" rx={2} />
          {spec?.rail_pitch.value_mm != null && spec.rails ? Array.from({ length: spec.rails }, (_, i) => margin + (board.depth_mm - (spec.rails! - 1) * spec.rail_pitch.value_mm!) / 2 + i * spec.rail_pitch.value_mm!).map((y) => (
            <line key={y} x1={margin} y1={y} x2={margin + board.width_mm} y2={y} stroke="#334155" strokeWidth={3} opacity={0.35} />
          )) : null}
          {spec?.open_front && <line x1={margin + 10} y1={margin + board.depth_mm} x2={margin + board.width_mm - 10} y2={margin + board.depth_mm} stroke="#f59e0b" strokeWidth={2.2} />}
          {spec?.open_front && <text x={margin + board.width_mm / 2} y={margin + board.depth_mm - 3} fontSize={5} fill="#b45309" textAnchor="middle">open front (player side)</text>}
          <text x={margin + board.width_mm / 2} y={margin + board.depth_mm / 2} fontSize={9} fill="#475569" textAnchor="middle" opacity={0.6}>UNDERSIDE · seen through the board from above (not mirrored)</text>
          <text x={margin + board.width_mm / 2} y={margin + board.depth_mm / 2 + 11} fontSize={6} fill="#64748b" textAnchor="middle" opacity={0.8}>
            {spec ? `${spec.manufacturer} ${spec.model}${spec.rails ? ` · ${spec.rails} rails${spec.rail_pitch.value_mm == null ? " (spacing unverified)" : ""}` : ""}` : "custom board"}
            {" · clearance "}{clearance != null ? `${clearance} mm (${analysis?.mounting?.clearance_source === "user" ? "your measurement" : analysis?.mounting?.clearance_source})` : "unverified"}
          </text>
        </g>
      )}
      <text x={margin} y={margin - 8} fontSize={9} fill="#374151">{board.name} — {board.width_mm} × {board.depth_mm} mm (grid {board.grid_mm} mm){under ? " — UNDERSIDE" : ""}</text>
      {gridLines.map((x) => <text key={x} x={margin + x} y={margin + board.depth_mm + 10} fontSize={6} fill="#6b7280" textAnchor="middle">{x}</text>)}
      {offboard.length > 0 && <text x={margin + board.width_mm + OFFBOARD_GAP} y={margin - 8} fontSize={8} fill="#6b7280">Off-board (not on the pedalboard)</text>}
      {guides.x !== undefined && <line x1={margin + guides.x} y1={margin} x2={margin + guides.x} y2={margin + board.depth_mm} stroke="#2563eb" strokeWidth={0.6} strokeDasharray="2 2" />}
      {guides.y !== undefined && <line x1={margin} y1={margin + guides.y} x2={margin + board.width_mm} y2={margin + guides.y} stroke="#2563eb" strokeWidth={0.6} strokeDasharray="2 2" />}
      {/* the other surface, for reference only */}
      {ghosts.map((inst) => {
        const geo = analysis?.instances[inst.id];
        const w = geo?.width_mm ?? 70;
        const h = geo?.height_mm ?? 120;
        const pos = originOf(inst);
        return (
          <g key={`ghost-${inst.id}`} pointerEvents="none" opacity={0.28} data-testid={`ghost-${inst.id}`}>
            <rect x={pos.x} y={pos.y} width={w} height={h} rx={3} fill="none" stroke="#475569" strokeWidth={0.8} strokeDasharray="2 2" />
            <text x={pos.x + 3} y={pos.y + 9} fontSize={Math.min(8, w / 8)} fontWeight={600} fill="#334155">{inst.label}</text>
            <text x={pos.x + 3} y={pos.y + 17} fontSize={5} fill="#475569">{under ? "on top" : "underneath"}</text>
          </g>
        );
      })}
      {selectedInst && selGeo && surfaceOf(selectedInst) === view.surface && (
        <g fontSize={5.5} fill="#2563eb">
          <text x={margin + selectedInst.x_mm + selGeo.width_mm / 2} y={margin + selectedInst.y_mm - 2} textAnchor="middle">↔ {selGeo.width_mm} mm · x {selectedInst.x_mm}–{selectedInst.x_mm + selGeo.width_mm}</text>
          <text x={margin + selectedInst.x_mm - 2} y={margin + selectedInst.y_mm + selGeo.height_mm / 2} textAnchor="end">↕ {selGeo.height_mm} mm</text>
          <text x={margin + selectedInst.x_mm + selGeo.width_mm + 2} y={margin + selectedInst.y_mm + selGeo.height_mm / 2}>to right edge {Math.round(board.width_mm - selectedInst.x_mm - selGeo.width_mm)} mm</text>
        </g>
      )}
      {rig!.instances.filter(onView).map((inst) => {
        const geo = analysis?.instances[inst.id];
        const w = geo?.width_mm ?? 70;
        const h = geo?.height_mm ?? 120;
        const pos = originOf(inst);
        const codes = diagById.get(inst.id) ?? [];
        const bad = codes.some((c) => c === "instance.out_of_bounds" || c === "instance.collision" || c === "instance.underside_too_tall" || c === "instance.underside_unavailable");
        const unverified = codes.some((c) => c === "instance.underside_clearance_unverified" || c === "instance.underside_height_unknown");
        const selected = selectedInstanceId === inst.id;
        const profile = profiles[inst.profile_id];
        const sf = surfaceOf(inst);
        const offBoard = sf === "off_board";
        return (
          <g
            key={inst.id}
            tabIndex={0}
            role="button"
            aria-label={`${inst.label}, ${Math.round(w)} by ${Math.round(h)} mm at ${inst.x_mm}, ${inst.y_mm}${sf === "underside" ? " (underside)" : offBoard ? " (off-board)" : ""}`}
            data-surface={sf}
            onPointerDown={(e) => onPointerDownInstance(e, inst)}
            onClick={(e) => { e.stopPropagation(); select(inst.id); }}
            onFocus={() => select(inst.id)}
            className={offBoard ? "cursor-default" : "cursor-move"}
          >
            <rect x={pos.x} y={pos.y} width={w} height={h} rx={3}
              fill={enclosureFill(profile?.category, { placeholder: geo?.placeholder, offBoard })} />
            {geo?.image && !geo.image.missing && <DeviceImageGlyph x={pos.x} y={pos.y} w={w} h={h} rotation={inst.rotation} image={geo.image} clipId={`clip-board-${inst.id}`} />}
            <rect x={pos.x} y={pos.y} width={w} height={h} rx={3} fill="none"
              stroke={bad ? "#dc2626" : selected ? "#2563eb" : unverified ? "#d97706" : offBoard ? "#9ca3af" : "#374151"} strokeWidth={selected ? 1.6 : 0.8}
              strokeDasharray={inst.intentional_overlap || geo?.placeholder || offBoard ? "3 2" : undefined} />
            {sf === "underside" && geo?.tall_mm != null && <text x={pos.x + w - 3} y={pos.y + h - 3} fontSize={5} fill={bad ? "#dc2626" : unverified ? "#b45309" : "#475569"} textAnchor="end">{geo.tall_mm} mm tall{clearance != null ? ` / ${clearance} mm` : " · clearance unverified"}</text>}
            {/* label chip keeps the name legible on a photograph */}
            {geo?.image && !geo.image.missing && <rect x={pos.x + 1.5} y={pos.y + 2} width={Math.min(w - 3, inst.label.length * Math.min(8, w / 8) * 0.62 + 4)} height={Math.min(8, w / 8) + 10} rx={1.5} fill="#fff" opacity={0.82} />}
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
        const av = visible(a.inst.id);
        const bv = visible(b.inst.id);
        if (av && bv) {
          return (
            <path key={c.id} d={layout.cablePath(a, b)} fill="none" stroke={KIND_COLOR[c.kind]} strokeWidth={1.1} strokeOpacity={0.75} pointerEvents="none">
              <title>{c.label ?? `${a.inst.label}: ${a.port.label} → ${b.inst.label}: ${b.port.label}`}</title>
            </path>
          );
        }
        if (!av && !bv) return null;
        // One end is on the other surface: a stub and a marker, no invented route.
        const v = av ? a : b;
        const far = av ? b : a;
        const e = stub(v);
        return (
          <g key={c.id} pointerEvents="none" data-testid={`cable-stub-${c.id}`}>
            <path d={`M ${v.x} ${v.y} L ${e.x} ${e.y}`} fill="none" stroke={KIND_COLOR[c.kind]} strokeWidth={1.1} strokeOpacity={0.75} strokeDasharray="2 1.5" />
            <circle cx={e.x} cy={e.y} r={2.4} fill="#fff" stroke={KIND_COLOR[c.kind]} strokeWidth={1} />
            <text x={e.x} y={e.y + 1.6} fontSize={3.6} textAnchor="middle" fill={KIND_COLOR[c.kind]} fontWeight={700}>{under ? "↥" : "↧"}</text>
            <title>{`${c.label ?? c.kind} continues ${under ? "up to" : "down to"} ${far.inst.label}: ${far.port.label} (${under ? "on top" : "under the board"}); where it passes the board is not modelled`}</title>
          </g>
        );
      })}
      {/* Ports (drawn last so they stay clickable above cables) */}
      {Object.entries(visiblePorts).map(([key, v]) => {
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
