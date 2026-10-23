"use client";

import { useRigStore } from "@/store/rigStore";
import { useInstrumentStore } from "@/store/instrumentStore";
import type { Texture } from "@/lib/types";
import { TEMPO_MAX_BPM, TEMPO_MIN_BPM } from "@/lib/types";
import { Badge, Field } from "@/components/ui/basics";

/**
 * "What am I playing?" — the texture's name, musical intent, starting Scene, tempo and notes. The
 * macro itself lives in the patch (MacroSource) beside its destinations. Every change is an
 * ordinary rig edit (undo, revision, debounced save) and never transmits; a tempo change while
 * performing is also pushed to the engine so the stream follows it.
 */
export function TextureHeader({ texture, performing }: { texture: Texture; performing: boolean }) {
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

      <textarea aria-label="Notes" data-testid="texture-notes" placeholder="Notes: why it sounded interesting, what to try next…" className="text-xs w-full min-h-[40px]" value={texture.notes ?? ""} onChange={(e) => edit((t) => { t.notes = e.target.value || null; })} />
    </section>
  );
}
