"use client";

import { useEffect, useState } from "react";
import { api, downloadText } from "@/lib/api";
import { useRigStore } from "@/store/rigStore";
import type { ExportStatus } from "@/lib/types";
import { Badge, Button, Panel } from "@/components/ui/basics";

type Mc8Result = Awaited<ReturnType<typeof api.rigs.mc8Bank>>;
type Mc8Inspect = Awaited<ReturnType<typeof api.rigs.inspectMc8>>;
type MlInspect = Awaited<ReturnType<typeof api.rigs.inspectMl10x>>;

export function ExportsTab() {
  const { rig, analysis } = useRigStore();
  const [status, setStatus] = useState<ExportStatus | null>(null);
  const [mc8, setMc8] = useState<Record<number, Mc8Result | { error: string }>>({});
  const [mc8Inspect, setMc8Inspect] = useState<Mc8Inspect | null>(null);
  const [mlInspect, setMlInspect] = useState<MlInspect | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (rig) api.rigs.exportStatus(rig.id).then(setStatus).catch((e) => setErr(String(e.message)));
  }, [rig?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rig) return null;
  const fetchText = async (path: string, filename: string, type = "text/markdown") => {
    const res = await fetch(path);
    downloadText(filename, await res.text(), type);
  };
  const safe = rig.name.replace(/[^a-z0-9-_ ]/gi, "_");
  const levelTone = (l: string) => (l === "hardware_validated" || l === "editor_validated" ? "ok" : l === "fixture_validated" ? "warn" : l === "blocked" ? "bad" : "neutral");

  return (
    <div className="grid lg:grid-cols-2 gap-3 items-start">
      <Panel title="Human-readable configuration package">
        <div className="flex flex-col gap-2 text-xs">
          <p className="text-neutral-600">Everything here is derived from the single rig model and refreshes with your edits.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => fetchText(`/api/rigs/${rig.id}/exports/wiring.md`, `${safe}-wiring.md`)}>Wiring manifest (.md)</Button>
            <Button onClick={() => fetchText(`/api/rigs/${rig.id}/exports/wiring.csv`, `${safe}-wiring.csv`, "text/csv")}>Wiring manifest (.csv)</Button>
            <Button onClick={() => fetchText(`/api/rigs/${rig.id}/exports/scenes.md`, `${safe}-scenes.md`)}>Scene & action report (.md)</Button>
            <Button onClick={() => fetchText(`/api/rigs/${rig.id}/exports/mc8-switch-map.md`, `${safe}-mc8-switch-map.md`)}>MC8 switch map (.md)</Button>
            <Button onClick={() => fetchText(`/api/rigs/${rig.id}/exports/mc8-switch-map.csv`, `${safe}-mc8-switch-map.csv`, "text/csv")}>MC8 switch map (.csv)</Button>
            <Button onClick={() => fetchText(`/api/rigs/${rig.id}/exports/compiled.json`, `${safe}-compiled.json`, "application/json")}>Compiled plan (.json)</Button>
          </div>
          <h3 className="font-semibold mt-2">Signal Loom project file</h3>
          <p className="text-neutral-600">Versioned JSON with the rig and every device profile it uses. Re-import it from the Rigs page.</p>
          <div><Button variant="primary" onClick={async () => downloadText(`${safe}.signal-loom.json`, JSON.stringify(await api.rigs.exportProject(rig.id), null, 2), "application/json")}>Export project (.signal-loom.json)</Button></div>
        </div>
      </Panel>
      <Panel title="Native Morningstar formats — evidence levels">
        <div className="flex flex-col gap-2 text-xs">
          {err && <p className="text-red-700">{err}</p>}
          {status && (
            <table className="w-full">
              <thead><tr className="text-left text-neutral-500"><th>Output</th><th>Level</th><th>Notes</th></tr></thead>
              <tbody>
                {Object.entries(status).map(([k, v]) => (
                  <tr key={k} className="border-t border-line align-top"><td className="whitespace-nowrap py-1">{k.replace(/_/g, " ")}</td><td><Badge tone={levelTone(v.level)}>{v.level.replace(/_/g, " ")}</Badge> {!v.available && <Badge tone="bad">unavailable</Badge>}</td><td className="text-neutral-600">{v.note}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <h3 className="font-semibold mt-2">MC8 editor bank backup (.json)</h3>
          <p className="text-neutral-600">Shape and integrity hash reproduced from real editor exports, but <b>never loaded into the official editor or an MC8 by us</b>. Before trying: back up your MC8 with the editor (Controller Backup → All Banks), then restore this file as a <em>single bank</em> and inspect it in the editor before saving to the controller.</p>
          <div className="flex flex-wrap gap-2">
            {rig.controllers.mc8.banks.map((b) => (
              <Button key={b.number} onClick={async () => { try { setMc8((m) => ({ ...m, [b.number]: { error: "…" } })); const r = await api.rigs.mc8Bank(rig.id, b.number); setMc8((m) => ({ ...m, [b.number]: r })); } catch (e) { setMc8((m) => ({ ...m, [b.number]: { error: (e as Error).message } })); } }}>
                Prepare bank {b.number} “{b.name}”
              </Button>
            ))}
            {!rig.controllers.mc8.banks.length && <span className="text-neutral-500">No MC8 banks configured.</span>}
          </div>
          {Object.entries(mc8).map(([n, r]) => (
            <div key={n} className="border border-line rounded p-2">
              {"error" in r ? <span className="text-red-700">Bank {n}: {r.error}</span> : (
                <div className="flex flex-col gap-1">
                  <div>Bank {n}: <code>{r.filename}</code> · self-check {r.self_check.ok ? <Badge tone="ok">structure + hash OK</Badge> : <Badge tone="bad">{r.self_check.problems.join("; ")}</Badge>} · <Badge tone="warn">{r.evidence_level.replace("_", " ")}</Badge></div>
                  <Button variant="primary" onClick={() => downloadText(r.filename, JSON.stringify(r.dump), "application/json")}>Download {r.filename}</Button>
                </div>
              )}
            </div>
          ))}
          <h3 className="font-semibold mt-2">Inspect an official backup (read-only, never uploaded anywhere)</h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">MC8 editor backup<input type="file" accept=".json,application/json" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setMc8Inspect(await api.rigs.inspectMc8(await f.text())); }} /></label>
            <label className="flex flex-col gap-1">ML10X editor backup<input type="file" accept=".json,application/json" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setMlInspect(await api.rigs.inspectMl10x(await f.text())); }} /></label>
          </div>
          {mc8Inspect && (
            <div className="border border-line rounded p-2">
              <div>{mc8Inspect.ok ? <Badge tone="ok">valid MC8 {mc8Inspect.dump_type}</Badge> : <Badge tone="bad">{mc8Inspect.problems.join("; ")}</Badge>} hash {mc8Inspect.hash_matches === null ? "n/a" : mc8Inspect.hash_matches ? "matches" : "MISMATCH"}</div>
              {mc8Inspect.banks.map((b) => <div key={String(b.bank_number)}>Bank {b.bank_number} “{b.bank_name}”: {b.used_presets.map((p) => `${p.position} ${p.short_name} (${p.message_count}: ${p.types.join("/")})`).join(", ") || "empty"}</div>)}
            </div>
          )}
          {mlInspect && (
            <div className="border border-line rounded p-2">
              <div>{mlInspect.ok ? <Badge tone="ok">ML10X backup shape recognised</Badge> : <Badge tone="bad">{mlInspect.problems.join("; ")}</Badge>} · MIDI channel {mlInspect.midi_channel ?? "?"} (0 = ignore) · device id {mlInspect.device_id ?? "?"} · {String(JSON.stringify(mlInspect.settings))}</div>
              <div>Connectors: {mlInspect.connectors.map((c) => `${c.id}:${c.name}`).join(", ")}</div>
              <div>Named presets: {mlInspect.presets.slice(0, 40).map((p) => `${p.global_number} ${p.name}${p.advanced_mode ? " [adv]" : ""}`).join(", ")}{mlInspect.presets.length > 40 ? " …" : ""}</div>
              <div className="text-neutral-500">Routing is not decoded (matrixArray semantics unknown) — this is why no ML10X file is written.</div>
            </div>
          )}
          {analysis && analysis.summary.errors > 0 && <p className="text-red-700">The rig has {analysis.summary.errors} error(s); native export is refused until they are fixed.</p>}
        </div>
      </Panel>
    </div>
  );
}
