"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

export type CordTone = "rises" | "falls" | "off" | "bad";
export interface Cord { from: string; to: string; tone: CordTone }

const STROKE: Record<CordTone, string> = { rises: "var(--accent)", falls: "#d97706", off: "#9ca3af", bad: "#dc2626" };

/**
 * Decorative cords from the macro's port to every destination's port, measured from the
 * `data-port` elements inside `container` (re-measured when anything inside resizes). Colour is the
 * direction (accent rises, amber falls), dotted grey when the destination is off, red when refused
 * or in conflict. The dash drifts while the preview value moves; static under reduced motion and
 * hidden below the md breakpoint, where the cards stack and the rail carries the direction.
 * `cords` must be referentially stable between preview frames (memoised by the caller): the layer
 * re-measures whenever it changes.
 */
export function PatchCords({ container, cords, moving }: { container: RefObject<HTMLDivElement | null>; cords: Cord[]; moving: boolean }) {
  const [paths, setPaths] = useState<{ key: string; d: string; tone: CordTone }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      const ports = new Map<string, DOMRect>();
      el.querySelectorAll<HTMLElement>("[data-port]").forEach((p) => { if (p.dataset.port) ports.set(p.dataset.port, p.getBoundingClientRect()); });
      const next = cords.flatMap((c) => {
        const a = ports.get(c.from);
        const b = ports.get(c.to);
        if (!a || !b || a.width === 0 || b.width === 0) return [];
        const x1 = a.left + a.width / 2 - base.left;
        const y1 = a.top + a.height / 2 - base.top;
        const x2 = b.left + b.width / 2 - base.left;
        const y2 = b.top + b.height / 2 - base.top;
        const dx = Math.max(28, Math.abs(x2 - x1) / 2);
        return [{ key: c.to, d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, tone: c.tone }];
      });
      setPaths(next);
      setSize({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    el.querySelectorAll<HTMLElement>("[data-port]").forEach((p) => { const card = p.parentElement; if (card) ro.observe(card); });
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [container, cords]);
  if (!paths.length) return null;
  return (
    <svg className="hidden md:block absolute inset-0 pointer-events-none" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true" data-testid="patch-cords">
      {paths.map((p) => (
        <path key={p.key} d={p.d} fill="none" stroke={STROKE[p.tone]} strokeWidth={p.tone === "off" ? 1.5 : 2.5} strokeLinecap="round" strokeDasharray={p.tone === "off" ? "2 6" : "7 5"} className={moving && p.tone !== "off" ? "inst-cord" : undefined} opacity={0.9} data-tone={p.tone} />
      ))}
    </svg>
  );
}
