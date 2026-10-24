"use client";

import { useState } from "react";
import type { Rig } from "@/lib/types";
import type { Mc8Assignment } from "@/lib/stage";

/**
 * The MC8's footswitch face for one bank: two rows of four switches per page
 * (A–D along the bottom, E–H above, as on the device's display; page 2 holds I–P).
 * Pressing a switch that recalls a scene selects that scene. This is a picture of the plan,
 * not of the hardware's state: nothing is sent to a controller.
 */
export function Mc8Face({ rig, positions, current, messageCounts, onSelectScene }: {
  rig: Rig;
  positions: string[];
  current: Mc8Assignment | null;
  messageCounts: Record<string, number>;
  onSelectScene: (sceneId: string) => void;
}) {
  const banks = [...rig.controllers.mc8.banks].sort((a, b) => a.number - b.number);
  const [bankPick, setBankPick] = useState<number | null>(null);
  const [page, setPage] = useState<1 | 2>(1);
  const bank = banks.find((b) => b.number === (bankPick ?? current?.bank)) ?? banks.find((b) => b.number === current?.bank) ?? banks[0];
  if (!bank) return <p className="text-xs text-slate-500">No MC8 bank yet. Assign scenes to switches in the Scenes or Controllers tab and the face lights up here.</p>;
  const perPage = 8;
  const pageOf = (pos: string) => (positions.indexOf(pos) >= perPage ? 2 : 1);
  const effectivePage: 1 | 2 = current && current.bank === bank.number && pageOf(current.position) === 2 && bankPick === null ? 2 : page;
  const pagePositions = positions.slice((effectivePage - 1) * perPage, effectivePage * perPage);
  const bottom = pagePositions.slice(0, 4);
  const top = pagePositions.slice(4, 8);
  const hasPage2 = bank.presets.some((p) => pageOf(p.position) === 2);
  const row = (row: string[]) =>
    row.map((pos) => {
      const p = bank.presets.find((x) => x.position === pos);
      const scene = p?.scene_id ? rig.scenes.find((s) => s.id === p.scene_id) : null;
      const lit = !!current && current.bank === bank.number && current.position === pos;
      const n = messageCounts[`${bank.number}:${pos}`];
      return (
        <button
          key={pos}
          type="button"
          data-testid={`mc8-switch-${pos}`}
          data-lit={lit ? "true" : "false"}
          aria-label={`MC8 switch ${pos}${p?.short_name ? ` ${p.short_name}` : ""}${scene ? `, scene ${scene.name}` : ", empty"}`}
          aria-pressed={lit}
          disabled={!scene}
          onClick={() => scene && onSelectScene(scene.id)}
          className={`group flex flex-col items-center gap-1 rounded-md px-1 py-1.5 transition ${scene ? "hover:bg-white/10 cursor-pointer" : "cursor-default"}`}
          title={scene ? `Recall “${scene.name}”` : p ? p.short_name : "no preset on this switch"}
        >
          <span className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-semibold ${lit ? "bg-amber-300 border-amber-200 text-foreground shadow-[0_0_14px_rgba(252,211,77,0.9)]" : scene ? "bg-slate-700 border-slate-500 text-slate-200 group-hover:border-slate-300" : "bg-slate-800 border-slate-700 text-slate-500"}`}>
            {pos}
          </span>
          <span className={`font-mono text-[10px] leading-none ${lit ? "text-amber-200" : "text-slate-300"}`}>{p?.short_name || "—"}</span>
          <span className="text-[9px] leading-none text-slate-500 truncate max-w-[72px]">{scene ? scene.name : " "}</span>
          {n != null && <span className="text-[8px] leading-none text-slate-500">{n} msg</span>}
        </button>
      );
    });
  return (
    <div className="rounded-lg bg-slate-900 text-slate-100 border border-slate-700 p-3 flex flex-col gap-2" data-testid="mc8-face">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold tracking-wide">MC8</span>
        <select aria-label="MC8 bank" className="bg-slate-800 border-slate-600 text-slate-100 text-xs" value={bank.number} onChange={(e) => { setBankPick(Number(e.target.value)); setPage(1); }}>
          {banks.map((b) => <option key={b.number} value={b.number}>Bank {b.number} · {b.name}</option>)}
        </select>
        {(hasPage2 || effectivePage === 2) && (
          <span className="flex gap-1 ml-1">
            {[1, 2].map((pg) => (
              <button key={pg} type="button" onClick={() => { setPage(pg as 1 | 2); setBankPick(bank.number); }} aria-pressed={effectivePage === pg} className={`rounded px-1.5 py-0.5 text-[10px] border ${effectivePage === pg ? "bg-slate-100 text-foreground border-slate-100" : "border-slate-600 text-slate-300"}`}>page {pg}</button>
            ))}
          </span>
        )}
        <span className="ml-auto text-[10px] text-slate-500">switch rows as on the display · nothing is sent to hardware</span>
      </div>
      <div className="rounded bg-black/40 px-2 py-1 font-mono text-[11px] text-emerald-300 flex justify-between">
        <span>{bank.number.toString().padStart(2, "0")} {bank.name.slice(0, 24)}</span>
        <span>{current && current.bank === bank.number ? `${current.position} ${current.short_name}` : "—"}</span>
      </div>
      <div className="grid grid-cols-4 gap-1">{row(top)}</div>
      <div className="grid grid-cols-4 gap-1">{row(bottom)}</div>
    </div>
  );
}
