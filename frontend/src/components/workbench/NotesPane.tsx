"use client";

import { useEffect, useRef, useState } from "react";
import type { DeviceNote, DocumentRef, NoteCategory, SourceCitation } from "@/lib/types";
import { Badge, Button, EvidenceBadge, Field } from "@/components/ui/basics";
import { NOTE_CATEGORIES, blankNote, noteCategoryLabel, noteProblems, normalizeNote, orderedNotes } from "@/lib/knowledge";
import type { CiteRequest, ReferenceState, Spawn } from "./types";

/**
 * Quick Reference: practical notes about a pedal (how to save a preset, enter a mode, set the MIDI
 * channel…) with optional procedure steps, manual page references, provenance and a pin. Used by
 * the Workbench for model-level notes and by the Board inspector for one unit's notes.
 */
export function NotesPane({ notes, docs, reference, cite, spawn, scopeLabel, onSave, onEditing, onGoToPage, compact = false }: {
  notes: DeviceNote[];
  docs: DocumentRef[];
  reference: ReferenceState | null;
  cite: CiteRequest | null;
  spawn: Spawn | null;
  /** "this model" / "this unit": used in the empty state and the add button's title. */
  scopeLabel: string;
  onSave: (next: DeviceNote[]) => Promise<boolean>;
  onEditing?: (editing: boolean) => void;
  onGoToPage?: (c: SourceCitation) => void;
  compact?: boolean;
}) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<DeviceNote | null>(null);
  const [busy, setBusy] = useState(false);
  // A fresh key per opened draft remounts the form (React would otherwise keep the previous draft's state).
  const [formKey, setFormKey] = useState(0);
  const open = (n: DeviceNote | null) => { setFormKey((k) => k + 1); setEditing(n); };
  const addRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { onEditing?.(!!editing); }, [editing, onEditing]);
  const lastSpawn = useRef(0);
  useEffect(() => {
    if (spawn && spawn.kind === "note" && spawn.seq !== lastSpawn.current) {
      lastSpawn.current = spawn.seq;
      open(blankNote("other", spawn.citation));
    }
  }, [spawn]);
  const isNew = !!editing && !notes.some((n) => n.id === editing.id);
  const currentCitation = (): SourceCitation | null => (reference?.docId ? { document_id: reference.docId, page: reference.page, note: null } : null);

  const commit = async (n: DeviceNote, addAnother: boolean) => {
    const clean = normalizeNote(n);
    const next = notes.some((x) => x.id === clean.id) ? notes.map((x) => (x.id === clean.id ? clean : x)) : [...notes, clean];
    setBusy(true);
    const ok = await onSave(next);
    setBusy(false);
    if (!ok) return;
    if (addAnother) open(blankNote(clean.category, clean.references[0] ? { ...clean.references[0], note: null } : null));
    else { open(null); setTimeout(() => addRef.current?.focus(), 0); }
  };
  const togglePin = async (n: DeviceNote) => { setBusy(true); await onSave(notes.map((x) => (x.id === n.id ? { ...x, pinned: !x.pinned } : x))); setBusy(false); };
  const remove = async (n: DeviceNote) => {
    if (!window.confirm(`Delete the note “${n.title}”?`)) return;
    setBusy(true);
    const ok = await onSave(notes.filter((x) => x.id !== n.id));
    setBusy(false);
    if (ok) setEditing(null);
  };
  const shown = orderedNotes(notes, q);
  const pinned = shown.filter((n) => n.pinned);
  const rest = shown.filter((n) => !n.pinned);

  return (
    <div className={`flex flex-col ${compact ? "gap-2" : "flex-1 min-h-0"}`} data-testid="notes-pane">
      <div className={`flex flex-wrap items-center gap-2 ${compact ? "" : "px-3 sm:px-4 py-2 border-b border-line bg-panel"}`}>
        {notes.length > 2 && <input aria-label="Search notes" placeholder="Search notes…" className="flex-1 min-w-[140px]" value={q} onChange={(e) => setQ(e.target.value)} />}
        {!compact && notes.length <= 2 && <span className="text-xs text-neutral-500 flex-1">What you would otherwise have to look up again: saving presets, modes, the MIDI channel, startup shortcuts, fixes, discoveries.</span>}
        <Button ref={addRef} variant="primary" onClick={() => open(blankNote("other", currentCitation()))} disabled={busy || isNew} data-testid="note-add" title={`Add a note about ${scopeLabel}`}>+ Note</Button>
      </div>
      <div className={compact ? "flex flex-col gap-1" : "flex-1 min-h-0 overflow-auto px-3 sm:px-4 py-2 flex flex-col gap-1"}>
        {editing && isNew && <NoteForm key={`new-${formKey}`} value={editing} docs={docs} reference={reference} cite={cite} busy={busy} isNew onCancel={() => setEditing(null)} onSave={(n, more) => void commit(n, more)} onDelete={null} onGoToPage={onGoToPage} />}
        {!notes.length && !editing && (
          <div className="rounded-md border border-dashed border-line p-4 text-sm text-neutral-600 flex flex-col gap-1" data-testid="notes-empty">
            <p className="font-medium text-foreground">No notes about {scopeLabel} yet.</p>
            <p className="text-xs">Write down the things you would otherwise look up again — pin the ones you need on stage.</p>
          </div>
        )}
        {!!notes.length && !shown.length && <p className="text-xs text-neutral-500 py-2">No note matches “{q}”.</p>}
        {pinned.length > 0 && <div className="text-[11px] uppercase tracking-wide text-neutral-500 mt-1">Pinned</div>}
        {pinned.map((n) => <NoteItem key={n.id} n={n} docs={docs} busy={busy} editing={editing?.id === n.id ? editing : null} reference={reference} cite={cite} onEdit={() => open(structuredClone(n))} onCancel={() => setEditing(null)} onSave={(x, more) => void commit(x, more)} onDelete={() => void remove(n)} onPin={() => void togglePin(n)} onGoToPage={onGoToPage} />)}
        {pinned.length > 0 && rest.length > 0 && <div className="text-[11px] uppercase tracking-wide text-neutral-500 mt-2">All notes</div>}
        {rest.map((n) => <NoteItem key={n.id} n={n} docs={docs} busy={busy} editing={editing?.id === n.id ? editing : null} reference={reference} cite={cite} onEdit={() => open(structuredClone(n))} onCancel={() => setEditing(null)} onSave={(x, more) => void commit(x, more)} onDelete={() => void remove(n)} onPin={() => void togglePin(n)} onGoToPage={onGoToPage} />)}
      </div>
    </div>
  );
}

function NoteItem({ n, docs, busy, editing, reference, cite, onEdit, onCancel, onSave, onDelete, onPin, onGoToPage }: {
  n: DeviceNote; docs: DocumentRef[]; busy: boolean; editing: DeviceNote | null; reference: ReferenceState | null; cite: CiteRequest | null;
  onEdit: () => void; onCancel: () => void; onSave: (n: DeviceNote, more: boolean) => void; onDelete: () => void; onPin: () => void; onGoToPage?: (c: SourceCitation) => void;
}) {
  if (editing) return <NoteForm key={editing.id} value={editing} docs={docs} reference={reference} cite={cite} busy={busy} isNew={false} onCancel={onCancel} onSave={onSave} onDelete={onDelete} onGoToPage={onGoToPage} />;
  return (
    <article className="rounded-md border border-line bg-panel px-2.5 py-2 flex flex-col gap-1 text-xs" data-testid={`note-${n.id}`} data-pinned={n.pinned}>
      <div className="flex items-start gap-2">
        <button type="button" aria-label={n.pinned ? `Unpin ${n.title}` : `Pin ${n.title}`} aria-pressed={n.pinned} className={`text-base leading-none mt-px ${n.pinned ? "text-amber-500" : "text-neutral-300 hover:text-amber-400"}`} onClick={onPin} disabled={busy} data-testid="note-pin">★</button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <h3 className="font-semibold text-sm">{n.title}</h3>
            <Badge>{noteCategoryLabel(n.category)}</Badge>
            <EvidenceBadge evidence={n.evidence} />
            {n.references.map((r, i) => {
              const d = docs.find((x) => x.document_id === r.document_id);
              const label = `${d?.title ?? "document"}${r.page ? ` · p. ${r.page}` : ""}`;
              return onGoToPage ? <button key={i} type="button" className="underline decoration-dotted text-neutral-600 hover:text-accent text-[11px]" onClick={() => onGoToPage(r)} data-testid="note-reference">{label}</button> : <span key={i} className="text-[11px] text-neutral-500">{label}</span>;
            })}
          </div>
          {n.body && <p className="text-neutral-700 whitespace-pre-wrap mt-0.5">{n.body}</p>}
          {n.steps.length > 0 && <ol className="list-decimal pl-5 mt-1 flex flex-col gap-0.5 text-foreground" data-testid="note-steps">{n.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
          {n.source_note && <p className="text-[11px] text-neutral-500 mt-0.5">Source: {n.source_note}</p>}
        </div>
        <Button variant="ghost" onClick={onEdit} disabled={busy} aria-label={`Edit ${n.title}`}>Edit</Button>
      </div>
    </article>
  );
}

function NoteForm({ value, docs, reference, cite, busy, isNew, onCancel, onSave, onDelete, onGoToPage }: {
  value: DeviceNote; docs: DocumentRef[]; reference: ReferenceState | null; cite: CiteRequest | null; busy: boolean; isNew: boolean;
  onCancel: () => void; onSave: (n: DeviceNote, more: boolean) => void; onDelete: (() => void) | null; onGoToPage?: (c: SourceCitation) => void;
}) {
  const [n, setN] = useState<DeviceNote>(value);
  const [stepsText, setStepsText] = useState(value.steps.join("\n"));
  const titleRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<DeviceNote>) => setN((x) => ({ ...x, ...patch }));
  useEffect(() => { titleRef.current?.focus(); }, []);
  const lastCite = useRef(0);
  useEffect(() => {
    if (cite && cite.seq !== lastCite.current) {
      lastCite.current = cite.seq;
      setN((x) => ({ ...x, references: [...x.references.filter((r) => !(r.document_id === cite.citation.document_id && r.page === cite.citation.page)), { ...cite.citation }], evidence: x.evidence === "user" ? "documented" : x.evidence }));
    }
  }, [cite]);
  const withSteps = { ...n, steps: stepsText.split("\n").map((s) => s.trim()).filter(Boolean) };
  const problems = noteProblems(withSteps);
  const submit = (more: boolean) => { if (!problems.length && !busy) onSave(withSteps, more); };
  const addRef = () => set({ references: [...n.references, reference?.docId ? { document_id: reference.docId, page: reference.page, note: null } : { document_id: docs[0]?.document_id ?? "", page: null, note: null }] });
  return (
    <form className="rounded-md border border-accent bg-blue-50/40 p-2.5 flex flex-col gap-2 text-xs mb-1" data-testid="note-form" aria-label={isNew ? "New note" : `Edit note ${value.title}`}
      onSubmit={(e) => { e.preventDefault(); submit(false); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(e.shiftKey); } }}>
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_11rem_auto] gap-2 items-end">
        <Field label="Title"><input ref={titleRef} aria-label="Note title" value={n.title} placeholder="e.g. Save a preset to a slot" onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Category">
          <select aria-label="Note category" value={n.category} onChange={(e) => set({ category: e.target.value as NoteCategory })}>{NOTE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
        </Field>
        <label className="flex items-center gap-1 h-7 text-neutral-700"><input type="checkbox" aria-label="Pinned" checked={n.pinned} onChange={(e) => set({ pinned: e.target.checked })} /> ★ pin for quick access</label>
      </div>
      <Field label="What to know (plain text)"><textarea aria-label="Note body" rows={3} value={n.body} placeholder="In your own words. Keep it short enough to read on stage." onChange={(e) => set({ body: e.target.value })} /></Field>
      <Field label="Steps (optional, one per line)" hint="Shown as a numbered procedure."><textarea aria-label="Note steps" rows={3} value={stepsText} placeholder={"Hold FAV until the LED flashes\nPress the footswitch of the slot"} onChange={(e) => setStepsText(e.target.value)} /></Field>
      <fieldset className="border border-line rounded p-2 flex flex-col gap-1 bg-panel/60">
        <legend className="px-1 text-neutral-600">Where it comes from</legend>
        <div className="grid grid-cols-1 sm:grid-cols-[11rem_minmax(0,1fr)] gap-2">
          <Field label="Evidence">
            <select aria-label="Note evidence" value={n.evidence} onChange={(e) => set({ evidence: e.target.value as DeviceNote["evidence"] })}>
              <option value="documented">documented (manual)</option><option value="third_party">third-party (forum, video)</option><option value="user">my own discovery</option><option value="unknown">unknown</option>
            </select>
          </Field>
          <Field label="Source note (optional)"><input aria-label="Source note" value={n.source_note ?? ""} placeholder="e.g. firmware 2.1 manual; or: found by trial on 2026-10-20" onChange={(e) => set({ source_note: e.target.value || null })} /></Field>
        </div>
        <div className="flex flex-col gap-1" data-testid="note-references">
          {n.references.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1">
              <select aria-label={`Reference ${i + 1} document`} value={r.document_id} onChange={(e) => set({ references: n.references.map((x, k) => (k === i ? { ...x, document_id: e.target.value } : x)) })}>
                {docs.map((d) => <option key={d.document_id} value={d.document_id}>{d.title}</option>)}
                {!docs.some((d) => d.document_id === r.document_id) && <option value={r.document_id}>document {r.document_id.slice(4, 10)}</option>}
              </select>
              <span className="text-neutral-500">p.</span>
              <input aria-label={`Reference ${i + 1} page`} type="number" min={1} inputMode="numeric" className="w-16" value={r.page ?? ""} onChange={(e) => set({ references: n.references.map((x, k) => (k === i ? { ...x, page: e.target.value === "" ? null : Number(e.target.value) } : x)) })} />
              {r.page && onGoToPage && <button type="button" className="underline decoration-dotted text-neutral-600 hover:text-accent" onClick={() => onGoToPage(r)}>show</button>}
              <Button variant="ghost" aria-label={`Remove reference ${i + 1}`} onClick={() => set({ references: n.references.filter((_, k) => k !== i) })}>✕</Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button onClick={addRef} disabled={!docs.length && !reference?.docId} data-testid="note-add-reference">{reference?.docId ? `+ Reference the page open on the right (p. ${reference.page})` : "+ Reference a page"}</Button>
          </div>
        </div>
      </fieldset>
      {problems.length > 0 && <ul className="text-[11px] text-red-700 list-disc pl-4" data-testid="note-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="flex flex-wrap gap-2 justify-end items-center">
        {onDelete && <Button variant="danger" onClick={onDelete} disabled={busy} className="mr-auto">Delete</Button>}
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy || problems.length > 0} data-testid="note-save">{busy ? "Saving…" : isNew ? "Add note" : "Save note"}</Button>
        <Button onClick={() => submit(true)} disabled={busy || problems.length > 0} data-testid="note-save-another" title="Save and start another note">Save & add another</Button>
      </div>
    </form>
  );
}
