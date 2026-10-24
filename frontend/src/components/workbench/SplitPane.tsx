"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const NARROW_QUERY = "(max-width: 1023px)";
const STORAGE_KEY = "signal-loom.workbench.split";

/**
 * Two panes side by side with a draggable, keyboard-operable separator (desktop), or two segments
 * (narrow screens). Both children stay mounted in either mode, so an open editor and the reading
 * position survive a resize or a segment switch. Minimum widths are enforced in pixels.
 */
export function SplitPane({ left, right, leftLabel, rightLabel, minLeft = 400, minRight = 360, defaultSplit = 46, segment, onSegment }: {
  left: ReactNode; right: ReactNode; leftLabel: string; rightLabel: string; minLeft?: number; minRight?: number; defaultSplit?: number;
  /** Narrow screens: which pane is visible. Controlled by the parent so other UI (e.g. "turn to page") can switch it. */
  segment: "left" | "right"; onSegment: (s: "left" | "right") => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Rendered on the client only (the Workbench mounts after the profile has loaded), so the
  // initial values can come straight from the browser.
  const [narrow, setNarrow] = useState(() => (typeof window !== "undefined" ? window.matchMedia(NARROW_QUERY).matches : false));
  const [split, setSplit] = useState(() => {
    try { const v = Number(window.localStorage.getItem(STORAGE_KEY)); if (v >= 20 && v <= 80) return v; } catch { /* private mode / SSR */ }
    return defaultSplit;
  });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const apply = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const clamp = useCallback((pct: number) => {
    const w = ref.current?.clientWidth ?? 1200;
    const lo = (minLeft / w) * 100;
    const hi = 100 - (minRight / w) * 100;
    return Math.min(Math.max(pct, lo), Math.max(lo, hi));
  }, [minLeft, minRight]);
  const commit = (pct: number) => {
    const v = Math.round(clamp(pct) * 10) / 10;
    setSplit(v);
    try { window.localStorage.setItem(STORAGE_KEY, String(v)); } catch { /* ignore */ }
  };
  useEffect(() => {
    // Keep the minimums when the window shrinks.
    const onResize = () => setSplit((s) => clamp(s));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    commit(((e.clientX - r.left) / r.width) * 100);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setDragging(false);
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); commit(split - 2); }
    else if (e.key === "ArrowRight") { e.preventDefault(); commit(split + 2); }
    else if (e.key === "Home") { e.preventDefault(); commit(0); }
    else if (e.key === "End") { e.preventDefault(); commit(100); }
    else if (e.key === "Enter") { e.preventDefault(); commit(defaultSplit); }
  };

  if (narrow) {
    return (
      <div className="flex flex-col flex-1 min-h-0" data-testid="split-pane" data-mode="narrow">
        <div role="tablist" aria-label="Workbench panes" className="grid grid-cols-2 border-b border-line bg-panel" data-testid="pane-segments">
          {(["left", "right"] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={segment === s} data-testid={`segment-${s}`} onClick={() => onSegment(s)}
              className={`py-2 text-sm font-medium border-b-2 ${segment === s ? "border-accent text-accent" : "border-transparent text-neutral-500 hover:text-foreground"}`}>
              {s === "left" ? leftLabel : rightLabel}
            </button>
          ))}
        </div>
        <div className={`flex-1 min-h-0 flex flex-col ${segment === "left" ? "" : "hidden"}`} role="tabpanel" aria-label={leftLabel}>{left}</div>
        <div className={`flex-1 min-h-0 flex flex-col ${segment === "right" ? "" : "hidden"}`} role="tabpanel" aria-label={rightLabel}>{right}</div>
      </div>
    );
  }
  return (
    <div ref={ref} className={`flex flex-1 min-h-0 ${dragging ? "select-none cursor-col-resize" : ""}`} data-testid="split-pane" data-mode="split">
      <div className="min-h-0 flex flex-col min-w-0" style={{ width: `${split}%` }} aria-label={leftLabel}>{left}</div>
      <div
        role="separator" aria-orientation="vertical" aria-label="Resize panes" aria-valuenow={Math.round(split)} aria-valuemin={20} aria-valuemax={80} tabIndex={0}
        className={`wb-separator ${dragging ? "wb-separator-active" : ""}`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onKeyDown}
        title="Drag, or use ← → (Enter resets)"
      >
        <span className="wb-separator-grip" aria-hidden="true" />
      </div>
      <div className="min-h-0 flex flex-col flex-1 min-w-0" aria-label={rightLabel}>{right}</div>
    </div>
  );
}
