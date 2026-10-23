"use client";

import Link from "next/link";
import { useState } from "react";
import type { DeviceProfile } from "@/lib/types";
import { Badge, Button } from "@/components/ui/basics";
import type { SaveState } from "./types";

const INTERFACES: { value: string; label: string }[] = [
  { value: "din_in", label: "5-pin DIN MIDI in" },
  { value: "trs_in", label: "TRS (3.5 mm or 1/4\") MIDI in" },
  { value: "usb", label: "USB MIDI" },
];

/** The pedal's identity and MIDI basics in one line, plus the live save state of the workbench. */
export function IdentityBar({ profile, saveState, saveError, controlsCount, notesCount, onDeclareMidi }: { profile: DeviceProfile; saveState: SaveState; saveError: string | null; controlsCount: number; notesCount: number; onDeclareMidi: (iface: string, channel: number | null) => Promise<void> }) {
  const [declaring, setDeclaring] = useState(false);
  const [iface, setIface] = useState("din_in");
  const [channel, setChannel] = useState("");
  const [busy, setBusy] = useState(false);
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
        ) : (
          <>
            <Badge tone="warn">no MIDI input declared</Badge>
            <Button variant="ghost" className="!py-0 !px-1 text-xs underline" onClick={() => setDeclaring((v) => !v)} data-testid="declare-midi-toggle" aria-expanded={declaring}>Declare MIDI input…</Button>
          </>
        )}
      </div>
      {declaring && !m.interfaces.length && (
        <form className="basis-full flex flex-wrap items-end gap-2 text-xs border-t border-line pt-2 mt-1" data-testid="declare-midi-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await onDeclareMidi(iface, channel.trim() === "" ? null : Number(channel)); setDeclaring(false); } finally { setBusy(false); } }}>
          <span className="text-neutral-600 basis-full sm:basis-auto">Your statement about how MIDI reaches this pedal (recorded as <i>user</i> evidence, never as documented):</span>
          <label className="flex flex-col gap-0.5 text-neutral-600">Input<select aria-label="MIDI interface" value={iface} onChange={(e) => setIface(e.target.value)}>{INTERFACES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}</select></label>
          <label className="flex flex-col gap-0.5 text-neutral-600">Channel (1–16, optional)<input aria-label="Default MIDI channel" type="number" min={1} max={16} className="w-20" value={channel} onChange={(e) => setChannel(e.target.value)} /></label>
          <Button type="submit" variant="primary" disabled={busy} data-testid="declare-midi-save">{busy ? "Saving…" : "Declare"}</Button>
          <Button onClick={() => setDeclaring(false)} disabled={busy}>Cancel</Button>
        </form>
      )}
      <span className="ml-auto text-xs text-neutral-500 hidden sm:inline">{controlsCount} control{controlsCount === 1 ? "" : "s"} · {notesCount} note{notesCount === 1 ? "" : "s"}</span>
      <span className={`text-xs ${stateTone} sm:ml-0 ml-auto`} aria-live="polite" data-testid="workbench-save-state" data-state={saveState} title={saveError ?? undefined}>{stateText}</span>
    </header>
  );
}
