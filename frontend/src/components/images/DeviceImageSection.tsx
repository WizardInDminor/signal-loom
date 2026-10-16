"use client";

import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { AssetRecord, DeviceImage, Evidence, PortDef } from "@/lib/types";
import { Badge, Button } from "@/components/ui/basics";
import { DeviceImageGlyph } from "./DeviceImageGlyph";
import { ImageCropEditor } from "./ImageCropEditor";

/**
 * "Picture" section for a profile or one placed unit: add, recrop, replace or remove a
 * photograph. Owns the upload and the editor; the parent only persists the resulting
 * DeviceImage (or null). Works the same everywhere so the catalog and the board inspector
 * share one workflow.
 */
export function DeviceImageSection({ value, onSave, widthMm, depthMm, evidence, ports = [], fill, heading, hint, testId = "device-image-section" }: {
  value: DeviceImage | null;
  onSave: (image: DeviceImage | null) => Promise<void> | void;
  widthMm: number | null;
  depthMm: number | null;
  evidence?: Evidence;
  ports?: PortDef[];
  fill?: string;
  heading?: string;
  hint?: string;
  testId?: string;
}) {
  // Resolved metadata for the current asset id; derived values below ignore stale entries.
  const [meta, setMeta] = useState<{ id: string; rec: AssetRecord | null } | null>(null);
  const asset = meta && meta.id === value?.asset_id ? meta.rec : null;
  const missing = !!meta && meta.id === value?.asset_id && meta.rec === null;
  const [editing, setEditing] = useState<{ asset: AssetRecord; initial: DeviceImage | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  // Resolve the stored asset so the thumbnail and "recrop" know the picture's size.
  useEffect(() => {
    if (!value) return;
    let cancelled = false;
    const id = value.asset_id;
    api.assets.meta(id).then((m) => { if (!cancelled) setMeta({ id, rec: m }); }).catch(() => { if (!cancelled) setMeta({ id, rec: null }); });
    return () => { cancelled = true; };
  }, [value?.asset_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));

  const uploadAndEdit = async (file: File, keepCrop: boolean) => {
    setError(null);
    setBusy("Uploading and checking the picture…");
    try {
      const rec = await api.assets.upload(file);
      setEditing({ asset: rec, initial: keepCrop && value ? { ...value, asset_id: rec.id } : null });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const recrop = async () => {
    if (!value) return;
    setError(null);
    try {
      const m = asset ?? (await api.assets.meta(value.asset_id));
      setEditing({ asset: m, initial: value });
    } catch (e) {
      fail(e);
    }
  };
  const save = async (img: DeviceImage | null) => {
    setError(null);
    setBusy("Saving…");
    try {
      await onSave(img);
      setEditing(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const thumb = value && asset ? { asset_id: asset.id, missing: false as const, source: "profile" as const, url: asset.url, width: asset.width, height: asset.height, crop: value.crop, rotation_quarter: value.rotation_quarter, fit: value.fit, calibrated: value.calibrated } : null;
  const tw = widthMm ?? 70;
  const td = depthMm ?? 120;
  const ts = Math.min(120 / tw, 90 / td);

  return (
    <div className="flex flex-col gap-2 text-xs" data-testid={testId}>
      {heading && <h3 className="font-semibold">{heading}</h3>}
      {error && <div role="alert" className="rounded border border-red-200 bg-red-50 text-red-800 px-2 py-1" data-testid={`${testId}-error`}>{error}</div>}
      {busy && <div className="text-neutral-500" aria-live="polite">{busy}</div>}
      {editing ? (
        <ImageCropEditor
          asset={editing.asset}
          initial={editing.initial}
          widthMm={widthMm}
          depthMm={depthMm}
          evidence={evidence}
          ports={ports}
          fill={fill}
          busy={!!busy}
          onSave={save}
          onCancel={() => setEditing(null)}
          onReplace={(f) => void uploadAndEdit(f, true)}
        />
      ) : (
        <div className="flex items-start gap-3">
          {value ? (
            <div className="shrink-0 rounded bg-neutral-900 p-1" data-testid={`${testId}-thumb`}>
              {thumb ? (
                <svg viewBox={`0 0 ${tw * ts} ${td * ts}`} width={tw * ts} height={td * ts} role="img" aria-label="Current picture fitted to the footprint">
                  <g transform={`scale(${ts})`}>
                    <rect width={tw} height={td} rx={3} fill={fill ?? "#f3f4f6"} />
                    <DeviceImageGlyph x={0} y={0} w={tw} h={td} rotation={0} image={thumb} clipId={`clip-thumb-${uid}`} />
                  </g>
                </svg>
              ) : (
                <div style={{ width: tw * ts, height: td * ts }} className="flex items-center justify-center text-[10px] text-neutral-400">{missing ? "picture missing" : "…"}</div>
              )}
            </div>
          ) : (
            <div className="shrink-0 rounded border border-dashed border-line flex items-center justify-center text-[10px] text-neutral-400" style={{ width: tw * ts, height: td * ts }}>no picture</div>
          )}
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-1">
              {value ? (
                <>
                  {value.calibrated ? <Badge tone="ok">calibrated to {widthMm} × {depthMm} mm</Badge> : <Badge tone="warn">cropped, not calibrated (no dimensions)</Badge>}
                  <Badge>{value.fit === "cover" ? "fill & clip" : "fit inside"}</Badge>
                  {value.rotation_quarter ? <Badge>turned {value.rotation_quarter * 90}°</Badge> : null}
                  {missing && <Badge tone="bad">file not on this computer</Badge>}
                </>
              ) : (
                <span className="text-neutral-600">{hint ?? "Add a top-down photograph, draw a box around the enclosure, and the board shows the real pedal."}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Choose a picture" data-testid={`${testId}-file`} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAndEdit(f, false); e.target.value = ""; }} />
              {value ? (
                <>
                  {!missing && <Button onClick={() => void recrop()} data-testid={`${testId}-recrop`}>Recrop</Button>}
                  <Button onClick={() => fileRef.current?.click()} disabled={!!busy}>Replace…</Button>
                  <Button variant="danger" onClick={() => window.confirm("Remove the picture? The enclosure drawing is used instead; the device's dimensions, jacks and MIDI settings are not affected.") && void save(null)} data-testid={`${testId}-remove`}>Remove</Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={!!busy} data-testid={`${testId}-add`}>Add picture…</Button>
              )}
            </div>
            <p className="text-[10px] text-neutral-400">JPEG, PNG or WebP up to 15 MB. Stored on this computer only (a sanitized copy; no EXIF/GPS data is kept). You are responsible for having the right to use a photograph you upload.</p>
          </div>
        </div>
      )}
    </div>
  );
}
