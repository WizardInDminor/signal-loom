"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { CcDef, DeviceNote, DeviceProfile, DocumentKind, SourceCitation } from "@/lib/types";
import { Button, ErrorBanner } from "@/components/ui/basics";
import { citableDocuments } from "@/lib/knowledge";
import { IdentityBar } from "./IdentityBar";
import { SplitPane } from "./SplitPane";
import { ControlsPane } from "./ControlsPane";
import { NotesPane } from "./NotesPane";
import { ReferencePane } from "./ReferencePane";
import type { CiteRequest, ReferenceState, SaveState, Spawn } from "./types";

type View = "controls" | "notes";

/**
 * The MIDI Knowledge Workbench: Knowledge Editor (controls, Quick Reference) on the left, the
 * pedal's own documents on the right. The reading position is owned here so it survives every
 * edit; citations flow both ways (a row turns the viewer to its page, the viewer cites its page
 * into the open editor). Every save is one PUT of one list; nothing here sends MIDI.
 */
export function Workbench({ initial }: { initial: DeviceProfile }) {
  const [profile, setProfile] = useState(initial);
  // Deep link: ?doc=<id>&page=<n>&view=notes (read once; mirrored back below without a navigation).
  const [view, setView] = useState<View>(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "notes" ? "notes" : "controls"));
  const [segment, setSegment] = useState<"left" | "right">("left");
  const [reference, setReference] = useState<ReferenceState>(() => {
    const p = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const docId = p?.get("doc"), page = Number(p?.get("page"));
    const known = docId && (initial.documents ?? []).some((d) => d.document_id === docId) ? docId : null;
    return { docId: known ?? initial.documents?.[0]?.document_id ?? null, page: known && page >= 1 ? page : 1, zoom: "fit" };
  });
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [editing, setEditing] = useState<"control" | "note" | null>(null);
  const [cite, setCite] = useState<CiteRequest | null>(null);
  const [spawn, setSpawn] = useState<Spawn | null>(null);
  const seq = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);

  // Fill the viewport below the app header (each pane scrolls on its own).
  useEffect(() => {
    const measure = () => { if (rootRef.current) setTop(Math.round(rootRef.current.getBoundingClientRect().top + window.scrollY)); };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  useEffect(() => {
    const p = new URLSearchParams();
    if (reference.docId) { p.set("doc", reference.docId); p.set("page", String(reference.page)); }
    if (view === "notes") p.set("view", "notes");
    const qs = p.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [reference.docId, reference.page, view]);
  useEffect(() => {
    if (!editing) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [editing]);

  const fail = (e: unknown) => {
    const msg = e instanceof ApiError ? (typeof e.detail === "string" ? e.detail : Array.isArray(e.detail) ? e.detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(-1).join("")}: ${d.msg}`).join("; ") : e.message) : (e as Error).message;
    setSaveState("error"); setSaveError(msg); setBanner(msg);
  };
  const run = useCallback(async (fn: () => Promise<DeviceProfile>): Promise<boolean> => {
    setSaveState("saving"); setSaveError(null); setBanner(null);
    try { setProfile(await fn()); setSaveState("saved"); return true; } catch (e) { fail(e); return false; }
  }, []);
  const saveControls = useCallback((next: CcDef[]) => run(() => api.catalog.updateControls(profile.id, next)), [run, profile.id]);
  const saveNotes = useCallback((next: DeviceNote[]) => run(() => api.catalog.updateQuickReference(profile.id, next)), [run, profile.id]);
  const onEditingControl = useCallback((on: boolean) => { setEditing((e) => (on ? "control" : e === "control" ? null : e)); }, []);
  const onEditingNote = useCallback((on: boolean) => { setEditing((e) => (on ? "note" : e === "note" ? null : e)); }, []);
  const shownSaveState: SaveState = editing && saveState === "saved" ? "editing" : saveState;

  const goToPage = useCallback((c: SourceCitation) => {
    setReference((r) => ({ ...r, docId: c.document_id, page: c.page ?? 1 }));
    setSegment("right");
  }, []);
  const onCite = (c: SourceCitation) => { setCite({ citation: c, seq: ++seq.current }); setSegment("left"); };
  const onSpawn = (kind: "control" | "note", c: SourceCitation) => { setView(kind === "control" ? "controls" : "notes"); setSpawn({ kind, citation: c, seq: ++seq.current }); setSegment("left"); };
  const onAttach = async (file: File, title: string, kind: DocumentKind) => {
    const saved = await api.catalog.attachDocument(profile.id, file, title, kind);
    setProfile(saved);
    const added = saved.documents?.[saved.documents.length - 1];
    if (added) setReference((r) => ({ ...r, docId: added.document_id, page: 1 }));
  };
  const onReplace = async (docId: string, file: File) => { setProfile(await api.catalog.replaceDocument(profile.id, docId, file)); };
  const onAddProposed = (defs: CcDef[]) => { setView("controls"); return saveControls([...profile.midi.cc_map, ...defs.filter((d) => !profile.midi.cc_map.some((c) => c.cc === d.cc))].sort((a, b) => a.cc - b.cc)); };

  const editor = (
    <div className="flex flex-col flex-1 min-h-0 bg-background" data-testid="knowledge-editor">
      <div role="tablist" aria-label="Knowledge" className="flex items-center gap-1 px-3 sm:px-4 pt-2 bg-panel border-b border-line">
        {(["controls", "notes"] as const).map((v) => (
          <Button key={v} role="tab" aria-selected={view === v} variant={view === v ? "primary" : "ghost"} className="rounded-b-none" onClick={() => setView(v)} data-testid={`view-${v}`}>
            {v === "controls" ? `Controls` : `Quick Reference`}
            <span className={`text-[11px] ${view === v ? "text-white/80" : "text-neutral-400"}`}>{v === "controls" ? profile.midi.cc_map.length : (profile.quick_reference ?? []).length}</span>
          </Button>
        ))}
      </div>
      <div className={`flex flex-col flex-1 min-h-0 ${view === "controls" ? "" : "hidden"}`} role="tabpanel" aria-label="Controls">
        <ControlsPane profile={profile} reference={reference} cite={cite} spawn={spawn} onSave={saveControls} onEditing={onEditingControl} onGoToPage={goToPage} />
      </div>
      <div className={`flex flex-col flex-1 min-h-0 ${view === "notes" ? "" : "hidden"}`} role="tabpanel" aria-label="Quick Reference">
        <NotesPane notes={profile.quick_reference ?? []} docs={citableDocuments(profile)} reference={reference} cite={cite} spawn={spawn} scopeLabel={`the ${profile.model}`} onSave={saveNotes} onEditing={onEditingNote} onGoToPage={goToPage} />
      </div>
    </div>
  );
  const viewer = (
    <ReferencePane profile={profile} state={reference} onChange={setReference} editing={editing} onCite={onCite} onSpawn={onSpawn} onAttach={onAttach} onReplace={onReplace} onAddProposed={onAddProposed} />
  );

  return (
    <div ref={rootRef} className="flex flex-col min-h-0" style={{ height: `calc(100dvh - ${top}px)` }} data-testid="workbench">
      <IdentityBar profile={profile} saveState={shownSaveState} saveError={saveError} controlsCount={profile.midi.cc_map.length} notesCount={(profile.quick_reference ?? []).length} />
      <ErrorBanner message={banner} onClose={() => setBanner(null)} />
      <SplitPane left={editor} right={viewer} leftLabel="Editor" rightLabel="Reference" segment={segment} onSegment={setSegment} />
    </div>
  );
}
