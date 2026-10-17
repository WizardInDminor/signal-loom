"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type CommandUse } from "@/lib/api";
import type { CommandIntent, DeviceProfile, MidiCommand, ValueMode } from "@/lib/types";
import { COMMAND_INTENTS } from "@/lib/types";
import { blankCommand, commandProblems, displayedProgram, fingerprint, orderedCommands, wireSummary } from "@/lib/commands";
import { Badge, Button, EvidenceBadge, Field } from "@/components/ui/basics";

/**
 * "MIDI commands" section of a device profile: the user's named, favorite-able CC/PC commands.
 * Edits replace only the command list on the server; the documented MIDI map is untouched and
 * scenes that already applied a command keep their bytes (the compiler flags them for review).
 */
export function MidiCommandsSection({ profile, onSaved }: { profile: DeviceProfile; onSaved: (p: DeviceProfile) => void }) {
  const commands = profile.midi.commands ?? [];
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<MidiCommand | null>(null);
  const [usage, setUsage] = useState<Record<string, CommandUse[]> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasMidi = profile.midi.interfaces.length > 0;
  const docs = profile.documents ?? [];
  const files = new Map((profile.document_files ?? []).map((f) => [f.document_id, f]));

  useEffect(() => {
    let cancelled = false;
    api.catalog.commandUsage(profile.id).then((u) => { if (!cancelled) setUsage(u); }).catch(() => { if (!cancelled) setUsage(null); });
    return () => { cancelled = true; };
  }, [profile.id, commands.length, profile.midi.commands]);

  const save = async (next: MidiCommand[]) => {
    setBusy(true); setError(null);
    try { onSaved(await api.catalog.updateCommands(profile.id, next)); setEditing(null); } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); } finally { setBusy(false); }
  };
  const upsert = (c: MidiCommand) => save(commands.some((x) => x.id === c.id) ? commands.map((x) => (x.id === c.id ? c : x)) : [...commands, c]);
  const toggleFavorite = (c: MidiCommand) => upsert({ ...c, favorite: !c.favorite });
  const remove = (c: MidiCommand) => {
    const uses = usage?.[c.id] ?? [];
    const where = uses.length ? `\n\nIt is applied in ${uses.length} scene value(s) (${[...new Set(uses.map((u) => `${u.rig_name} / ${u.scene_name}`))].slice(0, 4).join("; ")}). Those scenes keep the exact CC/PC values they saved and will show a “command removed” review warning.` : "";
    if (window.confirm(`Delete command “${c.name}”?${where}`)) void save(commands.filter((x) => x.id !== c.id));
  };
  const fromMap = async () => {
    setBusy(true); setError(null);
    try { const r = await api.catalog.commandsFromMap(profile.id); onSaved(r.profile); if (!r.added.length) setError("Nothing to add: every documented CC/PC/bypass fact already has a command, or the profile documents no MIDI map."); } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); } finally { setBusy(false); }
  };
  const declareMidi = async () => {
    const ch = window.prompt("This profile documents no MIDI input. Declare one as your own statement (evidence: user).\n\nDefault MIDI channel of the device (1–16), or leave empty if unknown:", "");
    if (ch === null) return;
    const n = ch.trim() === "" ? null : Number(ch);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 16)) { setError("Channel must be 1–16 or empty."); return; }
    setBusy(true); setError(null);
    try { onSaved(await api.catalog.declareMidi(profile.id, { interfaces: ["din_in"], default_channel: n })); } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); } finally { setBusy(false); }
  };
  const shown = orderedCommands(commands, q);
  const favorites = commands.filter((c) => c.favorite).length;

  return (
    <div className="text-xs flex flex-col gap-2" data-testid="commands-section">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">MIDI commands ({commands.length}{favorites ? `, ${favorites} ★` : ""})</h3>
        <span className="text-neutral-500">Named commands you pick by name when building scenes. The channel comes from the placed pedal, never from here.</span>
        <span className="ml-auto flex gap-1">
          {commands.length > 3 && <input aria-label="Search commands" placeholder="Search…" className="w-32" value={q} onChange={(e) => setQ(e.target.value)} />}
          <Button onClick={() => void fromMap()} disabled={busy} title="Create commands from the profile's documented bypass CC, CC map and program-change support, keeping their evidence">From documented map</Button>
          <Button variant="primary" onClick={() => setEditing(blankCommand("cc"))} disabled={busy} data-testid="command-add">+ Command</Button>
        </span>
      </div>
      {!hasMidi && (
        <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex flex-wrap items-center gap-2" data-testid="midi-undeclared">
          This profile declares no MIDI input (imported catalogs carry dimensions only). Commands can be written down, but scenes cannot compile them until you state that the device has MIDI.
          <Button onClick={() => void declareMidi()} disabled={busy} data-testid="declare-midi">Declare MIDI input (your statement)</Button>
        </p>
      )}
      {error && <p role="alert" data-testid="commands-error" className="text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p>}
      {shown.length > 0 && (
        <ul className="flex flex-col divide-y divide-line border border-line rounded" data-testid="command-list">
          {shown.map((c) => {
            const uses = usage?.[c.id] ?? [];
            const cited = c.citation ? docs.find((d) => d.document_id === c.citation!.document_id) : null;
            const citedFile = c.citation ? files.get(c.citation.document_id) : undefined;
            return (
              <li key={c.id} className="flex items-start gap-2 px-2 py-1" data-testid={`command-${c.id}`}>
                <button type="button" aria-label={c.favorite ? `Unfavorite ${c.name}` : `Favorite ${c.name}`} aria-pressed={c.favorite} className={`text-base leading-none mt-0.5 ${c.favorite ? "text-amber-500" : "text-neutral-300 hover:text-amber-400"}`} onClick={() => void toggleFavorite(c)} disabled={busy}>★</button>
                <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-medium">{c.name}</span>
                {c.category && <Badge>{c.category}</Badge>}
                <code className="text-[11px] bg-neutral-100 rounded px-1">{wireSummary(c)}</code>
                {c.kind === "pc" && c.pc != null && <span className="text-neutral-500">{displayedProgram(c.pc, profile)}</span>}
                {c.intent && <Badge tone={c.intent === "toggle" ? "warn" : "neutral"}>{c.intent}</Badge>}
                {c.deterministic === false && <Badge tone="warn">non-deterministic</Badge>}
                <EvidenceBadge evidence={c.evidence} />
                {c.verified_on_hardware && <Badge tone="ok">verified on hardware (your claim)</Badge>}
                {c.citation && (cited || citedFile?.present ? <a className="underline" href={`/documents/${c.citation.document_id}${c.citation.page ? `?page=${c.citation.page}` : ""}`} target="_blank" rel="noreferrer" data-testid="command-citation">{cited?.title ?? "document"}{c.citation.page ? ` p. ${c.citation.page}` : ""}</a> : <Badge tone="warn">cites a document that is not attached</Badge>)}
                {c.description && <span className="text-neutral-500 basis-full">{c.description}</span>}
                </div>
                <span className="flex items-center gap-1 shrink-0">
                  {uses.length > 0 && <span className="text-neutral-500" title={uses.map((u) => `${u.rig_name} / ${u.scene_name} / ${u.instance_label}${u.changed ? " (needs review)" : ""}`).join("\n")}>used in {uses.length} scene value{uses.length === 1 ? "" : "s"}{uses.some((u) => u.changed) ? " · some need review" : ""}</span>}
                  <Button variant="ghost" onClick={() => setEditing(structuredClone(c))} disabled={busy}>Edit</Button>
                  <Button variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => remove(c)} disabled={busy}>✕</Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {!commands.length && !editing && <p className="text-neutral-500">No commands yet. Add the two or three you use most (“Engage”, “Recall favorite”), or derive them from the documented MIDI map.</p>}
      {editing && <CommandForm profile={profile} value={editing} busy={busy} onCancel={() => setEditing(null)} onSave={(c) => void upsert(c)} usage={usage?.[editing.id] ?? []} isNew={!commands.some((x) => x.id === editing.id)} />}
    </div>
  );
}

function CommandForm({ profile, value, onSave, onCancel, busy, usage, isNew }: { profile: DeviceProfile; value: MidiCommand; onSave: (c: MidiCommand) => void; onCancel: () => void; busy: boolean; usage: CommandUse[]; isNew: boolean }) {
  const [c, setC] = useState<MidiCommand>(value);
  const set = (patch: Partial<MidiCommand>) => setC((x) => ({ ...x, ...patch }));
  const problems = commandProblems(c);
  const docs = profile.documents ?? [];
  const original = value;
  const wireChanged = !isNew && fingerprint(original) !== fingerprint(c);
  const docChoices = c.kind === "cc" ? profile.midi.cc_map.filter((d) => d.cc === c.cc) : [];
  return (
    <form className="border border-accent rounded p-2 flex flex-col gap-2 bg-blue-50/30" data-testid="command-form" onSubmit={(e) => { e.preventDefault(); if (!problems.length) onSave({ ...c, name: c.name.trim(), category: c.category?.trim() || null, description: c.description?.trim() || null, note: c.note?.trim() || null }); }}>
      <div className="grid md:grid-cols-4 gap-2">
        <Field label="Name"><input aria-label="Command name" autoFocus value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Engage A side" /></Field>
        <Field label="Category (optional)"><input aria-label="Command category" value={c.category ?? ""} onChange={(e) => set({ category: e.target.value || null })} placeholder="Bypass, Presets, Mix…" /></Field>
        <Field label="Type">
          <select aria-label="Command type" value={c.kind} onChange={(e) => { const kind = e.target.value as MidiCommand["kind"]; setC({ ...blankCommand(kind), id: c.id, name: c.name, category: c.category, description: c.description, favorite: c.favorite, tags: c.tags, evidence: c.evidence, citation: c.citation, verified_on_hardware: c.verified_on_hardware, note: c.note, intent: kind === "pc" ? "recall" : c.intent, deterministic: kind === "pc" ? true : c.deterministic }); }}>
            <option value="cc">Control Change (CC)</option><option value="pc">Program Change (PC)</option>
          </select>
        </Field>
        <Field label="Favorite"><label className="flex items-center gap-1 h-7"><input type="checkbox" checked={c.favorite} onChange={(e) => set({ favorite: e.target.checked })} /> show first in the scene picker</label></Field>
      </div>
      {c.kind === "cc" ? (
        <div className="grid md:grid-cols-4 gap-2">
          <Field label="CC number (0–127)" hint={profile.midi.cc_map.length ? `documented: ${profile.midi.cc_map.map((d) => `${d.cc} ${d.name}`).join(", ")}` : "the profile documents no CC map; this number is your statement"}>
            <input aria-label="CC number" type="number" min={0} max={127} value={c.cc ?? ""} onChange={(e) => set({ cc: e.target.value === "" ? null : Number(e.target.value) })} />
          </Field>
          <Field label="Value">
            <select aria-label="Value mode" value={c.value_mode} onChange={(e) => set({ value_mode: e.target.value as ValueMode })}>
              <option value="fixed">fixed value (an action)</option><option value="choice">one of documented values</option><option value="any">any value 0–127 (set per scene)</option>
            </select>
          </Field>
          {c.value_mode === "fixed" && <Field label="Value (0–127)"><input aria-label="CC value" type="number" min={0} max={127} value={c.value ?? ""} onChange={(e) => set({ value: e.target.value === "" ? null : Number(e.target.value) })} /></Field>}
          {c.value_mode === "any" && <Field label="Suggested value (optional)"><input aria-label="Suggested value" type="number" min={0} max={127} value={c.value ?? ""} onChange={(e) => set({ value: e.target.value === "" ? null : Number(e.target.value) })} /></Field>}
          {docChoices.length > 0 && <p className="text-[11px] text-neutral-500 self-end">Documented: {docChoices.map((d) => `${d.name}${d.value_semantics ? ` (${d.value_semantics})` : ""}`).join("; ")}</p>}
        </div>
      ) : (
        <div className="grid md:grid-cols-4 gap-2">
          <Field label="PC number on the wire (0–127)" hint={c.pc != null ? displayedProgram(c.pc, profile) : undefined}><input aria-label="PC number" type="number" min={profile.midi.program_change.min ?? 0} max={profile.midi.program_change.max ?? 127} value={c.pc ?? ""} onChange={(e) => set({ pc: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
          <Field label="Bank MSB (CC 0, optional)"><input aria-label="Bank MSB" type="number" min={0} max={127} value={c.bank_msb ?? ""} onChange={(e) => set({ bank_msb: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
          <Field label="Bank LSB (CC 32, optional)"><input aria-label="Bank LSB" type="number" min={0} max={127} value={c.bank_lsb ?? ""} onChange={(e) => set({ bank_lsb: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
          {profile.midi.program_change.supported !== true && <p className="text-[11px] text-amber-800 self-end">Program Change support for this profile is {profile.midi.program_change.supported === false ? "documented as absent" : "not documented"}; the compiler will say so.</p>}
        </div>
      )}
      {c.kind === "cc" && c.value_mode === "choice" && (
        <div className="flex flex-col gap-1">
          <span className="text-neutral-600">Documented values and their meaning</span>
          {c.choices.map((ch, i) => (
            <div key={i} className="flex gap-1 items-center">
              <input aria-label={`Choice ${i + 1} value`} type="number" min={0} max={127} className="w-16" value={ch.value} onChange={(e) => set({ choices: c.choices.map((x, k) => (k === i ? { ...x, value: Number(e.target.value) } : x)) })} />=
              <input aria-label={`Choice ${i + 1} meaning`} className="w-40" value={ch.label} placeholder="meaning, e.g. engage" onChange={(e) => set({ choices: c.choices.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
              <Button variant="ghost" aria-label="Remove choice" onClick={() => set({ choices: c.choices.filter((_, k) => k !== i) })}>✕</Button>
            </div>
          ))}
          <div><Button onClick={() => set({ choices: [...c.choices, { value: c.choices.length ? 127 : 0, label: "" }] })}>+ Value</Button></div>
        </div>
      )}
      <div className="grid md:grid-cols-4 gap-2">
        <Field label="Intent">
          <select aria-label="Intent" value={c.intent ?? ""} onChange={(e) => { const intent = (e.target.value || null) as CommandIntent | null; set({ intent, deterministic: intent === "toggle" ? false : c.deterministic }); }}>
            <option value="">— not stated —</option>{COMMAND_INTENTS.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="Result deterministic?" hint="yes = absolute (same result whatever the device was doing); no = toggle-like">
          <select aria-label="Deterministic" value={c.deterministic === true ? "yes" : c.deterministic === false ? "no" : ""} onChange={(e) => set({ deterministic: e.target.value === "" ? null : e.target.value === "yes" })}>
            <option value="">unknown</option><option value="yes">yes</option><option value="no">no (toggle)</option>
          </select>
        </Field>
        <Field label="Where do these numbers come from?">
          <select aria-label="Evidence" value={c.evidence} onChange={(e) => set({ evidence: e.target.value as MidiCommand["evidence"] })}>
            <option value="user">I entered them (from memory / my own notes)</option><option value="documented">documented (manual)</option><option value="third_party">third-party source (forum, dataset)</option><option value="unknown">unknown</option>
          </select>
        </Field>
        <Field label="Manual citation (optional)">
          <div className="flex gap-1">
            <select aria-label="Cited document" value={c.citation?.document_id ?? ""} onChange={(e) => set({ citation: e.target.value ? { document_id: e.target.value, page: c.citation?.page ?? null, note: c.citation?.note ?? null } : null, evidence: e.target.value && c.evidence === "user" ? "documented" : c.evidence })}>
              <option value="">{docs.length ? "— none —" : "no documents attached"}</option>{docs.map((d) => <option key={d.document_id} value={d.document_id}>{d.title}</option>)}
            </select>
            {c.citation && <input aria-label="Cited page" type="number" min={1} className="w-16" placeholder="page" value={c.citation.page ?? ""} onChange={(e) => set({ citation: { ...c.citation!, page: e.target.value === "" ? null : Number(e.target.value) } })} />}
          </div>
        </Field>
      </div>
      <div className="grid md:grid-cols-[1fr_auto] gap-2 items-end">
        <Field label="Description (optional)"><input aria-label="Command description" value={c.description ?? ""} onChange={(e) => set({ description: e.target.value || null })} placeholder="what it does, in your words" /></Field>
        <label className="flex items-center gap-1 h-7"><input type="checkbox" checked={c.verified_on_hardware} onChange={(e) => set({ verified_on_hardware: e.target.checked })} /> I tried this on the device and it worked</label>
      </div>
      <p className="text-[11px] text-neutral-500">Attaching a manual citation records where the numbers are written; it does not verify them. “Verified on hardware” is your own claim and is shown as such. Signal Loom never sends MIDI.</p>
      {wireChanged && usage.length > 0 && <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1" data-testid="command-change-notice">This edit changes what the command sends. The {usage.length} scene value(s) that applied it keep their saved CC/PC bytes and will show a “definition changed” review warning until you reapply the command there.</p>}
      {problems.length > 0 && <ul className="text-[11px] text-red-700 list-disc pl-4" data-testid="command-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="flex gap-2 justify-end"><Button onClick={onCancel} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" disabled={busy || problems.length > 0} data-testid="command-save">{isNew ? "Add command" : "Save command"}</Button></div>
    </form>
  );
}
