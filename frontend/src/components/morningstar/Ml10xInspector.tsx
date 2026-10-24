"use client";

import { useState } from "react";
import { Badge, Button, Panel } from "@/components/ui/basics";
import { bridgeApi, describeError, type MatrixDiff, type Ml10xPreset, type Ml10xReport } from "@/lib/morningstar";
import { AnomalyList, EvidenceTag, FilePicker, KeyValue, UnknownKeysTable } from "./bits";

function MatrixView({ p }: { p: Ml10xPreset }) {
  const rows = Object.entries(p.routing.matrix).sort((a, b) => Number(a[0]) - Number(b[0]));
  const nz = new Map(p.routing.nonzero_rows.map((r) => [r.row, r]));
  return (
    <div className="flex flex-col gap-1" data-testid="ml10x-matrix">
      <p className="text-[11px] text-amber-800">Routing: {p.routing.status}.</p>
      <p className="text-[11px] text-neutral-500">{p.routing.row_hypothesis_note}</p>
      <table className="w-auto text-[11px]">
        <thead><tr className="text-left text-neutral-500"><th>Row</th><th>Bytes (verbatim)</th><th>Set bits</th><th>Row observation</th></tr></thead>
        <tbody>
          {rows.map(([k, v]) => {
            const r = nz.get(k);
            return (
              <tr key={k} className={`border-t border-line ${r ? "" : "text-neutral-400"}`}>
                <td>{k}</td>
                <td className="font-mono">{Array.isArray(v) ? v.join(" ") : JSON.stringify(v)}</td>
                <td className="font-mono">{r ? r.bits.join(", ") : "—"}</td>
                <td>{r ? (r.hypothesis ? <span>{r.hypothesis} <Badge tone="warn">hypothesis</Badge></span> : <Badge tone="bad">no observation</Badge>) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Ml10xInspector({ report, fileText }: { report: Ml10xReport; fileText: string }) {
  const interp = report.interpreted;
  const [tab, setTab] = useState<"controller" | "presets" | "experiment" | "unknown">("presets");
  const [bank, setBank] = useState<number>(0);
  const [sel, setSel] = useState<number>(() => interp?.presets[0]?.number ?? 0);
  const [selBank, setSelBank] = useState<number>(() => interp?.presets[0]?.bank ?? 0);
  const [other, setOther] = useState<string | null>(null);
  const [diff, setDiff] = useState<MatrixDiff | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!interp) return null;
  const cov = report.coverage!;
  const names = interp.preset_names.filter((n) => n.bank === bank);
  const current = interp.presets.find((p) => p.bank === selBank && p.number === sel) ?? null;
  const currentName = interp.preset_names.find((n) => n.bank === selBank && n.number === sel);
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-wrap gap-2 items-center" data-testid="ml10x-coverage">
        <Badge>{cov.presets_total} presets</Badge>
        <Badge tone="ok">{cov.presets_used} in use</Badge>
        <Badge>{cov.presets_advanced} advanced</Badge>
        <Badge tone="warn">{cov.presets_with_matrix_data} with routing data (undecoded)</Badge>
        <Badge>{cov.connectors} connectors</Badge>
        <Badge tone={cov.anomalies ? "warn" : "ok"}>{cov.anomalies} anomalies</Badge>
        <Badge tone="bad">routing authorship: blocked</Badge>
        <Badge tone="warn">preset proposals: candidate file only</Badge>
      </div>
      <div role="tablist" aria-label="ML10X views" className="flex gap-1 border-b border-line">
        {(["presets", "controller", "experiment", "unknown"] as const).map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={`px-3 py-1 rounded-t ${tab === t ? "bg-accent text-white" : "hover:bg-neutral-100"}`}>
            {t === "presets" ? "Presets & routing" : t === "controller" ? "Controller & connectors" : t === "experiment" ? "Routing experiment" : `Unknown data (${report.native.unknown_keys.length})`}
          </button>
        ))}
      </div>
      {tab === "controller" && (
        <div className="grid lg:grid-cols-2 gap-3 items-start" data-testid="ml10x-controller">
          <Panel title="Controller settings">
            <table className="w-full">
              <thead><tr className="text-left text-neutral-500"><th>Setting</th><th>Value</th><th>Evidence</th><th>Note</th></tr></thead>
              <tbody>
                {interp.controller.fields.map((f) => <tr key={f.key} className="border-t border-line align-top"><td>{f.label}</td><td className="font-mono">{JSON.stringify(f.value)}</td><td><EvidenceTag evidence={f.evidence} /></td><td className="text-neutral-600">{f.note}</td></tr>)}
              </tbody>
            </table>
          </Panel>
          <Panel title="Connectors (14: 10 loop conductors + input/output tip & ring)">
            <table className="w-full">
              <thead><tr className="text-left text-neutral-500"><th>Id</th><th>Jack</th><th>Name</th><th>Short</th><th>Spillover</th><th>Labels</th></tr></thead>
              <tbody>
                {interp.controller.connectors.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td>{c.id}</td><td>{c.label}{c.loop ? ` (loop ${c.loop})` : ""}</td><td className="font-mono">{c.name}</td><td className="font-mono">{c.short_name}</td>
                    <td>{c.trails ? <Badge tone="ok">trails on</Badge> : "—"}</td><td className="text-neutral-500">{c.input_name} / {c.output_name}{c.unknown_keys.length ? ` · unknown: ${c.unknown_keys.join(", ")}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-neutral-500 mt-1">Connector ids 0–9 follow the loop order A Tip, A Ring … E Ring; 10–13 are Input/Output Tip/Ring (third-party editor analysis, consistent with the sample’s own names).</p>
          </Panel>
          <AnomalyList items={interp.anomalies} />
        </div>
      )}
      {tab === "presets" && (
        <div className="grid lg:grid-cols-[1fr_1fr] gap-3 items-start">
          <div className="flex flex-col gap-2">
            <div className="flex gap-1" role="tablist" aria-label="ML10X bank">
              {interp.banks.map((b) => (
                <Button key={b.bank} role="tab" aria-selected={bank === b.bank} variant={bank === b.bank ? "primary" : "default"} onClick={() => setBank(b.bank)} data-testid={`ml10x-bank-${b.bank}`}>Bank {b.bank + 1} <span className="text-[10px] opacity-70">({b.used} used)</span></Button>
              ))}
            </div>
            <div className="grid grid-cols-8 gap-0.5" role="listbox" aria-label="Presets">
              {names.map((n) => (
                <button key={n.number} type="button" role="option" aria-selected={selBank === n.bank && sel === n.number} onClick={() => { setSel(n.number); setSelBank(n.bank); }}
                  data-testid={`ml10x-preset-${n.bank}-${n.number}`} title={n.name}
                  className={`rounded border px-1 py-0.5 text-[10px] text-left truncate ${selBank === n.bank && sel === n.number ? "bg-accent text-white border-accent" : n.occupancy === "occupied" ? "bg-panel border-neutral-400" : "bg-neutral-50 border-line text-neutral-400"}`}>
                  {n.number}{n.advanced ? "ᴬ" : ""} <span className="font-mono">{n.occupancy === "occupied" ? n.name : ""}</span>
                </button>
              ))}
            </div>
          </div>
          <Panel title={`Bank ${selBank + 1} preset ${sel}${currentName?.name ? ` — ${currentName.name}` : ""}`}>
            {current ? (
              <div className="flex flex-col gap-2" data-testid="ml10x-preset-detail">
                <KeyValue
                  rows={[
                    { k: "Name", v: <code>{current.name}</code> },
                    { k: "Mode", v: <span>{current.advanced_mode ? "Advanced" : "Simple"} <EvidenceTag evidence="third_party" /></span> },
                    { k: "Spillover", v: `tip: ${current.spillover.tip_label} · ring: ${current.spillover.ring_label}` },
                    { k: "Bypass bitmap", v: <span className="font-mono">{String(current.bypass_raw)} <span className="font-sans text-neutral-500">— {current.bypass_note}</span></span> },
                    { k: "MIDI program", v: `PC ${current.number} after CC#0 = ${current.bank} (documented)` },
                  ]}
                />
                <AnomalyList items={[...current.anomalies, ...current.unknown_keys.map((k) => `unknown key “${k}” preserved`)]} />
                <MatrixView p={current} />
              </div>
            ) : (
              <p className="text-neutral-500">
                {currentName?.occupancy === "empty"
                  ? <>Factory-empty slot: name “{currentName?.name}”, no routing data, Simple mode, bypass 0, spillover off. Nothing to interpret.</>
                  : <>Preset “{currentName?.name}”: {currentName?.occupancy_reason}. No routing data to show.</>}
              </p>
            )}
          </Panel>
        </div>
      )}
      {tab === "experiment" && (
        <div className="flex flex-col gap-2" data-testid="ml10x-experiment">
          <p className="text-neutral-600">
            The routing matrix can only be decoded from controlled pairs: export, change exactly one loop in the official editor, export again. Load the second
            backup here; the rows that moved are listed with their observed connector label.
          </p>
          <FilePicker label="Second ML10X backup (after the change)" testId="ml10x-second-file" onText={(t) => { setOther(t); setDiff(null); }} />
          <div><Button variant="primary" disabled={!other} onClick={async () => { try { setErr(null); setDiff(await bridgeApi.matrixDiff(fileText, other!)); } catch (e) { setErr(describeError(e)); } }} data-testid="ml10x-matrix-diff">Compare routing data</Button></div>
          {err && <p className="text-red-700" role="alert">{err}</p>}
          {diff && (
            <Panel title={`${diff.summary.presets_changed} preset(s) changed · ${diff.summary.matrix_rows_changed} matrix row(s) · ${diff.summary.controller_fields_changed} controller field(s) · ${diff.structural.total} structural change(s)`}>
              <div data-testid="ml10x-matrix-diff-result" className="flex flex-col gap-2">
                {diff.presets.map((p) => (
                  <div key={`${p.bank}-${p.number}`} className="border border-line rounded p-2">
                    <div className="font-semibold">Bank {p.bank + 1} preset {p.number} “{p.name_a}”{p.name_b !== p.name_a ? ` → “${p.name_b}”` : ""}</div>
                    {p.matrix_rows.length > 0 && (
                      <table className="w-auto mt-1">
                        <thead><tr className="text-left text-neutral-500"><th>Row</th><th>Observation</th><th>Before</th><th>After</th><th>Bits before</th><th>Bits after</th></tr></thead>
                        <tbody>{p.matrix_rows.map((r) => <tr key={r.row} className="border-t border-line"><td>{r.row}</td><td>{r.hypothesis ?? "—"}</td><td className="font-mono">{r.before?.join(" ") ?? "—"}</td><td className="font-mono">{r.after?.join(" ") ?? "—"}</td><td className="font-mono">{r.bits_before.join(", ") || "—"}</td><td className="font-mono">{r.bits_after.join(", ") || "—"}</td></tr>)}</tbody>
                      </table>
                    )}
                    {p.other_fields.length > 0 && <p className="text-neutral-600 mt-1">Other fields: {p.other_fields.map((f) => `${f.field} ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`).join("; ")}</p>}
                  </div>
                ))}
                {diff.controller_changes.length > 0 && <p>Controller: {diff.controller_changes.map((f) => `${f.field} ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`).join("; ")}</p>}
                <p className="text-[11px] text-neutral-500">{diff.summary.hint}</p>
              </div>
            </Panel>
          )}
        </div>
      )}
      {tab === "unknown" && <UnknownKeysTable keys={report.native.unknown_keys} />}
    </div>
  );
}
