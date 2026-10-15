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

const TABS = ["board", "wiring", "scenes", "controllers", "exports"] as const;
type Tab = (typeof TABS)[number];

export default function RigPage() {
  const { id } = useParams<{ id: string }>();
  const { rig, analysis, loading, error, saving, dirty, load, clearError, update, flush } = useRigStore();
  const [tab, setTab] = useState<Tab>("board");

  useEffect(() => {
    if (id) void load(id);
  }, [id, load]);
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
      <ErrorBanner message={error} onClose={clearError} />
      <div className="flex items-center gap-3 px-4 py-2 bg-panel border-b border-line">
        <Link href="/" className="text-sm text-neutral-500 hover:underline">← Rigs</Link>
        <input
          aria-label="Rig name"
          className="font-semibold text-base border-transparent hover:border-line focus:border-line"
          value={rig.name}
          onChange={(e) => update((r) => { r.name = e.target.value; })}
        />
        <span className="text-xs text-neutral-500" aria-live="polite">{saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}</span>
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
        {tab === "wiring" && <WiringTab />}
        {tab === "scenes" && <ScenesTab />}
        {tab === "controllers" && <ControllersTab />}
        {tab === "exports" && <ExportsTab />}
      </div>
    </div>
  );
}
