"use client";

import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { DeviceProfile, DocumentKind, DocumentRef } from "@/lib/types";
import { DOCUMENT_KINDS } from "@/lib/types";
import { Badge, Button } from "@/components/ui/basics";

const kindLabel = (k: DocumentKind) => DOCUMENT_KINDS.find((x) => x.value === k)?.label ?? k;
const kb = (n: number | null | undefined) => (n == null ? "" : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/**
 * "Documents" section of a device profile: the user's own PDF manuals, quick-start sheets and
 * MIDI charts. Files live only on this computer; the profile keeps a title and a reference.
 */
export function DocumentsSection({ profile, onSaved }: { profile: DeviceProfile; onSaved: (p: DeviceProfile) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<DocumentKind>("manual");
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const docs = profile.documents ?? [];
  const files = new Map((profile.document_files ?? []).map((f) => [f.document_id, f]));
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));

  const run = async (label: string, fn: () => Promise<DeviceProfile>) => {
    setBusy(label); setError(null);
    try { onSaved(await fn()); } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const upload = (f: File) => run("upload", () => api.catalog.attachDocument(profile.id, f, title.trim() || f.name.replace(/\.pdf$/i, ""), kind)).then(() => setTitle(""));
  const rename = (d: DocumentRef) => {
    const t = window.prompt("Title for this document", d.title);
    if (t && t.trim() && t.trim() !== d.title) void run("rename", () => api.catalog.renameDocument(profile.id, d.document_id, { title: t.trim() }));
  };
  const detach = (d: DocumentRef) => {
    const f = files.get(d.document_id);
    const purge = f?.present ? window.confirm(`Also delete the file “${d.title}” from this computer?\n\nOK = detach and delete the file (only if no other profile uses it).\nCancel = detach only; the file stays and can be removed later from “Documents on this computer”.`) : false;
    void run("detach", () => api.catalog.detachDocument(profile.id, d.document_id, purge));
  };

  return (
    <div className="text-xs flex flex-col gap-2" data-testid="documents-section">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">Documents ({docs.length})</h3>
        <span className="text-neutral-500">Your own PDFs, stored on this computer only. Pages are shown as pictures; the file itself is only ever downloaded.</span>
      </div>
      {error && <p role="alert" data-testid="documents-error" className="text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p>}
      {docs.length > 0 && (
        <ul className="flex flex-col divide-y divide-line border border-line rounded">
          {docs.map((d) => {
            const f = files.get(d.document_id);
            return (
              <li key={d.document_id} className="flex flex-wrap items-center gap-2 px-2 py-1" data-testid={`document-${d.document_id}`}>
                <span className="font-medium">{d.title}</span>
                <Badge>{kindLabel(d.kind)}</Badge>
                {f?.present ? <span className="text-neutral-500">{f.page_count ?? "?"} pages · {kb(f.byte_size)}</span> : <Badge tone="warn">file not on this computer</Badge>}
                {d.note && <span className="text-neutral-500">{d.note}</span>}
                <span className="ml-auto flex gap-1">
                  {f?.present && <a className="underline px-1" href={`/documents/${d.document_id}`} target="_blank" rel="noreferrer" data-testid="document-view">View</a>}
                  {f?.present && <a className="underline px-1" href={api.documents.downloadUrl(d.document_id)}>Download</a>}
                  <Button variant="ghost" onClick={() => rename(d)} disabled={!!busy}>Rename</Button>
                  <Button variant="ghost" disabled={!!busy} onClick={() => { setReplacing(d.document_id); replaceRef.current?.click(); }}>Replace</Button>
                  <Button variant="ghost" aria-label={`Detach ${d.title}`} disabled={!!busy} onClick={() => detach(d)}>✕</Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2 border border-dashed border-line rounded p-2">
        <label className="flex flex-col gap-0.5 text-neutral-600">Title<input aria-label="Document title" className="w-48" placeholder="e.g. Owner's manual" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="flex flex-col gap-0.5 text-neutral-600">Kind<select aria-label="Document kind" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>{DOCUMENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
        <Button variant="primary" disabled={!!busy} onClick={() => fileRef.current?.click()}>{busy === "upload" ? "Uploading…" : "+ Upload PDF"}</Button>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="Choose a PDF" data-testid="document-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
        <input ref={replaceRef} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="Choose a replacement PDF" data-testid="document-replace-file" onChange={(e) => { const f = e.target.files?.[0]; const id = replacing; setReplacing(null); if (f && id) void run("replace", async () => { try { return await api.catalog.replaceDocument(profile.id, id, f); } catch (err) { if (err instanceof ApiError && err.status === 409 && window.confirm(`${err.message}\n\nReplace anyway?`)) return api.catalog.replaceDocument(profile.id, id, f, true); throw err; } }); e.target.value = ""; }} />
        <span className="text-[10px] text-neutral-400 basis-full">PDF up to 40 MB. The file must really be a PDF (checked by content, not by name). Nothing is downloaded from manufacturers, and nothing you upload leaves this computer unless you export a project with documents included. You are responsible for having the right to keep a copy.</span>
      </div>
    </div>
  );
}
