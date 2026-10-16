"use client";

import { useId, useRef, useState } from "react";
import type { AssetRecord, DeviceImage, Evidence, ImageCrop, PortDef } from "@/lib/types";
import { Badge, Button, EvidenceBadge, KIND_COLOR } from "@/components/ui/basics";
import { centredCrop, clampCrop, fitReport, heightForWidth, MIN_CROP, roundCrop, targetSelectionAspect, widthForHeight } from "@/lib/imageFit";
import { DeviceImageGlyph } from "./DeviceImageGlyph";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Mode =
  | { type: "draw"; ax: number; ay: number }
  | { type: "move"; ox: number; oy: number; start: ImageCrop }
  | { type: "resize"; handle: Handle; start: ImageCrop; ax: number; ay: number };

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MAX_W = 560;
const MAX_H = 430;

/**
 * Interactive crop + calibration editor. Draw a rectangle around the pedal, move it, resize it
 * with handles, lock it to the enclosure's width : depth, turn it in quarter steps and choose
 * how a mismatched selection is fitted. The right-hand preview shows the result in the real
 * footprint with the device's jacks, so the user sees exactly what the board will show.
 */
export function ImageCropEditor({ asset, initial, widthMm, depthMm, evidence, ports = [], fill = "#f3f4f6", onSave, onCancel, onReplace, busy = false }: {
  asset: AssetRecord;
  initial: DeviceImage | null;
  widthMm: number | null;
  depthMm: number | null;
  evidence?: Evidence;
  ports?: PortDef[];
  fill?: string;
  onSave: (image: DeviceImage) => void;
  onCancel: () => void;
  onReplace?: (file: File) => void;
  busy?: boolean;
}) {
  const dims = !!(widthMm && depthMm);
  const [q, setQ] = useState(initial?.rotation_quarter ?? 0);
  const [fit, setFit] = useState<"contain" | "cover">(initial?.fit ?? "contain");
  const [lock, setLock] = useState(dims);
  const target = dims ? targetSelectionAspect(widthMm!, depthMm!, q) : null;
  const [crop, setCrop] = useState<ImageCrop>(() => (initial ? initial.crop : dims ? centredCrop(targetSelectionAspect(widthMm!, depthMm!, 0), asset.width, asset.height) : { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }));
  const [mode, setMode] = useState<Mode | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  // Displayed size of the photograph.
  const scale = Math.min(MAX_W / asset.width, MAX_H / asset.height, 1);
  const dw = Math.round(asset.width * scale);
  const dh = Math.round(asset.height * scale);

  const toNorm = (e: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: Math.min(1, Math.max(0, p.x / dw)), y: Math.min(1, Math.max(0, p.y / dh)) };
  };

  /** Rectangle from a fixed anchor to the pointer, honouring the lock and the image bounds. */
  const rectFromAnchor = (ax: number, ay: number, mx: number, my: number, axes: "both" | "x" | "y", start: ImageCrop): ImageCrop => {
    let w = axes === "y" ? start.w : Math.abs(mx - ax);
    let h = axes === "x" ? start.h : Math.abs(my - ay);
    const t = lock && target ? target : null;
    if (t) {
      if (axes === "x") h = heightForWidth(w, t, asset.width, asset.height);
      else if (axes === "y") w = widthForHeight(h, t, asset.width, asset.height);
      else {
        const h1 = heightForWidth(w, t, asset.width, asset.height);
        if (h1 >= h) h = h1;
        else w = widthForHeight(h, t, asset.width, asset.height);
      }
    }
    if (w < MIN_CROP) { w = MIN_CROP; if (t) h = heightForWidth(w, t, asset.width, asset.height); }
    if (h < MIN_CROP) { h = MIN_CROP; if (t) w = widthForHeight(h, t, asset.width, asset.height); }
    const sx = axes === "y" ? 1 : mx >= ax ? 1 : -1;
    const sy = axes === "x" ? 1 : my >= ay ? 1 : -1;
    // For single-axis handles the other axis stays centred on the original rectangle.
    const cx0 = start.x + start.w / 2;
    const cy0 = start.y + start.h / 2;
    let maxW = axes === "y" ? Math.min(cx0, 1 - cx0) * 2 : sx > 0 ? 1 - ax : ax;
    let maxH = axes === "x" ? Math.min(cy0, 1 - cy0) * 2 : sy > 0 ? 1 - ay : ay;
    maxW = Math.max(MIN_CROP, maxW);
    maxH = Math.max(MIN_CROP, maxH);
    if (t) {
      const k = Math.min(1, maxW / w, maxH / h);
      w *= k;
      h *= k;
    } else {
      w = Math.min(w, maxW);
      h = Math.min(h, maxH);
    }
    const x = axes === "y" ? cx0 - w / 2 : sx > 0 ? ax : ax - w;
    const y = axes === "x" ? cy0 - h / 2 : sy > 0 ? ay : ay - h;
    return clampCrop({ x, y, w, h });
  };

  const onDown = (e: React.PointerEvent, handle?: Handle) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    svgRef.current?.setPointerCapture?.(e.pointerId);
    const p = toNorm(e);
    if (handle) {
      // Anchor is the opposite side/corner.
      const ax = handle.includes("w") ? crop.x + crop.w : crop.x;
      const ay = handle.includes("n") ? crop.y + crop.h : crop.y;
      setMode({ type: "resize", handle, start: crop, ax, ay });
      return;
    }
    const inside = p.x >= crop.x && p.x <= crop.x + crop.w && p.y >= crop.y && p.y <= crop.y + crop.h;
    if (inside) setMode({ type: "move", ox: p.x - crop.x, oy: p.y - crop.y, start: crop });
    else setMode({ type: "draw", ax: p.x, ay: p.y });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!mode) return;
    const p = toNorm(e);
    if (mode.type === "move") setCrop(clampCrop({ x: p.x - mode.ox, y: p.y - mode.oy, w: mode.start.w, h: mode.start.h }));
    else if (mode.type === "draw") setCrop(rectFromAnchor(mode.ax, mode.ay, p.x, p.y, "both", crop));
    else {
      const axes = mode.handle === "e" || mode.handle === "w" ? "x" : mode.handle === "n" || mode.handle === "s" ? "y" : "both";
      setCrop(rectFromAnchor(mode.ax, mode.ay, p.x, p.y, axes, mode.start));
    }
  };
  const onUp = () => setMode(null);

  // Keyboard nudging when the editor has focus.
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.02 : 0.005;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const v = d[e.key];
    if (!v) return;
    e.preventDefault();
    setCrop((c) => clampCrop({ ...c, x: c.x + v[0], y: c.y + v[1] }));
  };

  // Re-lock when the quarter turn changes (the target aspect flips).
  const rotate = (dir: 1 | -1) => {
    const nq = (q + dir + 4) % 4;
    setQ(nq);
    if (lock && dims) {
      const t = targetSelectionAspect(widthMm!, depthMm!, nq);
      const cx = crop.x + crop.w / 2;
      const cy = crop.y + crop.h / 2;
      let w = crop.w;
      let h = heightForWidth(w, t, asset.width, asset.height);
      if (h > 1) { h = 1; w = widthForHeight(h, t, asset.width, asset.height); }
      setCrop(clampCrop({ x: cx - w / 2, y: cy - h / 2, w, h }));
    }
  };
  const applyLock = (on: boolean) => {
    setLock(on);
    if (on && target) {
      const cx = crop.x + crop.w / 2;
      const cy = crop.y + crop.h / 2;
      let w = crop.w;
      let h = heightForWidth(w, target, asset.width, asset.height);
      if (h > 1) { h = 1; w = widthForHeight(h, target, asset.width, asset.height); }
      setCrop(clampCrop({ x: cx - w / 2, y: cy - h / 2, w, h }));
    }
  };

  const report = dims ? fitReport({ crop, rotation_quarter: q, fit }, asset.width, asset.height, widthMm, depthMm) : null;
  const draft: DeviceImage = { asset_id: asset.id, crop: roundCrop(crop), rotation_quarter: q, fit, calibrated: dims };
  const previewImage = { asset_id: asset.id, missing: false as const, source: "profile" as const, url: asset.url, width: asset.width, height: asset.height, crop, rotation_quarter: q, fit, calibrated: dims };

  // Preview of the footprint at scale with the jacks in place.
  const pw = widthMm ?? (q % 2 ? crop.h * asset.height : crop.w * asset.width) / 10;
  const pd = depthMm ?? (q % 2 ? crop.w * asset.width : crop.h * asset.height) / 10;
  const pad = 14;
  const ps = Math.min(260 / (pw + pad * 2), 220 / (pd + pad * 2));
  const jackAt = (p: PortDef) => {
    const t = p.position ?? 0.5;
    switch (p.edge) {
      case "top": return { x: pad + pw * t, y: pad };
      case "bottom": return { x: pad + pw * t, y: pad + pd };
      case "left": return { x: pad, y: pad + pd * t };
      case "right": return { x: pad + pw, y: pad + pd * t };
      default: return { x: pad + pw * t, y: pad + pd / 2 };
    }
  };

  const hx = (hd: Handle) => (hd.includes("w") ? crop.x : hd.includes("e") ? crop.x + crop.w : crop.x + crop.w / 2) * dw;
  const hy = (hd: Handle) => (hd.includes("n") ? crop.y : hd.includes("s") ? crop.y + crop.h : crop.y + crop.h / 2) * dh;
  const cursorFor: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

  return (
    <div className="flex flex-col gap-3 text-xs" data-testid="image-crop-editor">
      <div className="grid lg:grid-cols-[auto_1fr] gap-4 items-start">
        <div className="flex flex-col gap-1">
          <div className="relative select-none touch-none" style={{ width: dw, height: dh }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset.url} alt="Uploaded photograph" width={dw} height={dh} className="block rounded" draggable={false} />
            <svg
              ref={svgRef}
              viewBox={`0 0 ${dw} ${dh}`}
              width={dw}
              height={dh}
              className="absolute inset-0 rounded outline-none focus-visible:ring-2 ring-accent"
              role="application"
              aria-label="Crop selection: drag to draw, drag inside to move, drag handles to resize, arrow keys nudge"
              tabIndex={0}
              data-testid="crop-overlay"
              style={{ cursor: mode?.type === "move" ? "grabbing" : "crosshair" }}
              onPointerDown={(e) => onDown(e)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onKeyDown={onKey}
            >
              <defs>
                <mask id={`mask-${uid}`}>
                  <rect width={dw} height={dh} fill="#fff" />
                  <rect x={crop.x * dw} y={crop.y * dh} width={crop.w * dw} height={crop.h * dh} fill="#000" />
                </mask>
              </defs>
              <rect width={dw} height={dh} fill="#0f172a" opacity={0.55} mask={`url(#mask-${uid})`} pointerEvents="none" />
              <g data-testid="crop-rect" data-x={crop.x.toFixed(4)} data-y={crop.y.toFixed(4)} data-w={crop.w.toFixed(4)} data-h={crop.h.toFixed(4)}>
                <rect x={crop.x * dw} y={crop.y * dh} width={crop.w * dw} height={crop.h * dh} fill="none" stroke="#fff" strokeWidth={1.5} style={{ cursor: "grab" }} />
                <rect x={crop.x * dw} y={crop.y * dh} width={crop.w * dw} height={crop.h * dh} fill="none" stroke="#fbbf24" strokeWidth={1} strokeDasharray="6 4" pointerEvents="none" />
                {/* rule-of-thirds guides help line the enclosure edges up */}
                {[1 / 3, 2 / 3].map((f) => (
                  <g key={f} pointerEvents="none" stroke="#fff" strokeOpacity={0.35} strokeWidth={0.6}>
                    <line x1={(crop.x + crop.w * f) * dw} y1={crop.y * dh} x2={(crop.x + crop.w * f) * dw} y2={(crop.y + crop.h) * dh} />
                    <line x1={crop.x * dw} y1={(crop.y + crop.h * f) * dh} x2={(crop.x + crop.w) * dw} y2={(crop.y + crop.h * f) * dh} />
                  </g>
                ))}
                {HANDLES.map((hd) => (
                  <rect key={hd} data-testid={`crop-handle-${hd}`} x={hx(hd) - 5} y={hy(hd) - 5} width={10} height={10} rx={2} fill="#fff" stroke="#0f172a" strokeWidth={1} style={{ cursor: cursorFor[hd] }} onPointerDown={(e) => onDown(e, hd)} />
                ))}
              </g>
            </svg>
          </div>
          <div className="text-[11px] text-neutral-500 flex flex-wrap gap-x-3">
            <span>{asset.width} × {asset.height} px stored copy{asset.original_name ? ` · from ${asset.original_name}` : ""}</span>
            <span>selection {Math.round(crop.w * asset.width)} × {Math.round(crop.h * asset.height)} px</span>
          </div>
        </div>

        <div className="flex flex-col gap-3 min-w-[260px]">
          <div>
            <h4 className="font-semibold mb-1">On the board</h4>
            <svg viewBox={`0 0 ${(pw + pad * 2) * ps} ${(pd + pad * 2) * ps}`} width={(pw + pad * 2) * ps} height={(pd + pad * 2) * ps} className="bg-neutral-900 rounded" role="img" aria-label="Preview of the picture fitted to the enclosure" data-testid="crop-preview">
              <g transform={`scale(${ps})`}>
                <rect x={pad} y={pad} width={pw} height={pd} rx={3} fill={fill} stroke="#1f2937" strokeWidth={0.8 / ps} />
                <DeviceImageGlyph x={pad} y={pad} w={pw} h={pd} rotation={0} image={previewImage} clipId={`clip-prev-${uid}`} />
                <rect x={pad} y={pad} width={pw} height={pd} rx={3} fill="none" stroke="#e2e8f0" strokeWidth={1 / ps} strokeDasharray={`${4 / ps} ${3 / ps}`} />
                {ports.map((p) => {
                  const at = jackAt(p);
                  return <circle key={p.id} cx={at.x} cy={at.y} r={2.6} fill={KIND_COLOR[p.kind]} stroke="#fff" strokeWidth={0.6}><title>{p.label}</title></circle>;
                })}
              </g>
            </svg>
            <div className="text-[11px] text-neutral-500 mt-1">
              {dims ? <>Footprint {widthMm} × {depthMm} mm {evidence && <EvidenceBadge evidence={evidence} />} · jacks from the profile · top edge = away from the player</> : <Badge tone="warn">no width/depth recorded: not to scale</Badge>}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={`flex items-center gap-2 ${dims ? "" : "opacity-60"}`}>
              <input type="checkbox" checked={lock} disabled={!dims} onChange={(e) => applyLock(e.target.checked)} data-testid="crop-lock" />
              Lock selection to the enclosure&apos;s width : depth{dims ? ` (${(widthMm! / depthMm!).toFixed(3)})` : ""}
            </label>
            <div className="flex items-center gap-2">
              <span>Turn picture:</span>
              <Button onClick={() => rotate(-1)} aria-label="Rotate picture anticlockwise">⟲ 90°</Button>
              <Button onClick={() => rotate(1)} aria-label="Rotate picture clockwise" data-testid="crop-rotate-cw">⟳ 90°</Button>
              <span className="text-neutral-500">{q * 90}°</span>
            </div>
            <div className="flex items-center gap-3">
              <span>If proportions differ:</span>
              <label className="flex items-center gap-1"><input type="radio" name={`fit-${uid}`} checked={fit === "contain"} onChange={() => setFit("contain")} /> fit inside</label>
              <label className="flex items-center gap-1"><input type="radio" name={`fit-${uid}`} checked={fit === "cover"} onChange={() => setFit("cover")} data-testid="crop-fit-cover" /> fill &amp; clip</label>
            </div>
            <div className="flex flex-wrap gap-2">
              {dims && <Button onClick={() => setCrop(centredCrop(target!, asset.width, asset.height))}>Centre at enclosure ratio</Button>}
              <Button onClick={() => { setLock(false); setCrop({ x: 0, y: 0, w: 1, h: 1 }); }}>Whole picture</Button>
              {onReplace && (
                <label className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-sm border bg-panel border-line hover:bg-neutral-100 cursor-pointer">
                  Replace photo…
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && onReplace(e.target.files[0])} />
                </label>
              )}
            </div>
          </div>

          <p className={`rounded border px-2 py-1.5 ${report?.matches ? "bg-green-50 border-green-200 text-green-900" : "bg-amber-50 border-amber-200 text-amber-900"}`} data-testid="crop-fit-report">
            {report ? report.text : "Without a recorded width and depth the picture cannot be calibrated to physical scale. Save the crop now; enter dimensions on the profile and recrop to calibrate."}
          </p>
          <p className="text-[11px] text-neutral-500">Cropping cannot straighten a photograph taken at an angle: a top-down shot works best. The selection is stored as proportions of the photo, so you can come back and adjust it.</p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => onSave(draft)} disabled={busy} data-testid="crop-save">{busy ? "Saving…" : "Save picture"}</Button>
            <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
