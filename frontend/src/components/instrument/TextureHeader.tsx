"use client";

import { useRigStore } from "@/store/rigStore";
import { useInstrumentStore } from "@/store/instrumentStore";
import type { Texture } from "@/lib/types";
import { TEMPO_MAX_BPM, TEMPO_MIN_BPM } from "@/lib/types";
import type { MacroPreview } from "@/lib/instrument";
import { formatPhase } from "@/lib/instrument";
import { Badge, Button, Field } from "@/components/ui/basics";

/**
 * "What am I playing?" — the texture's name, musical intent, starting Scene, tempo and the large
 * macro with its LFO. Every change is an ordinary rig edit (undo, revision, debounced save) and
 * never transmits; while performing, the same gesture is also pushed to the engine so the stream
 * follows the hand, with the document saved behind it (not on every tick).
 */
export function TextureHeader({ texture, previews, performing, structuralLocked }: { texture: Texture; previews: Record<string, MacroPreview>; performing: boolean; structuralLocked: boolean }) {
  const { rig, updateTexture } = useRigStore();
  const pushParams = useInstrumentStore((s) => s.pushParams);
  if (!rig) return null;
  const edit = (fn: (t: Texture) => void) => updateTexture(texture.id, fn);
  const scenes = [...rig.scenes].sort((a, b) => a.order - b.order);
  const sceneMissing = texture.base_scene_id && !rig.scenes.some((s) => s.id === texture.base_scene_id);
  return (
    <section className="flex flex-col gap-3" data-testid="texture-header" aria-label="What am I playing">
      <div className="grid md:grid-cols-[1fr_auto] gap-3 items-start">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Texture name" data-testid="texture-name" className="text-2xl font-semibold tracking-tight border-transparent hover:border-line focus:border-line min-w-0 w-full max-w-md" value={texture.name} onChange={(e) => edit((t) => { t.name = e.target.value; })} />
            {texture.origin === "virtual_fixture" && <Badge tone="warn">synthetic demo</Badge>}
          </div>
          <input aria-label="Musical intent" data-testid="texture-intent" placeholder="What should it do musically? e.g. drive recedes as the delay blooms" className="text-sm italic border-transparent hover:border-line focus:border-line w-full" value={texture.intent ?? ""} onChange={(e) => edit((t) => { t.intent = e.target.value || null; })} />
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <Field label="Starts from scene" hint={sceneMissing ? "That scene no longer exists — pick again or clear." : "Reference only; selecting a scene sends nothing."}>
            <select aria-label="Starting scene" data-testid="texture-scene" value={sceneMissing ? "__missing" : (texture.base_scene_id ?? "")} onChange={(e) => edit((t) => { t.base_scene_id = e.target.value || null; })} className={sceneMissing ? "border-red-400" : ""}>
              <option value="">— none —</option>
              {sceneMissing && <option value="__missing">⚠ missing: {texture.base_scene_id}</option>}
              {scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Tempo (BPM)" hint="A reference for modulation; no MIDI Clock is sent.">
            <input aria-label="Tempo BPM" data-testid="texture-bpm" type="number" min={TEMPO_MIN_BPM} max={TEMPO_MAX_BPM} step={1} className="w-20" value={texture.tempo_bpm}
              onChange={(e) => { const v = Math.max(TEMPO_MIN_BPM, Math.min(TEMPO_MAX_BPM, Number(e.target.value) || TEMPO_MIN_BPM)); edit((t) => { t.tempo_bpm = v; }); if (performing) pushParams({ tempo_bpm: v }); }} />
          </Field>
        </div>
      </div>

      {texture.macros.map((macro) => {
        const pv = previews[macro.id];
        const pct = Math.round((pv?.effective ?? macro.base) * 100);
        return (
          <div key={macro.id} className="rounded-lg border border-line bg-gradient-to-br from-panel to-neutral-50 p-3 flex flex-col gap-2" data-testid={`macro-${macro.id}`}>
            <div className="flex flex-wrap items-center gap-3">
              <input aria-label="Macro name" className="font-semibold text-base border-transparent hover:border-line focus:border-line w-32" value={macro.name} onChange={(e) => edit((t) => { const m = t.macros.find((x) => x.id === macro.id); if (m) m.name = e.target.value || "Macro"; })} disabled={structuralLocked} />
              <span className="text-xs text-neutral-500">base {Math.round(macro.base * 100)}%</span>
              <span className="ml-auto font-mono text-sm" data-testid={`macro-effective-${macro.id}`} aria-live="off">effective {pct}%</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range" min={0} max={1000} step={1}
                aria-label={`${macro.name} macro`} data-testid={`macro-slider-${macro.id}`}
                className="flex-1 h-8 accent-accent"
                value={Math.round(macro.base * 1000)}
                onChange={(e) => { const v = Number(e.target.value) / 1000; edit((t) => { const m = t.macros.find((x) => x.id === macro.id); if (m) m.base = v; }); if (performing) pushParams({ macros: { [macro.id]: { base: v } } }); }}
              />
              <MeterBar value={pv?.effective ?? macro.base} base={macro.base} />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1">
                <input type="checkbox" aria-label="LFO enabled" data-testid={`lfo-enabled-${macro.id}`} checked={macro.lfo.enabled} onChange={(e) => { const v = e.target.checked; edit((t) => { const m = t.macros.find((x) => x.id === macro.id); if (m) m.lfo.enabled = v; }); if (performing) pushParams({ macros: { [macro.id]: { enabled: v } } }); }} />
                Triangle LFO
              </label>
              <Field label="Cycle (beats)">
                <select aria-label="LFO beats per cycle" data-testid={`lfo-beats-${macro.id}`} value={String(macro.lfo.beats_per_cycle)} onChange={(e) => { const v = Number(e.target.value); edit((t) => { const m = t.macros.find((x) => x.id === macro.id); if (m) m.lfo.beats_per_cycle = v; }); if (performing) pushParams({ macros: { [macro.id]: { beats_per_cycle: v } } }); }}>
                  {[0.25, 0.5, 1, 2, 4, 8, 16, 32, 64].map((b) => <option key={b} value={String(b)}>{b}</option>)}
                </select>
              </Field>
              <Field label={`Depth ${Math.round(macro.lfo.depth * 100)}%`}>
                <input type="range" min={0} max={100} aria-label="LFO depth" data-testid={`lfo-depth-${macro.id}`} className="w-32" value={Math.round(macro.lfo.depth * 100)} onChange={(e) => { const v = Number(e.target.value) / 100; edit((t) => { const m = t.macros.find((x) => x.id === macro.id); if (m) m.lfo.depth = v; }); if (performing) pushParams({ macros: { [macro.id]: { depth: v } } }); }} />
              </Field>
              <span className="font-mono text-neutral-600" data-testid={`lfo-readout-${macro.id}`}>
                {macro.lfo.enabled && pv?.period ? `period ${pv.period.toFixed(2)} s · phase ${formatPhase(pv.phase)} · lfo ${pv.lfo >= 0 ? "+" : ""}${pv.lfo.toFixed(2)}` : "LFO off: effective = base"}
              </span>
              <PhaseRing phase={macro.lfo.enabled ? (pv?.phase ?? 0) : 0} active={macro.lfo.enabled} />
            </div>
          </div>
        );
      })}
      <textarea aria-label="Notes" data-testid="texture-notes" placeholder="Notes: why it sounded interesting, what to try next…" className="text-xs w-full min-h-[40px]" value={texture.notes ?? ""} onChange={(e) => edit((t) => { t.notes = e.target.value || null; })} />
      {!texture.macros.length && <Button onClick={() => edit((t) => { t.macros.push({ id: `macro_${Math.random().toString(16).slice(2, 14)}`, name: "Bloom", base: 0.5, mappings: [], lfo: { enabled: false, shape: "triangle", beats_per_cycle: 8, depth: 0.25 } }); })}>+ Add a macro</Button>}
    </section>
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
