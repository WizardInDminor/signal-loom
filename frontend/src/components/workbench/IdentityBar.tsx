"use client";

import Link from "next/link";
import type { DeviceProfile } from "@/lib/types";
import { Badge } from "@/components/ui/basics";
import type { SaveState } from "./types";

/** The pedal's identity and MIDI basics in one line, plus the live save state of the workbench. */
export function IdentityBar({ profile, saveState, saveError, controlsCount, notesCount }: { profile: DeviceProfile; saveState: SaveState; saveError: string | null; controlsCount: number; notesCount: number }) {
  const m = profile.midi;
  const pc = m.program_change.supported === true ? `PC ${m.program_change.min ?? 0}–${m.program_change.max ?? 127}` : m.program_change.supported === false ? "no PC" : "PC not stated";
  const bypass = m.bypass.method === "cc" && m.bypass.cc != null ? `bypass CC ${m.bypass.cc}` : null;
  const stateText = saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : saveState === "editing" ? "Editing — not saved yet" : "Saved";
  const stateTone = saveState === "error" ? "text-red-700" : saveState === "editing" ? "text-amber-800" : "text-neutral-500";
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 sm:px-4 py-2 bg-panel border-b border-line" data-testid="workbench-identity">
      <Link href={`/catalog?device=${encodeURIComponent(profile.id)}`} className="text-sm text-neutral-500 hover:underline whitespace-nowrap">← Device library</Link>
      <h1 className="text-base font-semibold leading-tight min-w-0 truncate">
        <span className="text-neutral-500 font-normal">{profile.manufacturer} </span>{profile.model}
      </h1>
      <Badge>{profile.category.replace("_", " ")}</Badge>
      <div className="hidden md:flex items-center gap-1 text-xs text-neutral-600" data-testid="workbench-midi-basics">
        {m.interfaces.length ? (
          <>
            <span>MIDI {m.interfaces.map((i) => i.replace("_", " ")).join(", ")}</span>
            <span aria-hidden="true">·</span><span>ch {m.default_channel ?? "?"}</span>
            <span aria-hidden="true">·</span><span>{pc}</span>
            {bypass && <><span aria-hidden="true">·</span><span>{bypass}</span></>}
          </>
        ) : <Badge tone="warn">no MIDI input declared</Badge>}
      </div>
      <span className="ml-auto text-xs text-neutral-500 hidden sm:inline">{controlsCount} control{controlsCount === 1 ? "" : "s"} · {notesCount} note{notesCount === 1 ? "" : "s"}</span>
      <span className={`text-xs ${stateTone} sm:ml-0 ml-auto`} aria-live="polite" data-testid="workbench-save-state" data-state={saveState} title={saveError ?? undefined}>{stateText}</span>
    </header>
  );
}
