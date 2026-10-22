"use client";

import { useEffect, useRef, useState } from "react";
import type { PerformanceStatus, Texture } from "@/lib/types";
import { type MacroPreview, previewMacro } from "@/lib/instrument";

/**
 * The on-screen evaluation of a texture: per macro its phase, LFO, effective value and every
 * destination's seven-bit value, recomputed on animation frames (or at 4 Hz under reduced motion).
 * In preview the clock is local; while performing it is anchored to the backend's last reported
 * phase so the picture follows the stream rather than a parallel clock. Pure UI: nothing here sends.
 */
export function usePreviewClock(texture: Texture | null, perf: PerformanceStatus | null | undefined, live: boolean): Record<string, MacroPreview> {
  const [out, setOut] = useState<Record<string, MacroPreview>>({});
  const origin = useRef<number | null>(null); // set on the first frame, never during render
  const anchors = useRef<Record<string, { phase: number; at: number }>>({});
  const perfMacros = live && perf?.state === "performing" ? perf.macros : null;
  const perfBpm = live && perf?.state === "performing" ? perf.tempo_bpm : null;
  useEffect(() => {
    if (!perfMacros) {
      anchors.current = {};
      return;
    }
    const now = performance.now();
    for (const m of perfMacros) anchors.current[m.macro_id] = { phase: m.phase, at: now };
  }, [perfMacros]);
  useEffect(() => {
    if (!texture) return;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    let last = 0;
    const tick = () => {
      const now = performance.now();
      if (origin.current === null) origin.current = now;
      if (!reduced && now - last < 33) {
        raf = requestAnimationFrame(tick);
        return;
      }
      last = now;
      const next: Record<string, MacroPreview> = {};
      const bpm = perfBpm ?? texture.tempo_bpm;
      for (const macro of texture.macros) {
        const rt = perfMacros?.find((m) => m.macro_id === macro.id);
        const liveMacro = rt ? { ...macro, base: rt.base, lfo: { ...macro.lfo, enabled: rt.lfo_enabled, depth: rt.depth, beats_per_cycle: rt.beats_per_cycle } } : macro;
        const a = anchors.current[macro.id];
        const elapsed = a ? (now - a.at) / 1000 : (now - (origin.current ?? now)) / 1000;
        next[macro.id] = previewMacro(liveMacro, bpm, elapsed, a ? a.phase : 0);
      }
      setOut(next);
      if (!reduced) raf = requestAnimationFrame(tick);
    };
    if (reduced) {
      tick();
      timer = setInterval(tick, 250);
    } else raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearInterval(timer);
    };
  }, [texture, perfMacros, perfBpm]);
  return out;
}
