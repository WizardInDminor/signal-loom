"use client";

import { useMemo, useRef, useState } from "react";
import { downloadText } from "@/lib/api";
import { Badge, Button, Panel } from "@/components/ui/basics";
import { bridgeApi, describeError, type Ml10xOperation, type Ml10xProposeResult, type Ml10xReport, type Ml10xSlotName, type Ml10xSlotRef } from "@/lib/morningstar";
import { KeyValue } from "./bits";

const COLS = 8;
const NAME_WIRE_BYTES = 12;
const NAME_EDITOR_MAX = 16;
const CONNECTOR_CAPS = { name: 16, shortName: 4 } as const;

type Command = "rename" | "copy" | "move" | "swap";
type Slot = { bank: number; number: number; name: string; occupancy: Ml10xSlotName["occupancy"]; advanced: boolean; reason: string };
type OnOccupied = "" | "swap" | "overwrite";

const key = (s: Ml10xSlotRef) => `${s.bank}:${s.preset}`;
const same = (a: Ml10xSlotRef | null, b: Ml10xSlotRef | null) => !!a && !!b && a.bank === b.bank && a.preset === b.preset;
const label = (s: Ml10xSlotRef) => `Bank ${s.bank + 1} · preset ${s.preset}`;
const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;
const isAsciiPrintable = (s: string) => Array.from(s).every((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126);

/** Project the pending operations onto the slot table so the grid shows what the candidate will hold. */
function project(base: Map<string, Slot>, ops: Ml10xOperation[]): { slots: Map<string, Slot>; touched: Set<string> } {
  const slots = new Map(Array.from(base, ([k, v]) => [k, { ...v }]));
  const touched = new Set<string>();
  const empty = (bank: number, number: number): Slot => ({ bank, number, name: "Empty", occupancy: "empty", advanced: false, reason: "factory payload" });
  const at = (r: Ml10xSlotRef) => slots.get(key(r))!;
  const put = (r: Ml10xSlotRef, s: Slot) => { slots.set(key(r), { ...s, bank: r.bank, number: r.preset }); touched.add(key(r)); };
  for (const op of ops) {
    if (op.op === "rename") put(op.slot, { ...at(op.slot), name: op.name, occupancy: "occupied" });
    else if (op.op === "copy") put(op.destination, at(op.source));
    else if (op.op === "move") {
      const src = at(op.source), dst = at(op.destination);
      if (dst.occupancy === "occupied" && op.on_occupied === "swap") { put(op.destination, src); put(op.source, dst); }
      else { put(op.destination, src); put(op.source, empty(op.source.bank, op.source.preset)); }
    } else if (op.op === "swap") { const a = at(op.a), b = at(op.b); put(op.a, b); put(op.b, a); }
  }
  return { slots, touched };
}

function describeOp(op: Ml10xOperation, slots: Map<string, Slot>): string {
  switch (op.op) {
    case "rename": return `Rename ${label(op.slot)} to “${op.name}”`;
    case "copy": return `Copy ${label(op.source)} “${slots.get(key(op.source))?.name}” → ${label(op.destination)}${op.overwrite ? " (replaces the preset there)" : ""}`;
    case "move": return `Move ${label(op.source)} “${slots.get(key(op.source))?.name}” → ${label(op.destination)}${op.on_occupied === "swap" ? " (swap with the preset there)" : op.on_occupied === "overwrite" ? " (replaces the preset there)" : ""}; the source slot becomes factory-empty`;
    case "swap": return `Swap ${label(op.a)} “${slots.get(key(op.a))?.name}” ↔ ${label(op.b)} “${slots.get(key(op.b))?.name}”`;
    case "rename_connector": return `Connector ${op.connector} ${op.field}: “${op.value}”`;
  }
}

/**
 * ML10X preset management (Native Integration V2): pick a preset, rename / copy / move / swap it, pick the
 * destination without losing the source, review the exact before/after, and download a CANDIDATE Device
 * Backup. Every routing byte travels verbatim; the original file is never touched; nothing talks to a device.
 */
export function Ml10xPropose({ report, fileText }: { report: Ml10xReport; fileText: string }) {
  const interp = report.interpreted!;
  const base = useMemo(() => {
    const m = new Map<string, Slot>();
    for (const n of interp.preset_names) m.set(`${n.bank}:${n.number}`, { bank: n.bank, number: n.number, name: n.name, occupancy: n.occupancy, advanced: n.advanced, reason: n.occupancy_reason });
    return m;
  }, [interp]);
  const [bank, setBank] = useState(0);
  const [source, setSource] = useState<Ml10xSlotRef | null>(() => {
    const first = interp.preset_names.find((n) => n.occupancy === "occupied");
    return first ? { bank: first.bank, preset: first.number } : { bank: 0, preset: 0 };
  });
  const [command, setCommand] = useState<Command | null>(null);
  const [dest, setDest] = useState<Ml10xSlotRef | null>(null);
  const [picking, setPicking] = useState(false);
  const [newName, setNewName] = useState("");
  const [acceptLong, setAcceptLong] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [onOccupied, setOnOccupied] = useState<OnOccupied>("");
  const [ops, setOps] = useState<Ml10xOperation[]>([]);
  const [connectorEdits, setConnectorEdits] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Ml10xProposeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const cellRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const { slots, touched } = useMemo(() => project(base, ops), [base, ops]);
  const src = source ? slots.get(key(source)) ?? null : null;
  const dst = dest ? slots.get(key(dest)) ?? null : null;
  const visible = useMemo(() => Array.from(slots.values()).filter((s) => s.bank === bank).sort((a, b) => a.number - b.number), [slots, bank]);

  // Why a proposal cannot be produced from this file (the backend refuses too; say it up front).
  const refusal =
    report.native.hash === null
      ? "its integrity hash is missing, so the file cannot be verified"
      : report.native.hash_matches === false
        ? "its integrity hash does not match its data (edited by hand or written by another serializer); Signal Loom never re-hashes an unverifiable file"
        : report.native.schema_version !== 1
          ? `its schemaVersion is ${String(report.native.schema_version)}; only the one real sample's schema 1 is supported`
          : report.native.dump_type !== "full"
            ? `its dumpType is ${String(report.native.dump_type)}; only the one real sample's “full” Device Backup is supported`
            : null;

  // Any change to the pending proposal invalidates a previous review; the setters below keep that in one place.
  const updateOps = (f: (o: Ml10xOperation[]) => Ml10xOperation[]) => { setOps(f); setResult(null); };
  const updateConnector = (k: string, value: string) => { setConnectorEdits((m) => ({ ...m, [k]: value })); setResult(null); };

  const startCommand = (c: Command) => { setCommand(c); setDest(null); setPicking(c !== "rename"); setOverwrite(false); setOnOccupied(""); setErr(null); if (c === "rename" && src) { setNewName(src.name); setAcceptLong(false); } };
  const clickSlot = (s: Slot) => {
    const ref = { bank: s.bank, preset: s.number };
    if (picking && command && command !== "rename") { if (!same(ref, source)) { setDest(ref); setOverwrite(false); setOnOccupied(""); } return; }
    setSource(ref); setCommand(null); setDest(null);
  };
  const onGridKey = (e: React.KeyboardEvent) => {
    if (focusIdx === null) return;
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS, Home: -focusIdx, End: visible.length - 1 - focusIdx };
    if (e.key in moves || e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      if (e.key === "PageDown" || e.key === "PageUp") { setBank((b) => Math.max(0, Math.min(interp.banks.length - 1, b + (e.key === "PageDown" ? 1 : -1)))); return; }
      const next = Math.max(0, Math.min(visible.length - 1, focusIdx + moves[e.key]));
      setFocusIdx(next);
      const s = visible[next];
      cellRefs.current.get(`${s.bank}:${s.number}`)?.focus();
    }
  };

  // Validation of the pending command.
  const nameChars = Array.from(newName).length;
  const nameBytes = utf8Bytes(newName);
  const nameProblem = !newName.trim() ? "A name is needed (the factory name is “Empty”)." : !isAsciiPrintable(newName) ? `Printable ASCII only: ${nameChars} characters is ${nameBytes} bytes in UTF-8, and the device's name field is 7-bit.` : nameChars > NAME_EDITOR_MAX ? `${nameChars} characters; the editor allows at most ${NAME_EDITOR_MAX}. Nothing is truncated.` : nameChars > NAME_WIRE_BYTES && !acceptLong ? `${nameChars} characters; the device stores ${NAME_WIRE_BYTES} bytes. Shorten it or accept the uncertainty below.` : null;
  const destProblem = !command || command === "rename" ? null : !dest ? "Pick a destination slot." : same(dest, source) ? "Destination is the source itself." : dst?.occupancy === "occupied" && command === "copy" && !overwrite ? `Occupied by “${dst.name}”: confirm the replacement below or pick another slot.` : dst?.occupancy === "occupied" && command === "move" && !onOccupied ? `Occupied by “${dst.name}”: choose swap or replace below.` : null;
  const canAdd = !!command && !refusal && (command === "rename" ? !nameProblem && !!source : !destProblem && (command !== "move" || src?.occupancy !== "empty"));

  const addOp = () => {
    if (!source || !command) return;
    let op: Ml10xOperation;
    if (command === "rename") op = { op: "rename", slot: source, name: newName, ...(nameChars > NAME_WIRE_BYTES ? { accept_unverified_length: true } : {}) };
    else if (!dest) return;
    else if (command === "copy") op = { op: "copy", source, destination: dest, ...(overwrite ? { overwrite: true } : {}) };
    else if (command === "move") op = { op: "move", source, destination: dest, ...(dst?.occupancy === "occupied" ? { on_occupied: onOccupied as "swap" | "overwrite" } : {}) };
    else op = { op: "swap", a: source, b: dest };
    updateOps((o) => [...o, op]);
    setCommand(null); setDest(null); setPicking(false);
  };
  const connectorOps = (): Ml10xOperation[] =>
    Object.entries(connectorEdits).flatMap(([k, value]) => {
      const [i, field] = k.split(":") as [string, "name" | "shortName"];
      const c = interp.controller.connectors[Number(i)];
      return c && c[field === "name" ? "name" : "short_name"] !== value ? [{ op: "rename_connector" as const, connector: Number(i), field, value }] : [];
    });
  const allOps = [...ops, ...connectorOps()];
  const review = async () => {
    setBusy(true); setErr(null);
    try { setResult(await bridgeApi.ml10xPropose(fileText, allOps)); } catch (e) { setErr(describeError(e)); } finally { setBusy(false); }
  };
  const discard = () => { setOps([]); setConnectorEdits({}); setResult(null); setCommand(null); setDest(null); setPicking(false); setErr(null); };

  const occ = (s: Slot) => (s.occupancy === "empty" ? <Badge tone="neutral">empty</Badge> : <Badge tone="ok">occupied</Badge>);
  const slotRow = (s: Slot | null) => (s ? <span>{label({ bank: s.bank, preset: s.number })} <span className="font-mono">“{s.name}”</span> {occ(s)} {s.advanced && <Badge tone="warn">Advanced</Badge>} <span className="text-neutral-500">— {s.reason}</span></span> : <span className="text-neutral-500">none</span>);

  return (
    <div className="flex flex-col gap-3 text-xs" data-testid="ml10x-propose">
      <p className="text-neutral-600">
        Rename, copy, move or swap whole presets and rename connectors. Every preset travels with its routing matrix, mode, bypass and spillover exactly as the
        editor wrote them — Signal Loom authors no routing. Nothing changes until you review the proposal; the download is a <b>candidate</b> ML10X Device
        Backup, not yet verified in the official editor or on the device, and your original file is never modified.
      </p>
      {refusal && (
        <p className="text-red-700 border border-red-200 bg-red-50 rounded px-2 py-1" role="alert" data-testid="ml10x-propose-refused">
          No proposal can be produced from this file: {refusal}. Inspection still works; export the Device Backup again from the official editor to get a verifiable file.
        </p>
      )}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] gap-3 items-start">
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex flex-wrap gap-1 items-center" role="tablist" aria-label="Bank">
            {interp.banks.map((b) => (
              <Button key={b.bank} role="tab" aria-selected={bank === b.bank} variant={bank === b.bank ? "primary" : "default"} onClick={() => setBank(b.bank)} data-testid={`ml10x-propose-bank-${b.bank}`}>
                Bank {b.bank + 1}
              </Button>
            ))}
            {picking && <Badge tone="warn">click a slot to choose the destination</Badge>}
          </div>
          <div
            className="grid grid-cols-8 gap-0.5"
            role="listbox"
            aria-label={`Bank ${bank + 1} presets${picking ? " — choose a destination" : ""}`}
            aria-activedescendant={focusIdx !== null && visible[focusIdx] ? `ml10x-slot-${visible[focusIdx].bank}-${visible[focusIdx].number}` : undefined}
            data-testid="ml10x-propose-grid"
            onKeyDown={onGridKey}
          >
            {visible.map((s, i) => {
              const ref = { bank: s.bank, preset: s.number };
              const isSrc = same(ref, source), isDst = same(ref, dest), isTouched = touched.has(key(ref));
              const tabbable = focusIdx === null ? (source && source.bank === bank ? isSrc : i === 0) : i === focusIdx;
              return (
                <button
                  key={s.number}
                  id={`ml10x-slot-${s.bank}-${s.number}`}
                  ref={(el) => { if (el) cellRefs.current.set(`${s.bank}:${s.number}`, el); else cellRefs.current.delete(`${s.bank}:${s.number}`); }}
                  type="button"
                  role="option"
                  aria-selected={isSrc}
                  aria-label={`${label(ref)} ${s.name}${s.occupancy === "empty" ? ", empty" : ""}${s.advanced ? ", Advanced" : ""}${isDst ? ", destination" : ""}${isTouched ? ", changed by the proposal" : ""}`}
                  tabIndex={tabbable ? 0 : -1}
                  onFocus={() => setFocusIdx(i)}
                  onClick={() => clickSlot(s)}
                  data-testid={`ml10x-propose-slot-${s.bank}-${s.number}`}
                  title={`${s.name} — ${s.reason}`}
                  className={`relative rounded border px-1 py-0.5 text-[10px] text-left truncate min-w-0 ${
                    isSrc ? "bg-accent text-white border-accent" : isDst ? "bg-amber-100 border-amber-500 text-amber-900" : s.occupancy === "occupied" ? "bg-panel border-neutral-400" : "bg-neutral-50 border-line text-neutral-400"
                  } ${isTouched ? "border-dashed ring-1 ring-accent/60" : ""}`}
                >
                  {s.number}{s.advanced ? "ᴬ" : ""} <span className="font-mono">{s.occupancy === "occupied" ? s.name : ""}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-neutral-500">
            <span className="inline-block w-2.5 h-2.5 rounded bg-accent align-middle mr-1" /> selected preset · <span className="inline-block w-2.5 h-2.5 rounded bg-amber-100 border border-amber-500 align-middle mr-1" /> destination · dashed = changed by the proposal · ᴬ = Advanced ·
            faded = factory-empty (name “Empty”, no routing data). Arrow keys move, Home/End jump, PageUp/PageDown change bank, Enter selects.
          </p>
        </div>
        <div className="flex flex-col gap-3 min-w-0">
          <div data-testid="ml10x-propose-selected">
          <Panel title={src ? `${label({ bank: src.bank, preset: src.number })} — ${src.name}` : "Select a preset"}>
            {src && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-1">{occ(src)} {src.advanced && <Badge tone="warn">Advanced</Badge>} <span className="text-neutral-500">{src.reason}</span></div>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Preset actions">
                  <Button variant={command === "rename" ? "primary" : "default"} onClick={() => startCommand("rename")} disabled={!!refusal} data-testid="ml10x-cmd-rename">Rename</Button>
                  <Button variant={command === "copy" ? "primary" : "default"} onClick={() => startCommand("copy")} disabled={!!refusal} data-testid="ml10x-cmd-copy">Copy to…</Button>
                  <Button variant={command === "move" ? "primary" : "default"} onClick={() => startCommand("move")} disabled={!!refusal || src.occupancy === "empty"} title={src.occupancy === "empty" ? "A factory-empty slot has nothing to move" : undefined} data-testid="ml10x-cmd-move">Move to…</Button>
                  <Button variant={command === "swap" ? "primary" : "default"} onClick={() => startCommand("swap")} disabled={!!refusal} data-testid="ml10x-cmd-swap">Swap with…</Button>
                </div>
                {command === "rename" && (
                  <div className="flex flex-col gap-1 border-t border-line pt-2" data-testid="ml10x-rename-form">
                    <label className="flex flex-col gap-0.5">New name
                      <input aria-label="New preset name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && canAdd) { e.preventDefault(); addOp(); } }} data-testid="ml10x-rename-name" />
                    </label>
                    <p className="text-[11px] text-neutral-500" data-testid="ml10x-name-count">
                      {nameChars} character{nameChars === 1 ? "" : "s"} · {nameBytes} byte{nameBytes === 1 ? "" : "s"} — the device stores {NAME_WIRE_BYTES} bytes; the editor schema allows {NAME_EDITOR_MAX} characters (13–16 unverified). Never truncated.
                    </p>
                    {nameChars > NAME_WIRE_BYTES && nameChars <= NAME_EDITOR_MAX && isAsciiPrintable(newName) && (
                      <label className="flex items-center gap-1 text-amber-800"><input type="checkbox" checked={acceptLong} onChange={(e) => setAcceptLong(e.target.checked)} data-testid="ml10x-accept-long" /> Keep {nameChars} characters as typed (the device may keep only the first {NAME_WIRE_BYTES})</label>
                    )}
                    {nameProblem && <p className="text-amber-800" data-testid="ml10x-name-problem">{nameProblem}</p>}
                  </div>
                )}
                {command && command !== "rename" && (
                  <div className="flex flex-col gap-1 border-t border-line pt-2" data-testid="ml10x-dest-form">
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex flex-col gap-0.5">Destination bank
                        <select aria-label="Destination bank" value={dest?.bank ?? ""} onChange={(e) => { setDest({ bank: Number(e.target.value), preset: dest?.preset ?? 0 }); setOverwrite(false); setOnOccupied(""); }} data-testid="ml10x-dest-bank">
                          <option value="" disabled>—</option>
                          {interp.banks.map((b) => <option key={b.bank} value={b.bank}>Bank {b.bank + 1}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-0.5">Preset (0–127)
                        <input aria-label="Destination preset number" type="number" min={0} max={127} className="w-20" value={dest?.preset ?? ""} onChange={(e) => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= 0 && v <= 127) { setDest({ bank: dest?.bank ?? bank, preset: v }); setOverwrite(false); setOnOccupied(""); } }} data-testid="ml10x-dest-preset" />
                      </label>
                      <Button variant={picking ? "primary" : "default"} onClick={() => setPicking((p) => !p)} aria-pressed={picking} data-testid="ml10x-pick-dest">{picking ? "Picking in the grid…" : "Pick in the grid"}</Button>
                    </div>
                    <p data-testid="ml10x-dest-status">Destination: {slotRow(dst)}</p>
                    {dst && same(dest, source) && <p className="text-amber-800">The destination is the selected preset itself.</p>}
                    {dst && dst.occupancy === "occupied" && !same(dest, source) && command === "copy" && (
                      <label className="flex items-start gap-1 text-red-800 border border-red-200 bg-red-50 rounded px-2 py-1" data-testid="ml10x-overwrite-warning">
                        <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} data-testid="ml10x-overwrite" />
                        <span>Replace <b>“{dst.name}”</b> at {label(dest!)} with a copy of “{src.name}”. The preset there{dst.advanced ? " (Advanced)" : ""} would be gone from the candidate file.</span>
                      </label>
                    )}
                    {dst && dst.occupancy === "occupied" && !same(dest, source) && command === "move" && (
                      <fieldset className="flex flex-col gap-1 text-red-800 border border-red-200 bg-red-50 rounded px-2 py-1" data-testid="ml10x-overwrite-warning">
                        <legend className="px-1">{label(dest!)} already holds “{dst.name}”</legend>
                        <label className="flex items-center gap-1"><input type="radio" name="on-occupied" checked={onOccupied === "swap"} onChange={() => setOnOccupied("swap")} data-testid="ml10x-on-occupied-swap" /> Swap the two presets (nothing is lost)</label>
                        <label className="flex items-center gap-1"><input type="radio" name="on-occupied" checked={onOccupied === "overwrite"} onChange={() => setOnOccupied("overwrite")} data-testid="ml10x-on-occupied-overwrite" /> Replace “{dst.name}” and leave {label(source!)} factory-empty</label>
                      </fieldset>
                    )}
                    {command === "move" && dst && dst.occupancy === "empty" && <p className="text-neutral-600">{label(source!)} becomes a factory-empty slot (the file&apos;s own empty payload); {label(dest!)} receives “{src.name}” unchanged.</p>}
                    {command === "swap" && dst && !same(dest, source) && <p className="text-neutral-600">Both presets keep their routing; only their slots change.</p>}
                    {destProblem && <p className="text-amber-800" data-testid="ml10x-dest-problem">{destProblem}</p>}
                  </div>
                )}
                {command && (
                  <div className="flex gap-1">
                    <Button variant="primary" onClick={addOp} disabled={!canAdd} data-testid="ml10x-add-op">Add to proposal</Button>
                    <Button onClick={() => { setCommand(null); setDest(null); setPicking(false); }} data-testid="ml10x-cancel-op">Cancel</Button>
                  </div>
                )}
              </div>
            )}
          </Panel>
          </div>
          <Panel title={`Proposed operations (${allOps.length})`}>
            {allOps.length === 0 ? (
              <p className="text-neutral-500">Nothing proposed yet. Select a preset and choose an action, or edit a connector name below.</p>
            ) : (
              <ol className="flex flex-col gap-1 list-decimal pl-5" data-testid="ml10x-ops">
                {ops.map((op, i) => (
                  <li key={i} className="flex items-start gap-2">
                    {/* Described against the state each operation acts on, not the final projection. */}
                    <span className="flex-1">{describeOp(op, project(base, ops.slice(0, i)).slots)}</span>
                    <Button variant="ghost" aria-label={`Remove operation ${i + 1}`} onClick={() => updateOps((o) => o.filter((_, j) => j !== i))}>×</Button>
                  </li>
                ))}
                {connectorOps().map((op, i) => <li key={`c${i}`}>{describeOp(op, slots)}</li>)}
              </ol>
            )}
            <div className="flex flex-wrap gap-1 mt-2">
              <Button variant="primary" onClick={review} disabled={busy || !!refusal} data-testid="ml10x-review">Review proposal</Button>
              <Button onClick={discard} disabled={!allOps.length && !result} data-testid="ml10x-discard">Discard all</Button>
            </div>
            {err && <p className="text-red-700 mt-1" role="alert" data-testid="ml10x-propose-error">{err}</p>}
          </Panel>
        </div>
      </div>
      <Panel title="Connector names (controller settings)">
        <p className="text-neutral-600 mb-1">Long names hold 16 characters and short names 4 on the device (printable ASCII). MIDI channel, Device ID, Input Split, Loop Bypass Persist and spillover (trails) stay read-only in this version.</p>
        <div className="overflow-x-auto">
          <table className="w-full" data-testid="ml10x-connectors-edit">
            <thead><tr className="text-left text-neutral-500"><th>Id</th><th>Jack</th><th>Name</th><th>Short</th></tr></thead>
            <tbody>
              {interp.controller.connectors.map((c, i) => (
                <tr key={c.id} className="border-t border-line">
                  <td>{c.id}</td><td>{c.label}{c.loop ? ` (loop ${c.loop})` : ""}</td>
                  <td><input aria-label={`Connector ${c.id} name`} className="w-full min-w-28" value={connectorEdits[`${i}:name`] ?? c.name} onChange={(e) => updateConnector(`${i}:name`, e.target.value)} data-testid={`ml10x-connector-name-${i}`} /></td>
                  <td><input aria-label={`Connector ${c.id} short name`} className="w-16" value={connectorEdits[`${i}:shortName`] ?? c.short_name} onChange={(e) => updateConnector(`${i}:shortName`, e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {Object.entries(connectorEdits).some(([k, v]) => v.length > CONNECTOR_CAPS[k.split(":")[1] as keyof typeof CONNECTOR_CAPS] || !isAsciiPrintable(v)) && (
          <p className="text-amber-800 mt-1">A connector name is longer than the device stores or not ASCII; the review will refuse it rather than truncate.</p>
        )}
      </Panel>
      {result && (
        <Panel title="Review before download — candidate ML10X Device Backup">
          <div className="flex flex-col gap-2" data-testid="ml10x-result">
            <div className="flex flex-wrap gap-1">
              <Badge tone={result.diff.total ? "warn" : "ok"}>{result.diff.total} value change{result.diff.total === 1 ? "" : "s"} vs the original</Badge>
              <Badge tone={result.self_check.ok ? "ok" : "bad"}>{result.self_check.ok ? "self-check: structure + hash OK" : result.self_check.problems.join("; ")}</Badge>
              <Badge tone={result.preservation.every((c) => c.ok) ? "ok" : "bad"}>{result.preservation.filter((c) => c.ok).length}/{result.preservation.length} preservation checks</Badge>
              <Badge>{result.preserved.untouched_presets} presets untouched</Badge>
              <Badge>{result.preserved.unknown_keys_after} unknown keys preserved</Badge>
              <Badge tone="ok">0 routing fields authored</Badge>
              {result.preserved.byte_identical_to_input && <Badge tone="ok">byte-identical to the input</Badge>}
              <Badge tone="warn">not editor-validated · not hardware-validated</Badge>
            </div>
            <KeyValue
              rows={[
                { k: "Hash", v: `${result.diff.metadata.hash.before ?? "—"} → ${result.diff.metadata.hash.after ?? "—"} (Java String.hashCode over the data section, reproduced on 1 real backup)` },
                { k: "Export date", v: `${result.diff.metadata.download_date.before ?? "—"} → ${result.diff.metadata.download_date.after ?? "—"}${result.preserved.structurally_identical_to_input ? " (unchanged: no-op)" : " (set to the proposal time)"}` },
                { k: "File", v: `${result.identity.dump_type} backup · deviceModel ${result.identity.device_model} · schema ${result.identity.schema_version} · ${result.identity.presets} presets · ${result.identity.size_bytes.toLocaleString()} bytes` },
              ]}
            />
            {result.slots.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full" data-testid="ml10x-result-slots">
                  <thead><tr className="text-left text-neutral-500"><th>Slot</th><th>Before</th><th>After</th><th>Fields changed</th></tr></thead>
                  <tbody>
                    {result.slots.map((s) => (
                      <tr key={`${s.bank}-${s.preset}`} className="border-t border-line align-top">
                        <td className="whitespace-nowrap">{label({ bank: s.bank, preset: s.preset })}</td>
                        <td><span className="font-mono">“{s.before.name}”</span> {s.before.occupancy === "empty" ? <Badge tone="neutral">empty</Badge> : <Badge tone="ok">occupied</Badge>} {s.before.advanced && <Badge tone="warn">Advanced</Badge>} <span className="text-neutral-500">{s.before.matrix_rows_with_data} matrix rows · bypass {s.before.bypass} · spillover {s.before.spillover.join("/")}</span></td>
                        <td><span className="font-mono">“{s.after.name}”</span> {s.after.occupancy === "empty" ? <Badge tone="neutral">empty</Badge> : <Badge tone="ok">occupied</Badge>} {s.after.advanced && <Badge tone="warn">Advanced</Badge>} <span className="text-neutral-500">{s.after.matrix_rows_with_data} matrix rows · bypass {s.after.bypass} · spillover {s.after.spillover.join("/")}</span></td>
                        <td className="font-mono">{s.fields_changed.join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <ul className="list-disc pl-4" data-testid="ml10x-result-effects">
              {result.effects.map((e, i) => (
                <li key={i}>
                  {e.op === "rename" && <>Renamed {label({ bank: e.slot.bank, preset: e.slot.preset })} “{e.name_before}” → “{e.after.name}”</>}
                  {e.op === "copy" && <>Copied {label({ bank: e.source.bank, preset: e.source.preset })} “{e.source.name}” → {label({ bank: e.destination.bank, preset: e.destination.preset })}{e.overwrote ? <span className="text-red-800"> replacing “{e.overwrote.name}”</span> : null}</>}
                  {e.op === "move" && <>Moved {label({ bank: e.source.bank, preset: e.source.preset })} “{e.source.name}” → {label({ bank: e.destination.bank, preset: e.destination.preset })}{e.overwrote ? <span className="text-red-800"> replacing “{e.overwrote.name}”</span> : null}; source cleared ({e.cleared_with})</>}
                  {e.op === "swap" && <>Swapped {label({ bank: e.a.bank, preset: e.a.preset })} “{e.a.name}” ↔ {label({ bank: e.b.bank, preset: e.b.preset })} “{e.b.name}”{e.via === "move" ? " (move onto an occupied slot)" : ""}</>}
                  {e.op === "rename_connector" && <>Connector {e.connector} {e.field}: “{e.before}” → “{e.after}”</>}
                  {"verified" in e && e.verified && <span className="text-green-800"> · verified: {Object.entries(e.verified).map(([k, v]) => `${k.replace(/_/g, " ")} ${v ? "✓" : "✗"}`).join(", ")}</span>}
                </li>
              ))}
            </ul>
            {result.warnings.length > 0 && <ul className="text-amber-800 list-disc pl-4" data-testid="ml10x-result-warnings">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            <div className="text-[11px]">
              <button type="button" className="underline text-neutral-600" onClick={() => setShowDiff((v) => !v)} aria-expanded={showDiff}>{showDiff ? "Hide" : "Show"} every changed value and preservation check</button>
              {showDiff && (
                <div className="mt-1 flex flex-col gap-2">
                  <table className="w-full" data-testid="ml10x-result-diff">
                    <thead><tr className="text-left text-neutral-500"><th>Where</th><th>Before</th><th>After</th></tr></thead>
                    <tbody>{result.diff.changes.map((c, i) => <tr key={i} className="border-t border-line"><td>{c.label}</td><td className="font-mono break-all">{JSON.stringify(c.before)}</td><td className="font-mono break-all">{JSON.stringify(c.after)}</td></tr>)}</tbody>
                  </table>
                  <ul className="list-disc pl-4">{result.preservation.map((c) => <li key={c.check} className={c.ok ? "" : "text-red-700"}>{c.ok ? "✓" : "✗"} {c.check.replace(/_/g, " ")}: {c.detail}</li>)}</ul>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={() => downloadText(result.filename, result.text, "application/json")} data-testid="ml10x-download">Download candidate backup</Button>
              <span className="text-neutral-500">{result.filename} · keep the original export as your recovery baseline; this file has not been loaded in the Morningstar editor.</span>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
