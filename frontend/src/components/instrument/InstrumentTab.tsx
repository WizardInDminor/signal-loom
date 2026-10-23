"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRigStore } from "@/store/rigStore";
import { useLiveStore } from "@/store/liveStore";
import { useInstrumentStore } from "@/store/instrumentStore";
import { api } from "@/lib/api";
import { Button, Panel } from "@/components/ui/basics";
import { TextureHeader } from "./TextureHeader";
import { PatchBay } from "./PatchBay";
import { PerformancePanel } from "./PerformancePanel";
import { usePreviewClock } from "./usePreviewClock";

/**
 * Instrument: play the whole rig as one evolving instrument. A Texture names a musical idea; one
 * macro (the source of the patch) moves several pedals' documented controls through independent
 * ranges; a tempo-related triangle LFO breathes on top. Everything on this tab is a preview until
 * the explicit connect → arm → Start performance gesture in the panel below, and Stop is always one
 * click away.
 */
export function InstrumentTab() {
  const router = useRouter();
  const { rig, analysis, addTexture, duplicateTexture, removeTexture } = useRigStore();
  const status = useLiveStore((s) => s.status);
  const refreshStatic = useLiveStore((s) => s.refreshStatic);
  const { selectedTextureId, selectTexture, refreshReadiness } = useInstrumentStore();
  const textures = rig?.textures ?? [];
  const texture = textures.find((t) => t.id === selectedTextureId) ?? textures[0] ?? null;
  const perf = status?.performance;
  const performingThis = !!rig && perf?.state === "performing" && perf.rig_id === rig.id && perf.texture_id === texture?.id;
  const previews = usePreviewClock(texture, perf, performingThis);
  const revision = rig?.revision ?? 0;
  const connected = !!rig && status?.connected_rig_id === rig.id;
  const armed = !!status?.armed;
  const perfState = perf?.state;

  useEffect(() => {
    if (texture && texture.id !== selectedTextureId) selectTexture(texture.id);
  }, [texture, selectedTextureId, selectTexture]);
  useEffect(() => {
    if (!rig || !texture) return;
    const t = setTimeout(() => void refreshReadiness(rig.id), 350); // after the debounced save/analysis
    return () => clearTimeout(t);
  }, [rig, texture, revision, connected, armed, perfState, refreshReadiness]);
  useEffect(() => {
    if (!rig || !texture) return;
    const i = setInterval(() => void refreshReadiness(rig.id), 2000);
    return () => clearInterval(i);
  }, [rig, texture, refreshReadiness]);
  useEffect(() => {
    // Coverage (CC route per device) comes from the live layer; refresh it when the connection state changes.
    void refreshStatic();
  }, [connected, refreshStatic]);

  if (!rig) return null;
  const report = texture && analysis?.textures ? analysis.textures[texture.id] : undefined;
  const createDemo = async () => {
    const r = await api.rigs.create({ name: "Undertow demo (virtual instrument)", template: "virtual_instrument" });
    router.push(`/rigs/${r.id}#instrument`);
  };
  const structuralLocked = performingThis;

  return (
    <div className="grid lg:grid-cols-[220px_1fr] gap-3 items-start" data-testid="instrument-tab">
      <Panel title="Textures" actions={<Button onClick={() => { const n = window.prompt("Name the musical idea", `Texture ${textures.length + 1}`); if (n) selectTexture(addTexture(n)); }} data-testid="texture-new">+ New</Button>}>
        <ul className="flex flex-col gap-1" data-testid="texture-list">
          {textures.map((t) => (
            <li key={t.id}>
              <button type="button" className={`w-full text-left text-sm px-2 py-1 rounded border ${texture?.id === t.id ? "border-accent bg-blue-50" : "border-transparent hover:bg-neutral-100"}`} onClick={() => selectTexture(t.id)} data-testid={`texture-item-${t.id}`}>
                <div className="font-medium">{t.name}</div>
                <div className="text-[10px] text-neutral-500 truncate">{t.intent ?? `${t.macros.reduce((n, m) => n + m.mappings.length, 0)} destination(s) · ${t.tempo_bpm} BPM`}</div>
              </button>
            </li>
          ))}
          {!textures.length && <li className="text-xs text-neutral-500">No texture yet. A texture is a named musical idea: one gesture that moves several pedals at once.</li>}
        </ul>
        {texture && (
          <div className="flex flex-wrap gap-1 mt-2">
            <Button onClick={() => { const id = duplicateTexture(texture.id); if (id) selectTexture(id); }} data-testid="texture-duplicate" disabled={structuralLocked}>Duplicate</Button>
            <Button variant="danger" onClick={() => { if (window.confirm(`Delete texture "${texture.name}"?`)) { removeTexture(texture.id); selectTexture(null); } }} data-testid="texture-delete" disabled={structuralLocked}>Delete</Button>
          </div>
        )}
        <p className="text-[11px] text-neutral-500 mt-2">Saved with the rig like scenes (undo, autosave, export). Selecting or editing a texture never sends MIDI.</p>
        {!textures.length && <div className="mt-2"><Button onClick={() => void createDemo()} data-testid="texture-create-demo">Open the synthetic Undertow demo</Button></div>}
      </Panel>
      {texture ? (
        <div className="flex flex-col gap-3 min-w-0">
          <Panel title="1 · What am I playing?"><TextureHeader texture={texture} performing={performingThis} /></Panel>
          <Panel title="2 · The patch — what moves what" actions={structuralLocked ? <span className="text-xs text-red-700">routing is locked while performing — stop to edit</span> : undefined}><PatchBay texture={texture} report={report} previews={previews} structuralLocked={structuralLocked} performing={performingThis} /></Panel>
          <Panel title="3 · What is happening?"><PerformancePanel texture={texture} previews={previews} onCreateDemo={() => void createDemo()} /></Panel>
        </div>
      ) : (
        <Panel title="Approach the instrument">
          <p className="text-sm text-neutral-700">Create a texture to give the rig one gesture: a macro that moves a documented continuous control on two or more pedals through independent ranges, with a slow tempo-related movement on top. Or open the synthetic demo to see the whole journey without any hardware.</p>
        </Panel>
      )}
    </div>
  );
}
