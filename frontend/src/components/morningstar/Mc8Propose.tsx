"use client";

import { useState } from "react";
import { downloadText } from "@/lib/api";
import { Badge, Button, Panel } from "@/components/ui/basics";
import { bridgeApi, describeError, type Edit, type Mc8Bank, type Mc8Message, type Mc8Preset, type Mc8Report, type ProposeResult } from "@/lib/morningstar";
import { StatusBadge } from "./bits";

const ACTIONS: [number, string][] = [[0, "No Action"], [1, "Press"], [2, "Release"], [3, "Long Press"], [4, "Long Press Release"], [5, "Double Tap"], [6, "Double Tap Release"], [7, "Long Double Tap"], [8, "Long Double Tap Release"], [9, "Release All"], [10, "Long Press Scroll"]];
const TG: [number, string][] = [[0, "Pos 1"], [1, "Pos 2"], [2, "Both"]];

type Path = (string | number)[];
const key = (p: Path) => JSON.stringify(p);

/**
 * Proposed modification: edits on an allow-list of known fields, reviewed as a diff against the
 * native snapshot before a singleBank file is produced. Slots of types Signal Loom cannot model are
 * shown locked: they are preserved verbatim and can only be changed in the official editor.
 */
export function Mc8Propose({ report, fileText, bankIndex }: { report: Mc8Report; fileText: string; bankIndex: number }) {
  const bank = report.interpreted?.banks[bankIndex] ?? report.interpreted?.banks[0];
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [sel, setSel] = useState<string>(() => bank?.presets.find((p) => p.used)?.position ?? "A");
  const [result, setResult] = useState<ProposeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!bank) return null;
  const list = Object.values(edits);
  const set = (path: Path, value: unknown) => { setResult(null); setEdits((e) => ({ ...e, [key(path)]: { path, value } })); };
  const get = <T,>(path: Path, fallback: T): T => (key(path) in edits ? (edits[key(path)].value as T) : fallback);
  const presets = [...bank.presets, ...bank.exp_presets];
  const current = presets.find((p) => p.position === sel) ?? presets[0];
  // The backend refuses a native proposal from an input it cannot verify; say so up front instead of
  // letting the musician edit and then fail at review. Inspection and compare stay available.
  const refusal =
    report.native.hash === null
      ? "its integrity hash is missing, so the file cannot be verified"
      : report.native.hash_matches === false
        ? "its integrity hash does not match its data (edited by hand or written by another serializer); Signal Loom never re-hashes an unverifiable file"
        : report.native.schema_version !== 1
          ? `its schemaVersion is ${String(report.native.schema_version)}; Signal Loom only writes the fixture-validated schema 1 and never rewrites another version`
          : null;
  const arr = current.is_exp ? "expPresetArray" : "presetArray";
  const review = async () => {
    setBusy(true);
    setErr(null);
    try {
      setResult(await bridgeApi.propose(fileText, list, report.native.dump_type === "allBanks" ? bankIndex : null));
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setBusy(false);
    }
  };
  const nameField = (label: string, path: Path, value: string, cap: number) => (
    <label className="flex flex-col gap-0.5">{label} <span className="text-[10px] text-neutral-400">(longest seen in real exports: {cap})</span>
      <input aria-label={label} value={get(path, value)} onChange={(e) => set(path, e.target.value)} />
    </label>
  );
  const flag = (label: string, path: Path, value: boolean) => (
    <label className="flex items-center gap-1"><input type="checkbox" checked={get(path, value)} onChange={(e) => set(path, e.target.checked)} /> {label}</label>
  );
  const messageRow = (m: Mc8Message, p: Mc8Preset) => {
    const base: Path = [arr, p.index, "msgArray", m.slot];
    const locked = m.status === "third_party" || m.status === "unknown";
    const t = get<number>([...base, "t"], m.type_code ?? 0);
    if (locked) {
      return (
        <tr key={m.slot} className="border-t border-line text-neutral-500" data-testid={`propose-slot-${m.slot}`}>
          <td>{m.slot}</td><td colSpan={6}><StatusBadge status={m.status} /> {m.summary} — preserved verbatim; change it in the official editor.</td>
        </tr>
      );
    }
    const raw = m.raw ?? {};
    const num = (k: string, fb: number) => get<number>([...base, k], typeof raw[k] === "number" ? (raw[k] as number) : fb);
    return (
      <tr key={m.slot} className="border-t border-line" data-testid={`propose-slot-${m.slot}`}>
        <td>{m.slot}</td>
        <td>
          <select aria-label={`Slot ${m.slot} type`} value={t} onChange={(e) => set([...base, "t"], Number(e.target.value))}>
            <option value={0}>Empty</option><option value={1}>Program Change</option><option value={2}>Control Change</option>
          </select>
        </td>
        <td><input aria-label={`Slot ${m.slot} channel`} type="number" min={1} max={16} className="w-14" disabled={t === 0} value={num("c", 1)} onChange={(e) => set([...base, "c"], Number(e.target.value))} /></td>
        <td><input aria-label={`Slot ${m.slot} number`} type="number" min={0} max={127} className="w-16" disabled={t === 0} value={num("d1", 0)} onChange={(e) => set([...base, "d1"], Number(e.target.value))} /></td>
        <td><input aria-label={`Slot ${m.slot} value`} type="number" min={0} max={127} className="w-16" disabled={t !== 2} value={num("d2", 0)} onChange={(e) => set([...base, "d2"], Number(e.target.value))} /></td>
        <td>
          <select aria-label={`Slot ${m.slot} action`} disabled={t === 0} value={num("a", 1)} onChange={(e) => set([...base, "a"], Number(e.target.value))}>
            {ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </td>
        <td>
          <select aria-label={`Slot ${m.slot} toggle position`} disabled={t === 0} value={num("tg", 2)} onChange={(e) => set([...base, "tg"], Number(e.target.value))}>
            {TG.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </td>
      </tr>
    );
  };
  const messagesFor = (p: Mc8Preset): Mc8Message[] => {
    // Every slot is editable; the report compacts clean empty slots, so rebuild the 16-slot view.
    const bySlot = new Map(p.messages.map((m) => [m.slot, m]));
    return Array.from({ length: p.messages.length }, (_, i) => bySlot.get(i) ?? { slot: i, status: "empty" as const, summary: "—", anomalies: [], unknown_keys: [] });
  };
  return (
    <div className="flex flex-col gap-3 text-xs">
      <p className="text-neutral-600">
        Change only what Signal Loom understands (names, flags, PC/CC messages). Everything else in the file — other message types, bytes <code>d3</code>/<code>d4</code>/<code>mi</code>,
        unknown keys — is carried over untouched. Nothing is written until you review the diff; the output is a <b>single-bank</b> file with a fresh integrity hash.
      </p>
      {refusal && (
        <p className="text-red-700 border border-red-200 bg-red-50 rounded px-2 py-1" role="alert" data-testid="propose-refused">
          No proposal can be produced from this file: {refusal}. Inspect and compare still work; export the bank again from the official editor to get a verifiable file.
        </p>
      )}
      <Panel title={`Bank ${bank.number}`}>
        <div className="flex flex-wrap gap-3 items-end">
          {nameField("Bank name", ["bankName"], bank.name, 24)}
          {flag("Clear toggles on bank change", ["bankClearToggle"], bank.clear_toggle)}
        </div>
      </Panel>
      <div className="flex flex-wrap gap-1" role="listbox" aria-label="Preset to edit">
        {presets.map((p) => (
          <button key={p.position} type="button" role="option" aria-selected={sel === p.position} onClick={() => setSel(p.position)} data-testid={`propose-preset-${p.position}`}
            className={`rounded border px-2 py-0.5 ${sel === p.position ? "bg-accent text-white border-accent" : p.used ? "border-line bg-panel" : "border-line bg-neutral-50 text-neutral-400"}`}>
            {p.position} <span className="font-mono">{get<string>([arr === "expPresetArray" && p.is_exp ? "expPresetArray" : "presetArray", p.index, "shortName"], p.short_name) || "—"}</span>
          </button>
        ))}
      </div>
      <Panel title={`Preset ${current.position}`}>
        <div className="flex flex-wrap gap-3 items-end mb-2">
          {nameField("Short name", [arr, current.index, "shortName"], current.short_name, 10)}
          {nameField("Toggle name", [arr, current.index, "toggleName"], current.toggle_name, 9)}
          {nameField("Long name", [arr, current.index, "longName"], current.long_name, 23)}
          {flag("Preset toggle", [arr, current.index, "toToggle"], current.toggle_mode)}
          {flag("Blink", [arr, current.index, "toBlink"], current.blink)}
          {flag("Message scroll", [arr, current.index, "toMsgScroll"], current.message_scroll)}
        </div>
        <table className="w-full" data-testid="propose-messages">
          <thead><tr className="text-left text-neutral-500"><th>Slot</th><th>Type</th><th>Ch</th><th>Number</th><th>Value</th><th>Action</th><th>Toggle pos.</th></tr></thead>
          <tbody>{messagesFor(current).map((m) => messageRow(m, current))}</tbody>
        </table>
      </Panel>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={review} disabled={busy || !!refusal} data-testid="propose-review">Review {list.length} change{list.length === 1 ? "" : "s"}</Button>
        <Button onClick={() => { setEdits({}); setResult(null); }} disabled={!list.length}>Discard edits</Button>
        {report.native.dump_type === "allBanks" && <Badge tone="warn">this lifts bank {bank.number} out of the all-banks file into a single-bank file</Badge>}
      </div>
      {err && <p className="text-red-700" role="alert" data-testid="propose-error">{err}</p>}
      {result && (
        <Panel title="Review before download">
          <div className="flex flex-wrap gap-2 mb-2" data-testid="propose-result">
            <Badge tone={result.diff.total ? "warn" : "ok"}>{result.diff.total} field change{result.diff.total === 1 ? "" : "s"} vs the original</Badge>
            <Badge tone={result.self_check.ok ? "ok" : "bad"}>{result.self_check.ok ? "self-check: structure + hash OK" : result.self_check.problems.join("; ")}</Badge>
            {result.preserved.byte_identical_to_input && <Badge tone="ok">byte-identical to the input</Badge>}
            <Badge>{result.preserved.third_party_messages} third-party + {result.preserved.unknown_type_messages} unknown-type messages preserved</Badge>
            <Badge>{result.preserved.unknown_keys} unknown keys preserved</Badge>
          </div>
          {result.diff.total > 0 && (
            <table className="w-full mb-2" data-testid="propose-diff">
              <thead><tr className="text-left text-neutral-500"><th>Where</th><th>Before</th><th>After</th></tr></thead>
              <tbody>
                {result.diff.changes.map((c, i) => <tr key={i} className="border-t border-line"><td>{c.label}</td><td className="font-mono">{JSON.stringify(c.before)}</td><td className="font-mono">{JSON.stringify(c.after)}</td></tr>)}
              </tbody>
            </table>
          )}
          <ul className="text-amber-800 list-disc pl-4 mb-2">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          <Button variant="primary" onClick={() => downloadText(result.filename, result.text, "application/json")} data-testid="propose-download">Download {result.filename}</Button>
        </Panel>
      )}
    </div>
  );
}

export type { Mc8Bank };
