// Board geometry shared by the Board canvas and the Stage: where each device and each jack sits
// in drawing space (mm, including the margin), and how a cable between two jacks is bent.
// Keeping this in one place guarantees the Stage overlays a path exactly on the cable the
// Board draws.

import type { Analysis, DeviceInstance, PlacedPort, Rig } from "./types";

export const OFFBOARD_GAP = 40;
export const BOARD_MARGIN = 30;

export interface PortAt {
  x: number;
  y: number;
  port: PlacedPort;
  inst: DeviceInstance;
}

export function boardViewBox(rig: Rig, analysis: Analysis | null) {
  const margin = BOARD_MARGIN;
  const offboard = rig.instances.filter((i) => i.off_board);
  const offboardWidth = offboard.length ? 200 : 0;
  const vbW = rig.board.width_mm + margin * 2 + offboardWidth + (offboard.length ? OFFBOARD_GAP : 0);
  const vbH = Math.max(rig.board.depth_mm, offboard.reduce((acc, i) => acc + (analysis?.instances[i.id]?.height_mm ?? 60) + 20, 0)) + margin * 2;
  return { margin, vbW, vbH, offboard };
}

export interface BoardLayout {
  margin: number;
  vbW: number;
  vbH: number;
  offboard: DeviceInstance[];
  /** Drawing-space origin (top-left) of every instance. */
  originOf: (inst: DeviceInstance) => { x: number; y: number };
  /** Drawing-space position of every placed jack, keyed `${instance_id}:${port_id}`. */
  ports: Record<string, PortAt>;
  /**
   * SVG path for a cable between two jacks. A cable leaves a jack perpendicular to the edge the
   * jack sits on (as a real patch lead does, plug first) and curves to the other jack; jacks on
   * the top face, which have no edge normal, bend gently towards the board centre instead.
   */
  cablePath: (a: CableEnd, b: CableEnd) => string;
  /** A hop inside one device (a switcher's internal routing): an arc dipping into the enclosure. */
  internalPath: (a: CableEnd, b: CableEnd) => string;
}

export type CableEnd = { x: number; y: number; port?: { edge: string } ; inst?: DeviceInstance };

function edgeNormal(edge: string | undefined): [number, number] | null {
  return edge === "top" ? [0, -1] : edge === "bottom" ? [0, 1] : edge === "left" ? [-1, 0] : edge === "right" ? [1, 0] : null;
}

export function boardLayout(rig: Rig, analysis: Analysis | null): BoardLayout {
  const { margin, vbW, vbH, offboard } = boardViewBox(rig, analysis);
  const board = rig.board;
  let offY = margin;
  const offboardPos: Record<string, { x: number; y: number }> = {};
  for (const i of offboard) {
    offboardPos[i.id] = { x: margin + board.width_mm + OFFBOARD_GAP, y: offY };
    offY += (analysis?.instances[i.id]?.height_mm ?? 60) + 20;
  }
  const originOf = (inst: DeviceInstance) => (inst.off_board ? offboardPos[inst.id] : { x: margin + inst.x_mm, y: margin + inst.y_mm });
  const ports: Record<string, PortAt> = {};
  for (const inst of rig.instances) {
    const geo = analysis?.instances[inst.id];
    if (!geo) continue;
    const o = originOf(inst);
    const base = inst.off_board ? { x: 0, y: 0 } : { x: inst.x_mm, y: inst.y_mm };
    for (const p of geo.ports) ports[`${inst.id}:${p.port_id}`] = { x: o.x + (p.x_mm - base.x), y: o.y + (p.y_mm - base.y), port: p, inst };
  }
  const cx = margin + board.width_mm / 2;
  const cy = margin + board.depth_mm / 2;
  const towardsCentre = (pt: { x: number; y: number }, k: number) => {
    const d = Math.hypot(cx - pt.x, cy - pt.y) || 1;
    return { x: pt.x + ((cx - pt.x) / d) * k, y: pt.y + ((cy - pt.y) / d) * k };
  };
  const cablePath = (a: CableEnd, b: CableEnd) => {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const k = Math.max(10, Math.min(28, dist / 3));
    const na = edgeNormal(a.port?.edge);
    const nb = edgeNormal(b.port?.edge);
    const c1 = na ? { x: a.x + na[0] * k, y: a.y + na[1] * k } : towardsCentre(a, Math.min(25, dist / 5));
    const c2 = nb ? { x: b.x + nb[0] * k, y: b.y + nb[1] * k } : towardsCentre(b, Math.min(25, dist / 5));
    return `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
  };
  const internalPath = (a: CableEnd, b: CableEnd) => {
    const inst = a.inst ?? b.inst;
    const geo = inst ? analysis?.instances[inst.id] : null;
    if (!inst || !geo) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    const o = originOf(inst);
    const centre = { x: o.x + geo.width_mm / 2, y: o.y + geo.height_mm / 2 };
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const depth = Math.min(geo.height_mm, geo.width_mm) * 0.45;
    const d = Math.hypot(centre.x - mx, centre.y - my) || 1;
    return `M ${a.x} ${a.y} Q ${mx + ((centre.x - mx) / d) * depth} ${my + ((centre.y - my) / d) * depth} ${b.x} ${b.y}`;
  };
  return { margin, vbW, vbH, offboard, originOf, ports, cablePath, internalPath };
}

/** Enclosure tint per device category: shared by the Board and the Stage so devices look the same everywhere. */
export function enclosureFill(category: string | undefined, opts: { placeholder?: boolean; offBoard?: boolean } = {}): string {
  if (opts.placeholder) return "#fef3c7";
  if (category === "controller") return "#e0e7ff";
  if (category === "switcher") return "#dcfce7";
  if (category === "power_supply") return "#fee2e2";
  if (opts.offBoard) return "#f8fafc";
  return "#f3f4f6";
}
