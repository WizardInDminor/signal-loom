"use client";

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
export const THEME_STORAGE_KEY = "signal-loom-theme";

const listeners = new Set<() => void>();

// The inline script in layout.tsx sets data-theme on <html> before first paint; the DOM attribute is the source of truth.
function readTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage may be blocked; the choice then lasts for this page session only.
  }
  listeners.forEach((l) => l());
}

export function ThemeToggle() {
  // The server snapshot is "light" (the default); the real value is read once hydrated, so there is no mismatch.
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light" as Theme);
  const opts: { value: Theme; label: string }[] = [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }];
  return (
    <div role="group" aria-label="Theme" data-testid="theme-toggle" className="ml-auto md:ml-0 inline-flex rounded border border-line overflow-hidden text-xs shrink-0">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={theme === o.value}
          data-testid={`theme-${o.value}`}
          onClick={() => setTheme(o.value)}
          className={`px-2 py-1 ${theme === o.value ? "bg-accent text-white" : "bg-panel hover:bg-neutral-100"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
