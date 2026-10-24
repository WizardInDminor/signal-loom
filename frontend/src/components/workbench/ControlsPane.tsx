"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { CcDef, ControlBehavior, ControlUsage, ControlUsageReport, DeviceProfile, DocumentRef, ProfileUnit, SourceCitation } from "@/lib/types";
import { Badge, Button, EvidenceBadge, Field } from "@/components/ui/basics";
import { BEHAVIORS, BEHAVIOR_TONE, CONTROL_FILTERS, HARDWARE_STATUSES, type ControlFilter, behaviorLabel, behaviorOf, blankControl, citableDocuments, controlProblems, filterControls, isRemapped, isReviewed, nextFreeCc, normalizeControl, rangeText } from "@/lib/knowledge";
import type { CiteRequest, ReferenceState, Spawn } from "./types";

/**
 * Knowledge Editor, "Controls": the pedal's documented CC map as compact rows with an inline
 * editor under the one you are working on. Saving a control PUTs the whole map (one request) and
 * keeps the Reference Viewer exactly where it is; "Save & add another" opens the next blank row
 * with the same source page prefilled, so a MIDI chart can be entered top to bottom.
 */
export function ControlsPane({ profile, reference, cite, spawn, onSave, onEditing, onGoToPage }: {
  profile: DeviceProfile;
  reference: ReferenceState;
  cite: CiteRequest | null;
  spawn: Spawn | null;
  onSave: (next: CcDef[]) => Promise<boolean>;
  onEditing: (editing: boolean) => void;
  onGoToPage: (c: SourceCitation) => void;
}) {
  const list = profile.midi.cc_map;
  const docs = citableDocuments(profile);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ControlFilter>("all");
  // `seq` remounts the form on every new draft (React would otherwise keep the previous draft's state).
  const [editing, setEditing] = useState<{ draft: CcDef; originalCc: number | null; seq: number } | null>(null);
  const seq = useRef(0);
  const [usage, setUsage] = useState<ControlUsageReport | null>(null);
  const [busy, setBusy] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { onEditing(!!editing); }, [editing, onEditing]);
  useEffect(() => {
    let cancelled = false;
    api.catalog.controlUsage(profile.id).then((u) => { if (!cancelled) setUsage(u); }).catch(() => { if (!cancelled) setUsage(null); });
    return () => { cancelled = true; };
  }, [profile.id, list.length]);
  // "New control from this page" in the viewer.
  const lastSpawn = useRef(0);
  useEffect(() => {
    if (spawn && spawn.kind === "control" && spawn.seq !== lastSpawn.current) {
      lastSpawn.current = spawn.seq;
      setEditing({ draft: blankControl(nextFreeCc(list), spawn.citation), originalCc: null, seq: ++seq.current });
    }
  }, [spawn, list]);

  const startNew = (citation: SourceCitation | null = null) => setEditing({ draft: blankControl(nextFreeCc(list), citation), originalCc: null, seq: ++seq.current });
  const currentCitation = (): SourceCitation | null => (reference.docId ? { document_id: reference.docId, page: reference.page, note: null } : null);

  const commit = async (draft: CcDef, addAnother: boolean) => {
    const clean = normalizeControl(draft);
    const others = list.filter((c) => c.cc !== editing?.originalCc);
    const next = [...others.filter((c) => c.cc !== clean.cc), clean].sort((a, b) => a.cc - b.cc);
    setBusy(true);
    const ok = await onSave(next);
    setBusy(false);
    if (!ok) return;
    if (addAnother) {
      setEditing({ draft: blankControl(nextFreeCc(next, clean.cc + 1), clean.citation ? { ...clean.citation, note: null } : null), originalCc: null, seq: ++seq.current });
    } else {
      setEditing(null);
      setTimeout(() => addRef.current?.focus(), 0);
    }
  };
  const remove = async (cc: number) => {
    const u = usage?.controls[String(cc)];
    const where = u && (u.scenes.length || u.textures.length)
      ? `\n\nIt is used by ${u.scenes.length} scene value(s) and ${u.textures.length} Texture destination(s). Those keep their saved numbers; scenes will show the CC as undocumented and Textures lose eligibility for it.`
      : "";
    if (!window.confirm(`Remove CC ${cc} from this pedal's documented controls?${where}`)) return;
    setBusy(true);
    const ok = await onSave(list.filter((c) => c.cc !== cc));
    setBusy(false);
    if (ok) setEditing(null);
  };
  const shown = filterControls(list, q, filter);
  const proposedCount = list.filter((c) => !isReviewed(c)).length;

  return (
    <div className="flex flex-col flex-1 min-h-0" data-testid="controls-pane">
      <div className="flex flex-col gap-1.5 px-3 sm:px-4 py-2 border-b border-line bg-panel">
        <div className="flex items-center gap-2">
          <input aria-label="Search controls" placeholder="Search by number or name…" className="flex-1 min-w-0" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button ref={addRef} variant="primary" onClick={() => startNew(currentCitation())} disabled={busy || (!!editing && editing.originalCc === null)} data-testid="control-add" title="Add a control (cites the page open on the right)">+ Control</Button>
        </div>
        {list.length > 0 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter controls">
            {CONTROL_FILTERS.filter((f) => f.value !== "proposed" || proposedCount > 0).map((f) => (
              <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}
                className={`rounded-full px-2 py-0.5 text-[11px] border ${filter === f.value ? "bg-neutral-800 text-white border-neutral-800" : "border-line text-neutral-600 hover:bg-neutral-100"}`}>
                {f.label}{f.value === "proposed" ? ` ${proposedCount}` : ""}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 sm:px-4 py-2">
        {editing && editing.originalCc === null && (
          <ControlForm key={`new-${editing.seq}`} docs={docs} value={editing.draft} isNew busy={busy} reference={reference} cite={cite} usage={null} units={usage?.units ?? []}
            onCancel={() => setEditing(null)} onSave={(d, more) => void commit(d, more)} onDelete={null} onGoToPage={onGoToPage} others={list} />
        )}
        {!!list.length && !profile.midi.interfaces.length && (
          <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-1" data-testid="controls-no-interface">The controls are recorded, but how MIDI reaches this pedal (DIN, TRS, USB) is not declared yet, so Scenes and Textures cannot address it. Declare it in the bar above once you know; nothing is assumed from the list of controls.</p>
        )}
        {!list.length && !editing && (
          <div className="rounded-md border border-dashed border-line p-4 text-sm text-neutral-600 flex flex-col gap-2" data-testid="controls-empty">
            <p className="font-medium text-foreground">No documented controls yet.</p>
            <p className="text-xs">Find the MIDI implementation chart in the manual on the right, then press <b>+ Control</b> for each row: the number, the name the manual uses, what kind of control it is, and the page you are reading. Nothing you enter is sent to the pedal.</p>
          </div>
        )}
        {!!list.length && !shown.length && <p className="text-xs text-neutral-500 py-2">No control matches “{q}”{filter !== "all" ? ` in “${CONTROL_FILTERS.find((f) => f.value === filter)?.label}”` : ""}.</p>}
        <ul className="flex flex-col gap-1" data-testid="controls-list">
          {shown.map((c) => {
            const open = editing?.originalCc === c.cc;
            const u = usage?.controls[String(c.cc)];
            const uses = (u?.scenes.length ?? 0) + (u?.textures.length ?? 0);
            return (
              <li key={c.cc} data-testid={`control-cc-${c.cc}`} data-behavior={behaviorOf(c) ?? ""} data-review={c.review_status ?? "reviewed"}>
                {open && editing ? (
                  <ControlForm key={`edit-${editing.seq}`} docs={docs} value={editing.draft} isNew={false} busy={busy} reference={reference} cite={cite} usage={u ?? null} units={usage?.units ?? []}
                    onCancel={() => setEditing(null)} onSave={(d, more) => void commit(d, more)} onDelete={() => void remove(c.cc)} onGoToPage={onGoToPage} others={list.filter((x) => x.cc !== c.cc)} />
                ) : (
                  <ControlRow c={c} docs={docs} uses={uses} disabled={busy} onOpen={() => setEditing({ draft: structuredClone(c), originalCc: c.cc, seq: ++seq.current })} onGoToPage={onGoToPage} />
                )}
              </li>
            );
          })}
        </ul>
        {!!list.length && <p className="text-[11px] text-neutral-400 mt-3">Entered controls describe what the manual (or you) say the pedal does. They never send MIDI, and “verified” is only ever your own statement about this profile.</p>}
      </div>
    </div>
  );
}

function ControlRow({ c, docs, uses, disabled, onOpen, onGoToPage }: { c: CcDef; docs: DocumentRef[]; uses: number; disabled: boolean; onOpen: () => void; onGoToPage: (c: SourceCitation) => void }) {
  const b = behaviorOf(c);
  const range = rangeText(c);
  const doc = c.citation ? docs.find((d) => d.document_id === c.citation!.document_id) : null;
  return (
    <div className="group rounded-md border border-line bg-panel hover:border-neutral-400 focus-within:border-accent transition-colors">
      <button type="button" className="w-full text-left px-2.5 py-1.5 flex flex-wrap sm:flex-nowrap items-start gap-x-2 gap-y-1" onClick={onOpen} disabled={disabled} aria-label={`Edit CC ${c.cc} ${c.name}`}>
        <span className="font-mono text-xs bg-neutral-100 rounded px-1.5 py-0.5 shrink-0 mt-px" data-testid="control-number">CC {c.cc}</span>
        <span className="font-medium text-sm min-w-0 truncate basis-full sm:basis-auto sm:flex-1" data-testid="control-name">{c.name}{isRemapped(c) && <span className="text-neutral-500 font-normal"> · remapped (factory CC {c.factory_cc})</span>}</span>
        <span className="flex flex-wrap items-center gap-1 text-[11px] shrink-0 basis-full sm:basis-auto">
          <Badge tone={b ? BEHAVIOR_TONE[b] : "bad"}>{behaviorLabel(c)}</Badge>
          {range && <span className="text-neutral-600 font-mono">{range}</span>}
          <EvidenceBadge evidence={c.evidence} />
          {c.hardware_status === "verified" && <Badge tone="ok">✓ verified (your claim)</Badge>}
          {c.hardware_status === "failed" && <Badge tone="bad">no response</Badge>}
          {!isReviewed(c) && <Badge tone="warn">needs review</Badge>}
          {uses > 0 && <span className="text-neutral-400">· used {uses}×</span>}
        </span>
      </button>
      {(c.citation || c.value_semantics) && (
        <div className="px-2.5 pb-1.5 -mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-neutral-500">
          {c.citation && (
            <button type="button" className="underline decoration-dotted hover:text-accent" onClick={(e) => { e.stopPropagation(); onGoToPage(c.citation!); }} data-testid="control-citation" title="Turn the reference viewer to this page">
              {doc?.title ?? "document"}{c.citation.page ? ` · p. ${c.citation.page}` : ""}
            </button>
          )}
          {c.value_semantics && <span className="truncate">{c.value_semantics}</span>}
        </div>
      )}
    </div>
  );
}

function ControlForm({ docs, value, isNew, busy, reference, cite, usage, units, others, onCancel, onSave, onDelete, onGoToPage }: {
  docs: DocumentRef[]; value: CcDef; isNew: boolean; busy: boolean; reference: ReferenceState; cite: CiteRequest | null;
  usage: ControlUsage[string] | null; units: ProfileUnit[]; others: CcDef[];
  onCancel: () => void; onSave: (c: CcDef, addAnother: boolean) => void; onDelete: (() => void) | null; onGoToPage: (c: SourceCitation) => void;
}) {
  const [c, setC] = useState<CcDef>(value);
  const [advancedOpen, setAdvancedOpen] = useState(() => value.hardware_status !== "unverified" || value.mapping === "user_configured" || !!value.notes || !isReviewed(value));
  const ccRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<CcDef>) => setC((x) => ({ ...x, ...patch }));
  const problems = controlProblems(c, others);
  useEffect(() => { ccRef.current?.focus(); ccRef.current?.select(); }, []);
  // "Cite this page" from the viewer lands here while this form is open.
  const lastCite = useRef(0);
  useEffect(() => {
    if (cite && cite.seq !== lastCite.current) {
      lastCite.current = cite.seq;
      setC((x) => ({ ...x, citation: { ...cite.citation, note: x.citation?.note ?? null }, evidence: x.evidence === "user" || x.evidence === "unknown" ? "documented" : x.evidence }));
    }
  }, [cite]);
  const useCurrentPage = () => {
    if (!reference.docId) return;
    set({ citation: { document_id: reference.docId, page: reference.page, note: c.citation?.note ?? null }, evidence: c.evidence === "user" || c.evidence === "unknown" ? "documented" : c.evidence });
  };
  const uses = (usage?.scenes.length ?? 0) + (usage?.textures.length ?? 0);
  const renumbered = !isNew && c.cc !== value.cc;
  const submit = (addAnother: boolean) => { if (!problems.length && !busy) onSave(c, addAnother); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(e.shiftKey); }
  };
  const cur = reference.docId ? docs.find((d) => d.document_id === reference.docId) : null;
  return (
    <form className="rounded-md border border-accent bg-blue-50/40 p-2.5 flex flex-col gap-2 text-xs mb-1" data-testid="control-form" onKeyDown={onKeyDown}
      onSubmit={(e) => { e.preventDefault(); submit(false); }} aria-label={isNew ? "New control" : `Edit CC ${value.cc}`}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-neutral-500">{isNew ? "New control" : `Editing CC ${value.cc}`}</span>
        {!isReviewed(c) && <Badge tone="warn">proposed from the document — review, then mark reviewed</Badge>}
        <span className="ml-auto text-[11px] text-neutral-400 hidden sm:inline">Enter saves · Ctrl+Enter save & add another · Esc cancels</span>
      </div>
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] sm:grid-cols-[4.5rem_minmax(0,1fr)_9rem] gap-2">
        <Field label="CC #"><input ref={ccRef} aria-label="CC number" type="number" min={0} max={127} inputMode="numeric" value={c.cc} onChange={(e) => set({ cc: e.target.value === "" ? 0 : Number(e.target.value) })} /></Field>
        <Field label="Name (as the manual calls it)"><input aria-label="Control name" value={c.name} placeholder="e.g. Echo Level" onChange={(e) => set({ name: e.target.value })} /></Field>
        <div className="col-span-2 sm:col-span-1">
          <Field label="Behaviour">
            <select aria-label="Behaviour" value={c.behavior ?? ""} onChange={(e) => set({ behavior: (e.target.value || null) as ControlBehavior | null })}>
              <option value="">— not stated —</option>
              {BEHAVIORS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </Field>
        </div>
      </div>
      <p className="text-[11px] text-neutral-500 -mt-1" data-testid="behavior-hint">{c.behavior ? BEHAVIORS.find((b) => b.value === c.behavior)?.hint : "Behaviour not stated: the control is listed but never offered as a sweep. Say what the manual says when you know."}</p>
      <div className="grid grid-cols-2 sm:grid-cols-[5rem_5rem_minmax(0,1fr)] gap-2">
        <Field label="Min"><input aria-label="Minimum value" type="number" min={0} max={127} inputMode="numeric" placeholder="0" value={c.min_value ?? ""} onChange={(e) => set({ min_value: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
        <Field label="Max"><input aria-label="Maximum value" type="number" min={0} max={127} inputMode="numeric" placeholder="127" value={c.max_value ?? ""} onChange={(e) => set({ max_value: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
        <div className="col-span-2 sm:col-span-1">
          <Field label="What the values mean (optional)"><input aria-label="Value meaning" value={c.value_semantics ?? ""} placeholder="e.g. 0 = off, 127 = on · or 0–127 = dry to wet" onChange={(e) => set({ value_semantics: e.target.value || null })} /></Field>
        </div>
      </div>
      <fieldset className="border border-line rounded p-2 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_6rem] gap-2 items-end bg-panel/60">
        <legend className="px-1 text-neutral-600">Where it comes from</legend>
        <Field label="Evidence">
          <select aria-label="Control evidence" value={c.evidence} onChange={(e) => set({ evidence: e.target.value as CcDef["evidence"] })}>
            <option value="documented">documented (manual / MIDI chart)</option><option value="third_party">third-party source</option><option value="user">my own entry</option><option value="unknown">unknown</option>
          </select>
        </Field>
        <Field label="Source document">
          <select aria-label="Cited document" value={c.citation?.document_id ?? ""} onChange={(e) => set({ citation: e.target.value ? { document_id: e.target.value, page: c.citation?.page ?? null, note: c.citation?.note ?? null } : null })}>
            <option value="">{docs.length ? "— none —" : "no document attached yet"}</option>
            {docs.map((d) => <option key={d.document_id} value={d.document_id}>{d.title}</option>)}
          </select>
        </Field>
        <Field label="PDF page">
          <input aria-label="Cited page" type="number" min={1} inputMode="numeric" placeholder="—" value={c.citation?.page ?? ""} disabled={!c.citation} onChange={(e) => set({ citation: c.citation ? { ...c.citation, page: e.target.value === "" ? null : Number(e.target.value) } : null })} />
        </Field>
        <div className="sm:col-span-3 flex flex-wrap items-center gap-2">
          <Button onClick={useCurrentPage} disabled={!reference.docId} data-testid="control-use-page" title={cur ? `${cur.title}, PDF page ${reference.page}` : "Open a document on the right first"}>Use the page open on the right{reference.docId ? ` (p. ${reference.page})` : ""}</Button>
          {c.citation?.page && <button type="button" className="underline decoration-dotted text-neutral-600 hover:text-accent" onClick={() => onGoToPage(c.citation!)}>show cited page</button>}
          <input aria-label="Citation note" className="flex-1 min-w-[160px]" placeholder="where on the page, e.g. “MIDI chart, row 3”" value={c.citation?.note ?? ""} disabled={!c.citation} onChange={(e) => set({ citation: c.citation ? { ...c.citation, note: e.target.value || null } : null })} />
        </div>
      </fieldset>
      <details open={advancedOpen} onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)} className="border border-line rounded bg-panel/60">
        <summary className="px-2 py-1 cursor-pointer text-neutral-600 select-none">On your hardware <span className="text-neutral-400">— verification, remapping, notes</span></summary>
        <div className="p-2 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <p className="sm:col-span-2 text-[11px] text-neutral-600 bg-neutral-50 border border-line rounded px-2 py-1" data-testid="control-scope">
            These are statements about <b>this profile</b>, so they apply to every unit placed with it
            {units.length ? <> — currently <b data-testid="control-scope-count">{units.length}</b>: {[...new Set(units.map((x) => `${x.instance_label} (${x.rig_name})`))].slice(0, 4).join(", ")}{units.length > 4 ? ", …" : ""}</> : " (none placed yet)"}.
            If only one of your units is remapped or was tested, duplicate the profile for that unit first; the app never records a per-unit claim here.
          </p>
          <Field label="Hardware verification (your statement only)" hint="Signal Loom never sets this; a manual citation is not a hardware test. Say which unit and when in the note.">
            <select aria-label="Hardware status" value={c.hardware_status ?? "unverified"} onChange={(e) => set({ hardware_status: e.target.value as CcDef["hardware_status"] })}>
              {HARDWARE_STATUSES.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
            </select>
          </Field>
          <Field label="Which unit, how and when"><input aria-label="Hardware note" value={c.hardware_note ?? ""} placeholder="e.g. my blue Volante, swept by hand 2026-10-21, smooth 0–127" disabled={(c.hardware_status ?? "unverified") === "unverified"} onChange={(e) => set({ hardware_note: e.target.value || null })} /></Field>
          <Field label="Mapping" hint="Some pedals let CC numbers be reassigned; record the remap and keep the factory number. It applies to every unit using this profile.">
            <select aria-label="Mapping" value={c.mapping ?? "manufacturer_default"} onChange={(e) => set({ mapping: e.target.value as CcDef["mapping"], factory_cc: e.target.value === "user_configured" ? (c.factory_cc ?? c.cc) : null })}>
              <option value="manufacturer_default">manufacturer default</option><option value="user_configured">remapped (units with this profile)</option>
            </select>
          </Field>
          <Field label="Factory CC (the number in the manual)"><input aria-label="Factory CC" type="number" min={0} max={127} inputMode="numeric" value={c.factory_cc ?? ""} disabled={c.mapping !== "user_configured"} onChange={(e) => set({ factory_cc: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
          <Field label="Notes (optional)"><textarea aria-label="Control notes" rows={2} className="sm:col-span-2" value={c.notes ?? ""} placeholder="anything the chart does not say: firmware version, quirks, interactions" onChange={(e) => set({ notes: e.target.value || null })} /></Field>
          {!isReviewed(c) && (
            <label className="flex items-center gap-2 sm:col-span-2 text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              <input type="checkbox" aria-label="Mark reviewed" checked={false} onChange={() => set({ review_status: "reviewed" })} /> I have checked this against the document — mark it reviewed (until then it is not offered to Scenes or Textures)
            </label>
          )}
        </div>
      </details>
      {uses > 0 && (
        <p className={`text-[11px] rounded px-2 py-1 border ${renumbered ? "text-amber-900 bg-amber-50 border-amber-200" : "text-neutral-600 bg-neutral-50 border-line"}`} data-testid="control-usage">
          Used by {usage!.scenes.length} scene value{usage!.scenes.length === 1 ? "" : "s"} and {usage!.textures.length} Texture destination{usage!.textures.length === 1 ? "" : "s"}
          {usage!.scenes[0] ? ` (e.g. ${usage!.scenes[0].rig_name} / ${usage!.scenes[0].scene_name})` : usage!.textures[0] ? ` (e.g. ${usage!.textures[0].rig_name} / ${usage!.textures[0].texture_name})` : ""}.
          {renumbered ? " Renumbering keeps their saved numbers unchanged: they will point at the old number." : " Saved scenes keep their exact bytes whatever you change here."}
        </p>
      )}
      {problems.length > 0 && <ul className="text-[11px] text-red-700 list-disc pl-4" data-testid="control-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="flex flex-wrap gap-2 justify-end items-center">
        {onDelete && <Button variant="danger" onClick={onDelete} disabled={busy} className="mr-auto">Remove</Button>}
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy || problems.length > 0} data-testid="control-save">{isNew ? "Add" : "Save"}</Button>
        <Button variant="primary" onClick={() => submit(true)} disabled={busy || problems.length > 0} data-testid="control-save-another" title="Save and open the next blank control with the same source page">{busy ? "Saving…" : isNew ? "Add & next" : "Save & add another"}</Button>
      </div>
    </form>
  );
}
