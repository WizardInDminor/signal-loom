"use client";

import { useRigStore } from "@/store/rigStore";
import { useInstrumentStore } from "@/store/instrumentStore";
import type { Macro, Texture } from "@/lib/types";
import type { MacroPreview } from "@/lib/instrument";
import { formatPhase } from "@/lib/instrument";
import { Field } from "@/components/ui/basics";

/**
 * The source of the patch: one macro with its large slider, the effective value and the triangle
 * LFO (on/off, cycle in beats, depth). Every change is an ordinary rig edit and never transmits;
 * while performing the same gesture is also pushed to the engine so the stream follows the hand.
 * The right edge carries the port the cords start from.
 */
export function MacroSource({ texture, macro, preview: pv, performing, structuralLocked }: { texture: Texture; macro: Macro; preview: MacroPreview | undefined; performing: boolean; structuralLocked: boolean }) {
  const { updateTexture } = useRigStore();
  const pushParams = useInstrumentStore((s) => s.pushParams);
  const edit = (fn: (m: Macro) => void) => updateTexture(texture.id, (t) => { const m = t.macros.find((x) => x.id === macro.id); if (m) fn(m); });
  const pct = Math.round((pv?.effective ?? macro.base) * 100);
  const destinations = macro.mappings.length;
  return (
    <div className="relative rounded-lg border border-line bg-gradient-to-br from-panel to-neutral-50 p-3 flex flex-col gap-2 md:self-start" data-testid={`macro-${macro.id}`} aria-label={`${macro.name} macro`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wide text-neutral-500">Source · macro</div>
        <span className="text-[10px] text-neutral-500">{destinations} destination{destinations === 1 ? "" : "s"}</span>
      </div>
      <input aria-label="Macro name" className="font-semibold text-lg border-transparent hover:border-line focus:border-line w-full" value={macro.name} onChange={(e) => edit((m) => { m.name = e.target.value || "Macro"; })} disabled={structuralLocked} />
      <div className="flex items-end gap-3">
        <div className="flex-1 flex flex-col gap-1">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-neutral-500">base {Math.round(macro.base * 100)}%</span>
            <span className="font-mono text-base" data-testid={`macro-effective-${macro.id}`} aria-live="off">effective {pct}%</span>
          </div>
          <input
            type="range" min={0} max={1000} step={1}
            aria-label={`${macro.name} macro`} data-testid={`macro-slider-${macro.id}`}
            className="w-full h-8 accent-accent"
            value={Math.round(macro.base * 1000)}
            onChange={(e) => { const v = Number(e.target.value) / 1000; edit((m) => { m.base = v; }); if (performing) pushParams({ macros: { [macro.id]: { base: v } } }); }}
          />
          <div className="flex justify-between text-[10px] text-neutral-400" aria-hidden="true"><span>0</span><span>½</span><span>1</span></div>
        </div>
        <MeterBar value={pv?.effective ?? macro.base} base={macro.base} />
      </div>
      <div className="rounded border border-line bg-panel/70 p-2 flex flex-col gap-1 text-xs">
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1 font-medium">
            <input type="checkbox" aria-label="LFO enabled" data-testid={`lfo-enabled-${macro.id}`} checked={macro.lfo.enabled} onChange={(e) => { const v = e.target.checked; edit((m) => { m.lfo.enabled = v; }); if (performing) pushParams({ macros: { [macro.id]: { enabled: v } } }); }} />
            Triangle LFO
          </label>
          <PhaseRing phase={macro.lfo.enabled ? (pv?.phase ?? 0) : 0} active={macro.lfo.enabled} />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Cycle (beats)">
            <select aria-label="LFO beats per cycle" data-testid={`lfo-beats-${macro.id}`} value={String(macro.lfo.beats_per_cycle)} onChange={(e) => { const v = Number(e.target.value); edit((m) => { m.lfo.beats_per_cycle = v; }); if (performing) pushParams({ macros: { [macro.id]: { beats_per_cycle: v } } }); }}>
              {[0.25, 0.5, 1, 2, 4, 8, 16, 32, 64].map((b) => <option key={b} value={String(b)}>{b}</option>)}
            </select>
          </Field>
          <Field label={`Depth ${Math.round(macro.lfo.depth * 100)}%`}>
            <input type="range" min={0} max={100} aria-label="LFO depth" data-testid={`lfo-depth-${macro.id}`} className="w-28" value={Math.round(macro.lfo.depth * 100)} onChange={(e) => { const v = Number(e.target.value) / 100; edit((m) => { m.lfo.depth = v; }); if (performing) pushParams({ macros: { [macro.id]: { depth: v } } }); }} />
          </Field>
        </div>
        <span className="font-mono text-[11px] text-neutral-600" data-testid={`lfo-readout-${macro.id}`}>
          {macro.lfo.enabled && pv?.period ? `period ${pv.period.toFixed(2)} s · phase ${formatPhase(pv.phase)} · lfo ${pv.lfo >= 0 ? "+" : ""}${pv.lfo.toFixed(2)}` : "LFO off: effective = base"}
        </span>
      </div>
      <span className="hidden md:block absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3 h-3 rounded-full bg-accent border-2 border-panel" data-port={`macro:${macro.id}`} aria-hidden="true" />
    </div>
  );
}

function MeterBar({ value, base }: { value: number; base: number }) {
  return (
    <div className="relative w-3 h-16 rounded bg-neutral-200 overflow-hidden" aria-hidden="true">
      <div className="absolute bottom-0 left-0 right-0 bg-accent/70 inst-meter" style={{ height: `${Math.round(value * 100)}%` }} />
      <div className="absolute left-0 right-0 border-t border-neutral-700" style={{ bottom: `${Math.round(base * 100)}%` }} />
    </div>
  );
}

function PhaseRing({ phase, active }: { phase: number; active: boolean }) {
  const r = 10;
  const c = 2 * Math.PI * r;
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" className="shrink-0">
      <circle cx="14" cy="14" r={r} fill="none" stroke="var(--line)" strokeWidth="3" />
      {active && <circle cx="14" cy="14" r={r} fill="none" stroke="var(--accent)" strokeWidth="3" strokeDasharray={`${c * phase} ${c}`} transform="rotate(-90 14 14)" />}
    </svg>
  );
}
