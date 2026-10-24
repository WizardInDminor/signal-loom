"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useRigStore } from "@/store/rigStore";
import { Badge, Button, ErrorBanner } from "@/components/ui/basics";
import { BoardTab } from "@/components/board/BoardTab";
import { WiringTab } from "@/components/wiring/WiringTab";
import { ScenesTab } from "@/components/scenes/ScenesTab";
import { ControllersTab } from "@/components/controllers/ControllersTab";
import { ExportsTab } from "@/components/exports/ExportsTab";
import { StageTab } from "@/components/stage/StageTab";
import { LiveTab } from "@/components/live/LiveTab";
import { InstrumentTab } from "@/components/instrument/InstrumentTab";
import { useLiveStore } from "@/store/liveStore";
import { useInstrumentStore } from "@/store/instrumentStore";

// Instrument first: the rig as something to play. The default tab stays Board (existing deep links).
const TABS = ["instrument", "board", "stage", "wiring", "scenes", "controllers", "live", "exports"] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: string): v is Tab => (TABS as readonly string[]).includes(v);

export default function RigPage() {
  const { id } = useParams<{ id: string }>();
  const { rig, analysis, loading, error, saving, dirty, conflict, load, clearError, update, flush, undo, redo, blockedSwitch, retrySwitch, discardAndSwitch } = useRigStore();
  const [tab, setTabState] = useState<Tab>("board");
  const liveStatus = useLiveStore((s) => s.status);
  const attachLive = useLiveStore((s) => s.attach);
  const detachLive = useLiveStore((s) => s.detach);
  // Workspaces are addressable (`#stage`), so a setlist view can be bookmarked or shared.
  const setTab = (t: Tab) => {
    setTabState(t);
    if (typeof window !== "undefined") window.history.replaceState(null, "", `#${t}`);
  };

  useEffect(() => {
    if (id) void load(id);
  }, [id, load]);
  useEffect(() => {
    // The live service's state (armed, queue) is polled while a rig is open so the header badge is live.
    if (id) void attachLive(id);
    return () => detachLive();
  }, [id, attachLive, detachLive]);
  const observePerformance = useInstrumentStore((s) => s.observe);
  const teardownPerformance = useInstrumentStore((s) => s.teardown);
  useEffect(() => {
    // The performance heartbeat belongs to the rig page, not to the Instrument tab: switching
    // workspaces must not let the lease expire; leaving the rig page does (the backend then stops).
    observePerformance(liveStatus?.performance);
  }, [liveStatus, observePerformance]);
  useEffect(() => () => teardownPerformance(), [id, teardownPerformance]);
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace(/^#/, "");
      if (isTab(h)) setTabState(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if ((e.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);
  useEffect(() => {
    const onUnload = () => flush();
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      flush();
    };
  }, [flush]);

  if (loading || (!rig && !error)) return <p className="p-6 text-sm text-neutral-500">Loading rig…</p>;
  if (!rig) return <div className="p-6"><ErrorBanner message={error} /><Link href="/" className="text-sm underline">Back to rigs</Link></div>;

  const s = analysis?.summary;
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {blockedSwitch && rig && rig.id !== id && (
        <div role="alert" data-testid="blocked-switch" className="bg-red-50 border border-red-300 text-red-900 text-sm px-4 py-3 flex flex-col gap-2">
          <div>
            <b>Your unsaved edits to “{blockedSwitch.fromName}” could not be saved</b>, so the other rig was not opened and nothing was discarded. {blockedSwitch.reason}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void retrySwitch()}>Retry save, then open the other rig</Button>
            <Button variant="danger" onClick={() => window.confirm(`Discard the unsaved edits to "${blockedSwitch.fromName}"? This cannot be undone.`) && void discardAndSwitch()}>Discard edits and open the other rig</Button>
          </div>
        </div>
      )}
      {!blockedSwitch && <ErrorBanner message={error} onClose={clearError} />}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 bg-panel border-b border-line">
        <Link href="/" className="text-sm text-neutral-500 hover:underline">← Rigs</Link>
        <input
          aria-label="Rig name"
          className="font-semibold text-base border-transparent hover:border-line focus:border-line min-w-0 w-40 sm:w-auto"
          value={rig.name}
          onChange={(e) => update((r) => { r.name = e.target.value; })}
        />
        <span className="text-xs text-neutral-500" aria-live="polite" data-testid="save-state">
          {conflict ? "Changed elsewhere — reload" : saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}
        </span>
        {conflict && <Button onClick={() => window.location.reload()}>Reload</Button>}
        <div className="ml-auto flex flex-wrap gap-2 text-xs">
          {liveStatus?.performance?.state === "performing" && liveStatus.performance.rig_id === rig.id && (
            <span className="rounded px-2 py-0.5 bg-[#b91c1c] text-white font-semibold animate-pulse motion-reduce:animate-none" data-testid="rig-performing-badge" title="A texture is performing: values stream to the rig under the budget. Open the Instrument tab to stop.">PERFORMING</span>
          )}
          {liveStatus?.armed && liveStatus.connected_rig_id === rig.id && (
            <span className="rounded px-2 py-0.5 bg-red-600 text-white font-semibold" data-testid="rig-armed-badge" title="Live MIDI is armed: auditions and panel controls transmit. Open the Live tab to disarm.">ARMED</span>
          )}
          {s && (
            <>
              <Badge tone={s.errors ? "bad" : "ok"}>{s.errors} errors</Badge>
              <Badge tone={s.warnings ? "warn" : "neutral"}>{s.warnings} warnings</Badge>
              <Badge>{s.infos} notes</Badge>
            </>
          )}
        </div>
      </div>
      <div role="tablist" aria-label="Workspaces" className="flex gap-1 px-4 pt-2 bg-panel border-b border-line overflow-x-auto">
        {TABS.map((t) => (
          <Button key={t} role="tab" aria-selected={tab === t} variant={tab === t ? "primary" : "ghost"} onClick={() => setTab(t)} className="capitalize rounded-b-none">
            {t}
          </Button>
        ))}
      </div>
      <div role="tabpanel" className="flex-1 min-h-0 p-3 overflow-auto">
        {tab === "instrument" && <InstrumentTab />}
        {tab === "board" && <BoardTab />}
        {tab === "stage" && <StageTab />}
        {tab === "wiring" && <WiringTab />}
        {tab === "scenes" && <ScenesTab />}
        {tab === "controllers" && <ControllersTab />}
        {tab === "live" && <LiveTab />}
        {tab === "exports" && <ExportsTab />}
      </div>
    </div>
  );
}
