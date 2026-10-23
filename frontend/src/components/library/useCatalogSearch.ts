"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { DeviceProfile } from "@/lib/types";

export interface LibraryFilters { q: string; category: string }

/** How long typing may pause before the backend is asked; a category change waits the same. */
export const SEARCH_DEBOUNCE_MS = 150;

/**
 * The Device Library's list, kept honest about which query it answers (UX-LIBRARY-01).
 *
 * The defect was a race: every keystroke asked the backend for a list and the page accepted
 * whichever answer arrived last, so a slow answer for "" or "M" (the biggest lists, slowest to
 * serialize from a large imported catalog) replaced the answer for "Mood" while the input still
 * said "Mood". Here every request carries a sequence number and an AbortController: a response is
 * applied only if it belongs to the newest request, and an older request is aborted where the
 * browser still can. `refresh()` is stable and reads the *current* filters, so a caller that awaited
 * a save re-lists for what the user sees now, not for what the field said when the save began.
 *
 * `items` is null until the first list arrives; `shown` names the filters the visible list answers;
 * `pending` is true while they lag behind the input (the old list stays visible meanwhile — it is
 * never blanked and the input never loses focus).
 */
export function useCatalogSearch(onError: (message: string) => void) {
  const [filters, setFiltersState] = useState<LibraryFilters>({ q: "", category: "" });
  const [items, setItems] = useState<DeviceProfile[] | null>(null);
  const [shown, setShown] = useState<LibraryFilters | null>(null);
  const latest = useRef<LibraryFilters>(filters);
  const seq = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  const first = useRef(true);

  const setFilters = useCallback((patch: Partial<LibraryFilters>) => {
    latest.current = { ...latest.current, ...patch };
    setFiltersState(latest.current);
  }, []);

  const refresh = useCallback(() => {
    const n = ++seq.current;
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    const asked = latest.current;
    api.catalog.list(asked.q, asked.category || undefined, controller.signal).then(
      (list) => {
        if (n !== seq.current) return; // a newer request owns the list
        setItems(list);
        setShown(asked);
      },
      (e: Error) => {
        if (controller.signal.aborted || n !== seq.current) return;
        onError(e.message);
      },
    );
  }, [onError]);

  useEffect(() => {
    if (first.current) { first.current = false; refresh(); return; }
    const t = setTimeout(refresh, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filters, refresh]);

  useEffect(() => () => inflight.current?.abort(), []);

  const pending = shown === null || shown.q !== filters.q || shown.category !== filters.category;
  return { filters, setFilters, items, shown, pending, refresh };
}
