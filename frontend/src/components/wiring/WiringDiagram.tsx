"use client";

import { useRigStore } from "@/store/rigStore";
import { KIND_COLOR } from "@/components/ui/basics";

/** Column layout: instruments → switcher/pedals → amps, with ports as rows. Pure SVG, no library. */
export function WiringDiagram({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const { rig, analysis, profiles, pendingCable, setPendingCable, addConnection } = useRigStore();
  if (!rig) return null;
  const used = new Set(rig.connections.flatMap((c) => [`${c.source.instance_id}:${c.source.port_id}`, `${c.target.instance_id}:${c.target.port_id}`]));
  const compatible = (instId: string, p: { id: string; kind: string; direction: string }) => {
    if (!pendingCable || instId === pendingCable.instance_id || p.kind !== pendingCable.kind) return false;
    const okDir = pendingCable.direction === "out" ? p.direction !== "out" : pendingCable.direction === "in" ? p.direction !== "in" : true;
    return okDir && !(p.direction === "in" && used.has(`${instId}:${p.id}`));
  };
  const clickPort = (instId: string, p: { id: string; kind: string; direction: string }) => {
    if (!pendingCable) {
      if (p.direction === "in" && used.has(`${instId}:${p.id}`)) return; // an input already has its one plug
      setPendingCable({ instance_id: instId, port_id: p.id, kind: p.kind as never, direction: p.direction as never });
      return;
    }
    if (pendingCable.instance_id === instId && pendingCable.port_id === p.id) { setPendingCable(null); return; }
    if (!compatible(instId, p)) return;
    const src = pendingCable.direction === "in" ? { instance_id: instId, port_id: p.id } : { instance_id: pendingCable.instance_id, port_id: pendingCable.port_id };
    const dst = pendingCable.direction === "in" ? { instance_id: pendingCable.instance_id, port_id: pendingCable.port_id } : { instance_id: instId, port_id: p.id };
    onSelect(addConnection({ kind: pendingCable.kind, source: src, target: dst, label: null }));
    setPendingCable(null);
  };
  const colOf = (cat?: string) => (cat === "instrument" ? 0 : cat === "controller" || cat === "power_supply" ? 1 : cat === "switcher" ? 2 : cat === "amp" ? 4 : 3);
  const cols: string[][] = [[], [], [], [], []];
  for (const i of rig.instances) cols[colOf(profiles[i.profile_id]?.category)].push(i.id);
  const BOX_W = 150;
  const ROW = 12;
  const COL_GAP = 70;
  const boxes: Record<string, { x: number; y: number; h: number; ports: Record<string, { x: number; y: number; dir: string }> }> = {};
  let maxH = 0;
  cols.forEach((ids, c) => {
    let y = 20;
    for (const id of ids) {
      const ports = analysis?.instances[id]?.effective_ports ?? [];
      const h = 18 + ports.length * ROW + 4;
      const x = 20 + c * (BOX_W + COL_GAP);
      const pm: Record<string, { x: number; y: number; dir: string }> = {};
      ports.forEach((p, k) => {
        pm[p.id] = { x: p.direction === "in" ? x : p.direction === "out" ? x + BOX_W : x + BOX_W / 2, y: y + 18 + k * ROW + 4, dir: p.direction };
      });
      boxes[id] = { x, y, h, ports: pm };
      y += h + 16;
    }
    maxH = Math.max(maxH, y);
  });
  const W = 20 + 5 * (BOX_W + COL_GAP);
  return (
    <div className="overflow-auto">
      <svg role="img" aria-label="Wiring diagram" viewBox={`0 0 ${W} ${maxH + 10}`} width={W} height={maxH + 10} className="bg-white text-[8px]">
        {rig.connections.map((c) => {
          const a = boxes[c.source.instance_id]?.ports[c.source.port_id];
          const b = boxes[c.target.instance_id]?.ports[c.target.port_id];
          if (!a || !b) return null;
          const dx = Math.max(30, Math.abs(b.x - a.x) / 2);
          const d = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
          const sel = c.id === selectedId;
          return (
            <path key={c.id} d={d} fill="none" stroke={KIND_COLOR[c.kind]} strokeWidth={sel ? 3 : 1.5} strokeOpacity={sel ? 1 : 0.7} className="cursor-pointer" onClick={() => onSelect(c.id)}>
              <title>{c.label ?? `${c.kind} cable`}</title>
            </path>
          );
        })}
        {rig.instances.map((i) => {
          const b = boxes[i.id];
          const ports = analysis?.instances[i.id]?.effective_ports ?? [];
          return (
            <g key={i.id}>
              <rect x={b.x} y={b.y} width={BOX_W} height={b.h} rx={3} fill="#f9fafb" stroke="#374151" strokeWidth={0.8} />
              <text x={b.x + 4} y={b.y + 11} fontSize={9} fontWeight={600}>{i.label}</text>
              {ports.map((p) => {
                const pp = b.ports[p.id];
                const isOrigin = pendingCable?.instance_id === i.id && pendingCable?.port_id === p.id;
                const isCompat = compatible(i.id, p);
                return (
                  <g key={p.id} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); clickPort(i.id, p); }} data-testid={`wport-${i.id}-${p.id}`}>
                    <circle cx={pp.x} cy={pp.y} r={isCompat ? 4.5 : isOrigin ? 4 : 2.5} fill={KIND_COLOR[p.kind]} stroke={isCompat || isOrigin ? "#111" : "none"} strokeWidth={1} opacity={pendingCable && !isCompat && !isOrigin ? 0.35 : 1}>
                      <title>{`${i.label}: ${p.label} (${p.kind} ${p.direction}) — click to start/finish a cable`}</title>
                    </circle>
                    <text x={p.direction === "in" ? b.x + 6 : p.direction === "out" ? b.x + BOX_W - 6 : b.x + BOX_W / 2} y={pp.y + 2.5} fontSize={7} textAnchor={p.direction === "in" ? "start" : p.direction === "out" ? "end" : "middle"} fill="#374151">
                      {p.label}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
