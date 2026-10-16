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

const TABS = ["board", "stage", "wiring", "scenes", "controllers", "exports"] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: string): v is Tab => (TABS as readonly string[]).includes(v);

export default function RigPage() {
  const { id } = useParams<{ id: string }>();
  const { rig, analysis, loading, error, saving, dirty, conflict, load, clearError, update, flush, undo, redo, blockedSwitch, retrySwitch, discardAndSwitch } = useRigStore();
  const [tab, setTabState] = useState<Tab>("board");
  // Workspaces are addressable (`#stage`), so a setlist view can be bookmarked or shared.
  const setTab = (t: Tab) => {
    setTabState(t);
    if (typeof window !== "undefined") window.history.replaceState(null, "", `#${t}`);
  };

  useEffect(() => {
    if (id) void load(id);
  }, [id, load]);
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
      <div className="flex items-center gap-3 px-4 py-2 bg-panel border-b border-line">
        <Link href="/" className="text-sm text-neutral-500 hover:underline">← Rigs</Link>
        <input
          aria-label="Rig name"
          className="font-semibold text-base border-transparent hover:border-line focus:border-line"
          value={rig.name}
          onChange={(e) => update((r) => { r.name = e.target.value; })}
        />
        <span className="text-xs text-neutral-500" aria-live="polite" data-testid="save-state">
          {conflict ? "Changed elsewhere — reload" : saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}
        </span>
        {conflict && <Button onClick={() => window.location.reload()}>Reload</Button>}
        <div className="ml-auto flex gap-2 text-xs">
          {s && (
            <>
              <Badge tone={s.errors ? "bad" : "ok"}>{s.errors} errors</Badge>
              <Badge tone={s.warnings ? "warn" : "neutral"}>{s.warnings} warnings</Badge>
              <Badge>{s.infos} notes</Badge>
            </>
          )}
        </div>
      </div>
      <div role="tablist" aria-label="Workspaces" className="flex gap-1 px-4 pt-2 bg-panel border-b border-line">
        {TABS.map((t) => (
          <Button key={t} role="tab" aria-selected={tab === t} variant={tab === t ? "primary" : "ghost"} onClick={() => setTab(t)} className="capitalize rounded-b-none">
            {t}
          </Button>
        ))}
      </div>
      <div role="tabpanel" className="flex-1 min-h-0 p-3 overflow-auto">
        {tab === "board" && <BoardTab />}
        {tab === "stage" && <StageTab />}
        {tab === "wiring" && <WiringTab />}
        {tab === "scenes" && <ScenesTab />}
        {tab === "controllers" && <ControllersTab />}
        {tab === "exports" && <ExportsTab />}
      </div>
    </div>
  );
}
