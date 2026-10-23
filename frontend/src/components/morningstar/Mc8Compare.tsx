"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Rig, RigSummary } from "@/lib/types";
import { Badge, Button, Panel } from "@/components/ui/basics";
import { bridgeApi, describeError, type CompareReport, type Mc8Report } from "@/lib/morningstar";
import { StatusBadge } from "./bits";

/**
 * Controller configuration (the native bank) vs Signal Loom's modeled intent (the rig's compiled
 * MC8 bank, rendered through the same writer). Read-only: nothing is changed on either side.
 */
export function Mc8Compare({ report, fileText, bankIndex }: { report: Mc8Report; fileText: string; bankIndex: number }) {
  const [rigs, setRigs] = useState<RigSummary[] | null>(null);
  const [rigId, setRigId] = useState<string>("");
  const [rig, setRig] = useState<Rig | null>(null);
  const [bankNumber, setBankNumber] = useState<number | null>(null);
  const [result, setResult] = useState<CompareReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nativeBank = report.interpreted?.banks[bankIndex] ?? report.interpreted?.banks[0];
  useEffect(() => {
    api.rigs.list().then((l) => { setRigs(l); if (l.length && !rigId) setRigId(l[0].id); }).catch((e) => setErr(describeError(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!rigId) return;
    api.rigs.get(rigId).then((r) => {
      setRig(r);
      const banks = [...r.controllers.mc8.banks].sort((a, b) => a.number - b.number);
      const match = banks.find((b) => b.number === nativeBank?.number) ?? banks[0];
      setBankNumber(match?.number ?? null);
    }).catch((e) => setErr(describeError(e)));
  }, [rigId, nativeBank?.number]);
  const run = async () => {
    if (!rigId) return;
    setBusy(true);
    setErr(null);
    try {
      setResult(await bridgeApi.compare(fileText, rigId, bankNumber, report.native.dump_type === "allBanks" ? bankIndex : null));
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setBusy(false);
    }
  };
  const banks = rig ? [...rig.controllers.mc8.banks].sort((a, b) => a.number - b.number) : [];
  return (
    <div className="flex flex-col gap-3 text-xs">
      <p className="text-neutral-600">
        Left: what the controller holds (bank {nativeBank?.number} “{nativeBank?.name}” from the file). Right: what Signal Loom would write for a rig’s bank from its scenes and
        switch assignments. Messages the rig cannot express (anything but PC/CC) are listed as <em>controller only</em>, never as something to remove.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">Rig
          <select aria-label="Rig" value={rigId} onChange={(e) => { setRigId(e.target.value); setResult(null); }} disabled={!rigs}>
            {(rigs ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">Rig bank
          <select aria-label="Rig bank" value={bankNumber ?? ""} onChange={(e) => { setBankNumber(Number(e.target.value)); setResult(null); }} disabled={!banks.length}>
            {banks.map((b) => <option key={b.number} value={b.number}>{b.number} — {b.name}</option>)}
          </select>
        </label>
        <Button variant="primary" onClick={run} disabled={busy || !rigId || bankNumber === null} data-testid="compare-run">Compare</Button>
        {rig && !banks.length && <span className="text-neutral-500">This rig has no MC8 banks yet.</span>}
      </div>
      {err && <p className="text-red-700" role="alert">{err}</p>}
      {result && (
        <Panel title={`Bank ${result.summary.native_bank_number ?? "?"} on the controller vs rig “${result.rig.name}” bank ${result.rig.bank_number} “${result.rig.bank_name}”`}>
          <div className="flex flex-wrap gap-2 mb-2" data-testid="compare-summary">
            <Badge tone={result.summary.identical ? "ok" : "warn"}>{result.summary.identical ? "identical where Signal Loom models" : "differences found"}</Badge>
            <Badge tone="ok">{result.summary.same} same</Badge>
            <Badge tone={result.summary.differs ? "warn" : "neutral"}>{result.summary.differs} differ</Badge>
            <Badge tone={result.summary.only_native ? "bad" : "neutral"}>{result.summary.only_native} controller only</Badge>
            <Badge tone={result.summary.only_modeled ? "bad" : "neutral"}>{result.summary.only_modeled} Signal Loom only</Badge>
            <Badge>{result.summary.both_empty} empty on both</Badge>
            {!result.bank.name_same && <Badge tone="warn">bank name differs: “{result.bank.native_name}” vs “{result.bank.modeled_name}”</Badge>}
            {result.bank.native_bank_messages > 0 && <Badge tone="warn">{result.bank.native_bank_messages} bank message(s) on the controller — not modelled</Badge>}
          </div>
          {result.plan_diagnostics.length > 0 && <p className="text-amber-800 mb-2">Signal Loom’s plan has diagnostics: {result.plan_diagnostics.map((d) => d.message).join(" ")}</p>}
          <table className="w-full" data-testid="compare-table">
            <thead><tr className="text-left text-neutral-500"><th>Switch</th><th>Status</th><th>Controller (native)</th><th>Signal Loom (modeled)</th><th>Differences</th></tr></thead>
            <tbody>
              {result.positions.filter((p) => p.status !== "both_empty").map((p) => (
                <tr key={p.position} className="border-t border-line align-top" data-testid={`compare-${p.position}`}>
                  <td className="font-semibold">{p.position}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td>
                    <div className="font-mono">{p.native.short_name || "—"}{p.native.toggle_mode ? " · toggle" : ""}</div>
                    <ul className="pl-3 list-disc">{p.native.messages.map((m) => <li key={m.slot} className={m.supported ? "" : "text-amber-800"}>{m.summary}{m.supported ? "" : " (not modelled)"}</li>)}</ul>
                  </td>
                  <td>
                    <div className="font-mono">{p.modeled.short_name || "—"}{p.modeled.scene_name ? ` · scene “${p.modeled.scene_name}”` : ""}{p.modeled.toggle_mode ? " · toggle" : ""}</div>
                    <ul className="pl-3 list-disc">{p.modeled.messages.map((m) => <li key={m.slot}>{m.summary}</li>)}</ul>
                  </td>
                  <td className="text-neutral-600">{p.differences.map((d) => d.replace(/_/g, " ")).join(", ") || (p.status === "same" ? "—" : "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-neutral-500 mt-2">{result.bank.note}</p>
        </Panel>
      )}
    </div>
  );
}
