"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type DocumentSearch } from "@/lib/api";
import type { CcDef, ControlProposal, DeviceProfile, DocumentKind, DocumentRef, SourceCitation } from "@/lib/types";
import { DOCUMENT_KINDS } from "@/lib/types";
import { Badge, Button } from "@/components/ui/basics";
import { BEHAVIORS } from "@/lib/knowledge";
import type { ReferenceState, Zoom } from "./types";

const ZOOMS: { value: Zoom; label: string }[] = [{ value: "fit", label: "Fit width" }, { value: 700, label: "Small" }, { value: 1000, label: "Medium" }, { value: 1400, label: "Large" }];
const MIN_W = 240, MAX_W = 1600;

/**
 * Reference Viewer: the pedal's own PDFs as page pictures (rendered on this computer, nothing in
 * the PDF runs), with document selection, page navigation, zoom, find, an explicit PDF-page index,
 * and the bridge to the editor: cite this page, start a control or note from it, propose controls
 * from its text. The reading position belongs to the Workbench, so it survives every edit.
 */
export function ReferencePane({ profile, state, onChange, editing, onCite, onSpawn, onAttach, onReplace, onAddProposed }: {
  profile: DeviceProfile;
  state: ReferenceState;
  onChange: (s: ReferenceState) => void;
  /** Which editor is open on the left, if any: decides what "cite this page" can do. */
  editing: "control" | "note" | null;
  onCite: (c: SourceCitation) => void;
  onSpawn: (kind: "control" | "note", c: SourceCitation) => void;
  onAttach: (file: File, title: string, kind: DocumentKind) => Promise<void>;
  onReplace: (docId: string, file: File) => Promise<void>;
  onAddProposed: (defs: CcDef[]) => Promise<boolean>;
}) {
  const docs = profile.documents ?? [];
  const files = useMemo(() => new Map((profile.document_files ?? []).map((f) => [f.document_id, f])), [profile.document_files]);
  const doc: DocumentRef | undefined = docs.find((d) => d.document_id === state.docId) ?? docs[0];
  const file = doc ? files.get(doc.document_id) : undefined;
  const total = file?.page_count ?? 1;
  const page = Math.min(Math.max(1, state.page), total);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<DocumentSearch | null>(null);
  const [searching, setSearching] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [uploadKind, setUploadKind] = useState<DocumentKind>("midi_chart");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [addingDoc, setAddingDoc] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [areaW, setAreaW] = useState(800);
  const [shown, setShown] = useState<{ src: string; page: number; width: number } | null>(null);
  const [proposals, setProposals] = useState<{ page: number; items: ControlProposal[]; noText: boolean; picked: Set<number> } | null>(null);
  const [proposing, setProposing] = useState(false);

  // Keep the viewer's doc id valid when documents change (a detach, a first upload).
  useEffect(() => {
    if (doc && doc.document_id !== state.docId) onChange({ ...state, docId: doc.document_id, page: 1 });
    if (!doc && state.docId) onChange({ ...state, docId: null, page: 1 });
  }, [doc, state, onChange]);
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    // Widths under 100 px are a pane that is hidden or not laid out yet: never render for them.
    const ro = new ResizeObserver(() => { if (el.clientWidth >= 100) setAreaW(el.clientWidth); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const renderWidth = state.zoom === "fit" ? Math.min(MAX_W, Math.max(MIN_W, Math.round((areaW - 16) * (window.devicePixelRatio > 1.5 ? 1.5 : 1)))) : state.zoom;
  const src = doc && file?.present ? api.documents.pageUrl(doc.document_id, page, renderWidth) : null;

  // The previous page stays on screen until the next one has loaded (no flash); the next page is
  // prefetched. "Loading" is simply "the picture on screen is not the one asked for".
  const visible = src && shown ? shown : null;
  const loading = !!src && shown?.src !== src;
  useEffect(() => {
    if (!src || !doc || shown?.src === src) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => { if (!cancelled) { setShown({ src, page, width: renderWidth }); setError(null); } };
    img.onerror = () => { if (!cancelled) setError(`Page ${page} could not be rendered on this computer.`); };
    img.src = src;
    if (page < total) { const pre = new Image(); pre.src = api.documents.pageUrl(doc.document_id, page + 1, renderWidth); }
    return () => { cancelled = true; };
  }, [src, page, renderWidth, total, doc, shown?.src]);

  const go = useCallback((n: number) => onChange({ ...state, page: Math.min(total, Math.max(1, n)) }), [onChange, state, total]);
  const pick = (id: string) => { onChange({ ...state, docId: id, page: 1 }); setHits(null); setProposals(null); };
  const search = async () => {
    if (!doc || q.trim().length < 2) return;
    setSearching(true);
    try { setHits(await api.documents.search(doc.document_id, q)); setFindOpen(true); } catch (e) { setError((e as Error).message); } finally { setSearching(false); }
  };
  const propose = async () => {
    if (!doc) return;
    setProposing(true);
    try {
      const r = await api.documents.proposals(doc.document_id, page);
      const fresh = r.proposals.filter((p) => !profile.midi.cc_map.some((c) => c.cc === p.cc));
      setProposals({ page, items: fresh, noText: !r.has_text_layer, picked: new Set(fresh.map((p) => p.cc)) });
    } catch (e) { setError((e as Error).message); } finally { setProposing(false); }
  };
  const acceptProposals = async () => {
    if (!proposals) return;
    const defs: CcDef[] = proposals.items.filter((p) => proposals.picked.has(p.cc)).map((p) => { const { snippet: _s, ...def } = p; return def; }); // eslint-disable-line @typescript-eslint/no-unused-vars
    if (!defs.length) return;
    setProposing(true);
    const ok = await onAddProposed(defs);
    setProposing(false);
    if (ok) setProposals(null);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName.match(/INPUT|TEXTAREA|SELECT|BUTTON/)) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); go(page + 1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(page - 1); }
    else if (e.key === "Home") { e.preventDefault(); go(1); }
    else if (e.key === "End") { e.preventDefault(); go(total); }
  };
  const citation: SourceCitation | null = doc ? { document_id: doc.document_id, page, note: null } : null;
  const upload = async (f: File) => {
    setUploading(true); setError(null);
    try { await onAttach(f, uploadTitle.trim() || f.name.replace(/\.pdf$/i, ""), uploadKind); setUploadTitle(""); } catch (e) { setError(e instanceof ApiError ? e.message : (e as Error).message); } finally { setUploading(false); }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-neutral-100" data-testid="reference-pane">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 border-b border-line bg-panel">
        {docs.length > 1 ? (
          <select aria-label="Reference document" value={doc?.document_id ?? ""} onChange={(e) => pick(e.target.value)} className="max-w-[14rem] truncate" data-testid="reference-doc">
            {docs.map((d) => <option key={d.document_id} value={d.document_id}>{d.title} ({DOCUMENT_KINDS.find((k) => k.value === d.kind)?.label ?? d.kind})</option>)}
          </select>
        ) : doc ? <span className="text-sm font-medium truncate max-w-[14rem]" title={doc.title} data-testid="reference-doc-title">{doc.title}</span> : <span className="text-sm text-neutral-500">Reference</span>}
        {doc && file?.present && (
          <>
            <span className="flex items-center gap-1 text-xs" data-testid="reference-nav">
              <Button onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page" className="!px-2">‹</Button>
              <input aria-label="PDF page" type="number" min={1} max={total} inputMode="numeric" className="w-14 text-center" value={page} onChange={(e) => { const n = Number(e.target.value); if (n) go(n); }} />
              <span className="text-neutral-500 whitespace-nowrap">of {total}</span>
              <Button onClick={() => go(page + 1)} disabled={page >= total} aria-label="Next page" className="!px-2">›</Button>
            </span>
            <select aria-label="Zoom" value={String(state.zoom)} onChange={(e) => onChange({ ...state, zoom: (e.target.value === "fit" ? "fit" : Number(e.target.value)) as Zoom })} className="text-xs">
              {ZOOMS.map((z) => <option key={String(z.value)} value={String(z.value)}>{z.label}</option>)}
            </select>
            <Button variant={findOpen ? "primary" : "default"} onClick={() => setFindOpen((v) => !v)} aria-expanded={findOpen} aria-controls="reference-find" className="!px-2" title="Find in document">Find</Button>
            <span className="ml-auto flex items-center gap-2 text-xs">
              <button type="button" className="underline text-neutral-600 hover:text-accent" onClick={() => setAddingDoc((v) => !v)} data-testid="reference-add-toggle">+ Document</button>
              <a className="underline text-neutral-600 hover:text-accent" href={api.documents.downloadUrl(doc.document_id)}>Download</a>
            </span>
          </>
        )}
      </div>
      {findOpen && doc && file?.present && (
        <div id="reference-find" className="px-3 py-1.5 border-b border-line bg-panel flex flex-col gap-1" data-testid="reference-find">
          <div className="flex gap-1">
            <input aria-label="Find in document" className="flex-1" placeholder="e.g. MIDI implementation, CC 12…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }} />
            <Button onClick={() => void search()} disabled={searching || q.trim().length < 2}>{searching ? "…" : "Find"}</Button>
          </div>
          {hits && (
            <div className="text-xs" data-testid="reference-hits">
              {!hits.has_text_layer && <p className="text-amber-800">This PDF has no text layer (a scanned document): text search cannot look inside it. Turn the pages instead.</p>}
              {hits.has_text_layer && !hits.hits.length && <p className="text-neutral-500">No matches for “{hits.query}”.</p>}
              <ul className="flex flex-col gap-0.5 max-h-40 overflow-auto">
                {hits.hits.map((h, i) => (
                  <li key={i}><button type="button" className={`text-left w-full rounded px-1.5 py-0.5 hover:bg-blue-50 ${h.page === page ? "bg-blue-50" : ""}`} onClick={() => go(h.page)}><Badge>p. {h.page}</Badge> <span className="text-neutral-700">…{h.snippet}…</span></button></li>
                ))}
              </ul>
              {hits.truncated && <p className="text-neutral-500">Showing the first {hits.hits.length} matches.</p>}
            </div>
          )}
        </div>
      )}
      <div ref={areaRef} className="flex-1 min-h-0 overflow-auto p-2 outline-none focus-visible:ring-2 ring-accent" tabIndex={doc && file?.present ? 0 : -1} onKeyDown={onKey} aria-label={doc ? `${doc.title}, page ${page} of ${total}` : "No document"} data-testid="reference-area">
        {!docs.length && (
          <div className="m-auto max-w-md bg-panel border border-dashed border-line rounded-md p-4 text-sm text-neutral-700 flex flex-col gap-2 mt-6" data-testid="reference-empty">
            <p className="font-medium">No manual attached to this pedal yet.</p>
            <p className="text-xs text-neutral-600">Upload the manufacturer&apos;s manual or MIDI implementation chart as a PDF. It stays on this computer; pages are shown as pictures, so nothing inside the PDF can run.</p>
            <UploadControls title={uploadTitle} kind={uploadKind} busy={uploading} onTitle={setUploadTitle} onKind={setUploadKind} onPick={() => fileRef.current?.click()} />
          </div>
        )}
        {doc && !file?.present && (
          <div className="m-auto max-w-md bg-panel border border-amber-200 rounded-md p-4 text-sm flex flex-col gap-2 mt-6" data-testid="reference-missing">
            <p className="font-medium text-amber-900">“{doc.title}” is not on this computer.</p>
            <p className="text-xs text-neutral-600">The profile was imported without its files. Page references you entered are kept; upload the same PDF again to read it here (the reference keeps its id, so citations stay valid).</p>
            <div><Button variant="primary" disabled={uploading} onClick={() => replaceRef.current?.click()}>{uploading ? "Uploading…" : "Upload this PDF again"}</Button></div>
          </div>
        )}
        {doc && file?.present && (
          <div className="relative mx-auto" style={{ width: state.zoom === "fit" ? "100%" : `${renderWidth}px`, maxWidth: state.zoom === "fit" ? "100%" : undefined }}>
            {loading && <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent/70 wb-loading" aria-hidden="true" />}
            {visible ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={visible.src} alt={`${doc.title}, PDF page ${visible.page}`} width={visible.width} className={`block w-full h-auto bg-white shadow ${loading ? "opacity-80" : ""}`} data-testid="reference-page" data-page={visible.page} data-loading={loading} />
            ) : !error ? <div className="bg-white shadow w-full aspect-[1/1.414] flex items-center justify-center text-xs text-neutral-400">Rendering page {page}…</div> : null}
            {error && (
              <div className="bg-panel border border-red-200 text-red-800 text-xs rounded px-3 py-2 mt-2 flex flex-wrap items-center gap-2" role="alert" data-testid="reference-error">
                <span className="flex-1">{error}</span>
                <Button onClick={() => { setError(null); setShown(null); }}>Try again</Button>
                <a className="underline" href={api.documents.downloadUrl(doc.document_id)}>Download the PDF</a>
              </div>
            )}
          </div>
        )}
        {proposals && (
          <div className="mt-2 mx-auto max-w-2xl bg-panel border border-line rounded-md p-3 text-xs flex flex-col gap-2" data-testid="reference-proposals">
            <div className="flex items-center gap-2">
              <span className="font-semibold">Controls found in the text of PDF page {proposals.page}</span>
              <Button variant="ghost" className="ml-auto" onClick={() => setProposals(null)} aria-label="Close proposals">✕</Button>
            </div>
            {proposals.noText && <p className="text-amber-800">This page has no text layer, so nothing could be read from it. Enter the controls by hand while reading the page.</p>}
            {!proposals.noText && !proposals.items.length && <p className="text-neutral-600">No “CC nn” pattern on this page that is not already in the list.</p>}
            {proposals.items.length > 0 && (
              <>
                <ul className="flex flex-col divide-y divide-line border border-line rounded">
                  {proposals.items.map((p) => (
                    <li key={p.cc} className="flex items-start gap-2 px-2 py-1">
                      <input type="checkbox" aria-label={`Include CC ${p.cc} ${p.name}`} checked={proposals.picked.has(p.cc)} onChange={(e) => setProposals((s) => { if (!s) return s; const picked = new Set(s.picked); if (e.target.checked) picked.add(p.cc); else picked.delete(p.cc); return { ...s, picked }; })} className="mt-1" />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1"><span className="font-mono bg-neutral-100 rounded px-1">CC {p.cc}</span><b>{p.name}</b>{p.behavior && <Badge tone="warn">{BEHAVIORS.find((b) => b.value === p.behavior)?.short} (hint)</Badge>}{p.min_value != null || p.max_value != null ? <span className="font-mono text-neutral-600">{p.min_value ?? 0}–{p.max_value ?? 127}</span> : null}</div>
                        <div className="text-neutral-500 truncate">…{p.snippet}…</div>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="text-neutral-600">Each one is added as <b>proposed</b>, citing this page: open it on the left, check it against the chart and mark it reviewed. Until then it is not offered to Scenes or Textures.</p>
                <div className="flex justify-end gap-2"><Button onClick={() => setProposals(null)}>Discard</Button><Button variant="primary" disabled={proposing || !proposals.picked.size} onClick={() => void acceptProposals()} data-testid="proposals-accept">Add {proposals.picked.size} as proposed</Button></div>
              </>
            )}
          </div>
        )}
      </div>
      {doc && file?.present && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 border-t border-line bg-panel text-xs" data-testid="reference-footer">
          <span className="text-neutral-600 basis-full lg:basis-auto"><b>PDF page {page}</b> of {total}<span className="text-neutral-400"> · printed page numbers may differ</span></span>
          <span className="lg:ml-auto flex flex-wrap gap-1">
            {editing ? (
              <Button variant="primary" onClick={() => citation && onCite(citation)} data-testid="reference-cite" title={`Write “${doc.title}, PDF page ${page}” into the open ${editing}`}>Cite p. {page} in the open {editing}</Button>
            ) : (
              <>
                <Button onClick={() => citation && onSpawn("control", citation)} data-testid="reference-new-control">+ Control from p. {page}</Button>
                <Button onClick={() => citation && onSpawn("note", citation)} data-testid="reference-new-note">+ Note from p. {page}</Button>
              </>
            )}
            <Button variant="ghost" onClick={() => void propose()} disabled={proposing} data-testid="reference-propose" title="Read “CC nn …” patterns from this page's text; everything found needs your review">{proposing ? "Reading…" : "Suggest controls from text"}</Button>
          </span>
        </div>
      )}
      {docs.length > 0 && (addingDoc || uploading) && (
        <div className="px-3 py-1.5 border-t border-line bg-panel text-[11px] text-neutral-500 flex flex-wrap items-center gap-2" data-testid="reference-add-document">
          <UploadControls inline title={uploadTitle} kind={uploadKind} busy={uploading} onTitle={setUploadTitle} onKind={setUploadKind} onPick={() => fileRef.current?.click()} />
          <Button variant="ghost" className="!py-0.5" onClick={() => setAddingDoc(false)} disabled={uploading}>Cancel</Button>
        </div>
      )}
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="Choose a PDF" data-testid="reference-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
      <input ref={replaceRef} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="Choose the PDF again" data-testid="reference-replace-file" onChange={(e) => { const f = e.target.files?.[0]; if (f && doc) { setUploading(true); onReplace(doc.document_id, f).catch((err) => setError((err as Error).message)).finally(() => setUploading(false)); } e.target.value = ""; }} />
    </div>
  );
}

function UploadControls({ inline = false, title, kind, busy, onTitle, onKind, onPick }: { inline?: boolean; title: string; kind: DocumentKind; busy: boolean; onTitle: (t: string) => void; onKind: (k: DocumentKind) => void; onPick: () => void }) {
  return (
    <div className={`flex flex-wrap items-end gap-2 ${inline ? "" : "text-xs"}`}>
      <label className="flex flex-col gap-0.5 text-neutral-600">{!inline && "Title"}<input aria-label="Document title" className={inline ? "w-36 !py-0.5" : "w-44"} placeholder="e.g. MIDI implementation" value={title} onChange={(e) => onTitle(e.target.value)} /></label>
      <label className="flex flex-col gap-0.5 text-neutral-600">{!inline && "Kind"}<select aria-label="Document kind" className={inline ? "!py-0.5" : ""} value={kind} onChange={(e) => onKind(e.target.value as DocumentKind)}>{DOCUMENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
      <Button variant={inline ? "default" : "primary"} className={inline ? "!py-0.5" : ""} disabled={busy} onClick={onPick} data-testid="reference-upload">{busy ? "Uploading…" : "Upload PDF"}</Button>
    </div>
  );
}
