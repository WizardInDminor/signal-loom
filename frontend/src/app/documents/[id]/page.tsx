"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, type DocumentMeta, type DocumentSearch } from "@/lib/api";
import { Badge, Button, ErrorBanner, Panel } from "@/components/ui/basics";

const WIDTHS = [700, 1000, 1400];

/**
 * Passive document viewer: every page is a PNG rendered on this computer by PDFium, so the PDF's
 * own scripts, links and forms never run in the browser. Deep link: `/documents/<id>?page=N`.
 */
export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const [meta, setMeta] = useState<DocumentMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(() => Math.max(1, Number(params.get("page") ?? 1) || 1));
  const [width, setWidth] = useState(1000);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<DocumentSearch | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadedKey, setLoadedKey] = useState("");
  const loaded = loadedKey === `${page}-${width}`;
  const total = meta?.page_count ?? 1;

  useEffect(() => {
    if (!id) return;
    api.documents.meta(id).then(setMeta).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => {
    if (typeof window !== "undefined") window.history.replaceState(null, "", `?page=${page}`);
  }, [page]);
  const go = (n: number) => setPage(Math.min(total, Math.max(1, n)));
  const search = async () => {
    if (!id || q.trim().length < 2) return;
    setSearching(true);
    try { setHits(await api.documents.search(id, q)); } catch (e) { setError((e as Error).message); } finally { setSearching(false); }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight" || e.key === "PageDown") go(page + 1);
      if (e.key === "ArrowLeft" || e.key === "PageUp") go(page - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, total]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-4 grid lg:grid-cols-[minmax(0,1fr)_300px] gap-3 items-start" data-testid="document-viewer">
      <Panel className="min-w-0" title={meta ? `${meta.original_name ?? meta.id} — page ${page} of ${total}` : "Document"} actions={
        <div className="flex items-center gap-1 text-xs">
          <Button onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page">‹</Button>
          <input aria-label="Page number" type="number" min={1} max={total} className="w-14" value={page} onChange={(e) => go(Number(e.target.value) || 1)} />
          <span className="text-neutral-500">/ {total}</span>
          <Button onClick={() => go(page + 1)} disabled={page >= total} aria-label="Next page">›</Button>
          <select aria-label="Zoom" value={width} onChange={(e) => setWidth(Number(e.target.value))}>{WIDTHS.map((w) => <option key={w} value={w}>{w === 700 ? "small" : w === 1000 ? "medium" : "large"}</option>)}</select>
          {meta?.file_present && <a className="underline px-1" href={api.documents.downloadUrl(meta.id)}>Download PDF</a>}
        </div>
      }>
        <ErrorBanner message={error} onClose={() => setError(null)} />
        {meta && !meta.file_present && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">This document&apos;s file is not on this computer (the project that referenced it was imported without documents). Upload it again on the device profile to view it.</p>}
        {meta?.file_present && (
          <div className="overflow-auto bg-neutral-200 rounded p-2 max-h-[80vh]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={`${page}-${width}`} src={api.documents.pageUrl(meta.id, page, width)} alt={`Page ${page}`} width={width} className={`mx-auto bg-white shadow ${loaded ? "" : "opacity-60"}`} style={{ maxWidth: "100%" }} data-testid="document-page" data-page={page} onLoad={() => setLoadedKey(`${page}-${width}`)} onError={() => setError(`Page ${page} could not be rendered.`)} />
          </div>
        )}
        <p className="text-[11px] text-neutral-500 mt-1">Pages are pictures rendered on this computer; links, forms and scripts inside the PDF are not active here. Use ← → to turn pages.</p>
      </Panel>
      <div className="flex flex-col gap-3">
        <Panel title="Find in document">
          <div className="flex gap-1 text-xs">
            <input aria-label="Search text" className="flex-1" placeholder="e.g. CC 10" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} />
            <Button onClick={() => void search()} disabled={searching || q.trim().length < 2}>{searching ? "…" : "Find"}</Button>
          </div>
          {hits && (
            <div className="text-xs mt-2" data-testid="document-hits">
              {!hits.has_text_layer && <p className="text-amber-800">This PDF has no text layer (a scanned document); text search cannot find anything in it.</p>}
              {hits.has_text_layer && !hits.hits.length && <p className="text-neutral-500">No matches for “{hits.query}”.</p>}
              <ul className="flex flex-col gap-1 max-h-[50vh] overflow-auto">
                {hits.hits.map((h, i) => (
                  <li key={i}><button type="button" className="text-left w-full border border-line rounded px-2 py-1 hover:bg-blue-50" onClick={() => go(h.page)}><Badge>p. {h.page}</Badge> <span className="text-neutral-700">…{h.snippet}…</span></button></li>
                ))}
              </ul>
              {hits.truncated && <p className="text-neutral-500 mt-1">Showing the first {hits.hits.length} matches.</p>}
            </div>
          )}
        </Panel>
        {meta && (
          <Panel title="About this file">
            <ul className="text-xs text-neutral-600 flex flex-col gap-0.5">
              <li>Id <code>{meta.id}</code></li>
              <li>{meta.page_count ?? "?"} pages · {Math.round(meta.byte_size / 1024)} KB · uploaded {meta.created_at.slice(0, 10)}</li>
              <li>Original file name: {meta.original_name ?? "—"}</li>
              <li>Used by {meta.referenced_by.length} profile{meta.referenced_by.length === 1 ? "" : "s"}{meta.referenced_by.length ? ": " + meta.referenced_by.join(", ") : ""}</li>
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}
