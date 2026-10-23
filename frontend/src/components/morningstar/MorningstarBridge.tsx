"use client";

import { useEffect, useState } from "react";
import { Badge, Panel } from "@/components/ui/basics";
import { bridgeApi, describeError, type BridgeStatus, type InspectReport } from "@/lib/morningstar";
import { FilePicker, NativeSummaryPanel, UnknownKeysTable } from "./bits";
import { Mc8Inspector } from "./Mc8Inspector";
import { Mc8Compare } from "./Mc8Compare";
import { Mc8Propose } from "./Mc8Propose";
import { Ml10xInspector } from "./Ml10xInspector";

type Mode = "inspect" | "compare" | "propose";

/**
 * Morningstar Bridge: load an official editor backup (MC8 or ML10X), inspect what it holds with
 * known / third-party / unknown made explicit, compare an MC8 bank with a rig's modeled intent,
 * and review a proposed modification before any file is produced. Offline: the file text goes to
 * the local backend and nowhere else; nothing talks to a controller.
 */
export function MorningstarBridge() {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [report, setReport] = useState<InspectReport | null>(null);
  const [mode, setMode] = useState<Mode>("inspect");
  const [bankIndex, setBankIndex] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    bridgeApi.status().then(setStatus).catch((e) => setErr(describeError(e)));
  }, []);
  const load = async (text: string, name: string) => {
    setBusy(true);
    setErr(null);
    setReport(null);
    setFileText(text);
    setFileName(name);
    setBankIndex(0);
    setMode("inspect");
    try {
      const r = await bridgeApi.inspect(text);
      setReport(r);
      if (r.device === "mc8" && r.interpreted) {
        const first = r.interpreted.banks.findIndex((b) => b.used);
        setBankIndex(first >= 0 ? first : 0);
      }
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setBusy(false);
    }
  };
  const mc8 = report?.device === "mc8" ? report : null;
  const ml10x = report?.device === "ml10x" ? report : null;
  return (
    <div className="flex flex-col gap-3 p-3 w-full max-w-[1400px] mx-auto">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Morningstar Bridge</h1>
        <p className="text-xs text-neutral-600 max-w-3xl">
          Import an MC8 or ML10X editor backup, see exactly what it holds, compare a bank with what Signal Loom would write, and review changes before any
          file leaves this page. The official Morningstar editors stay the tool that programs the hardware; nothing here talks to a controller.
        </p>
        {status && (
          <div className="flex flex-wrap gap-1 text-xs" data-testid="bridge-status">
            {Object.entries(status).map(([k, v]) => (
              <span key={k} title={v.note} className="inline-flex items-center gap-1 border border-line rounded px-1.5 py-0.5 bg-panel">
                {k.replace(/_/g, " ")} <Badge tone={v.level === "blocked" || !v.available ? "bad" : v.level === "fixture_validated" ? "ok" : "warn"}>{v.level.replace(/_/g, " ")}</Badge>
              </span>
            ))}
          </div>
        )}
      </header>
      <Panel title="Backup file">
        <div className="grid md:grid-cols-[320px_1fr] gap-3 items-start">
          <FilePicker label="MC8 or ML10X editor backup (.json)" testId="bridge-file" onText={load} hint="Controller Backup → Current Bank / All Banks (MC8) or Device Backup (ML10X). Read locally; never uploaded anywhere else." />
          <div>
            {busy && <p className="text-xs text-neutral-500">Reading…</p>}
            {err && <p className="text-xs text-red-700" role="alert" data-testid="bridge-error">{err}</p>}
            {report && <NativeSummaryPanel native={report.native} fileName={fileName} />}
            {report && report.device === null && (
              <div className="mt-2">
                <p className="text-xs text-neutral-600 mb-1">The file is kept as an opaque snapshot. Keys found at the top level and in <code>data</code>:</p>
                <UnknownKeysTable keys={report.native.unknown_keys} />
              </div>
            )}
            {!report && !busy && !err && <p className="text-xs text-neutral-500">No file loaded. Export one from the Morningstar editor and choose it here.</p>}
          </div>
        </div>
      </Panel>
      {mc8 && mc8.interpreted && fileText && (
        <>
          <div role="tablist" aria-label="Bridge workflow" className="flex gap-1">
            {(["inspect", "compare", "propose"] as const).map((m) => (
              <button key={m} role="tab" type="button" aria-selected={mode === m} onClick={() => setMode(m)} data-testid={`bridge-mode-${m}`}
                className={`px-3 py-1 text-sm rounded border ${mode === m ? "bg-accent text-white border-accent" : "bg-panel border-line hover:bg-neutral-100"}`}>
                {m === "inspect" ? "Inspect" : m === "compare" ? "Compare with a rig" : "Propose changes"}
              </button>
            ))}
            {mc8.native.dump_type === "allBanks" && <span className="text-xs text-neutral-500 self-center ml-2">Working on bank {mc8.interpreted.banks[bankIndex]?.number} (pick another in Inspect → Banks).</span>}
          </div>
          {mode === "inspect" && <Mc8Inspector report={mc8} bankIndex={bankIndex} onBankIndex={setBankIndex} />}
          {mode === "compare" && <Mc8Compare report={mc8} fileText={fileText} bankIndex={bankIndex} />}
          {mode === "propose" && <Mc8Propose key={bankIndex} report={mc8} fileText={fileText} bankIndex={bankIndex} />}
        </>
      )}
      {ml10x && ml10x.interpreted && fileText && <Ml10xInspector report={ml10x} fileText={fileText} />}
    </div>
  );
}
