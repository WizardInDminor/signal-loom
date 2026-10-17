// Pure geometry for fitting a cropped photograph to a device's physical footprint.
// The footprint (mm) is the truth; the picture is an overlay. Nothing here ever changes mm.

import type { DeviceImage, ImageCrop } from "./types";

/** Pixel aspect (width / height) of the selection after its quarter-turn rotation. */
export function selectionAspect(crop: ImageCrop, rotationQuarter: number, imgW: number, imgH: number): number {
  const pw = crop.w * imgW;
  const ph = crop.h * imgH;
  return rotationQuarter % 2 === 1 ? ph / pw : pw / ph;
}

/** The pixel aspect the selection must have to match the enclosure exactly, given the quarter turn. */
export function targetSelectionAspect(widthMm: number, depthMm: number, rotationQuarter: number): number {
  const enclosure = widthMm / depthMm;
  return rotationQuarter % 2 === 1 ? 1 / enclosure : enclosure;
}

export interface FitReport {
  /** Ratio of selection aspect to enclosure aspect (1 = exact). */
  ratio: number;
  matches: boolean;
  /** For fit=contain: margins in mm the enclosure colour will show (per side). */
  marginMm: { horizontal: number; vertical: number };
  /** For fit=cover: fraction of the selection clipped, per axis. */
  clipped: { horizontal: number; vertical: number };
  text: string;
}

export function fitReport(image: Pick<DeviceImage, "crop" | "rotation_quarter" | "fit">, imgW: number, imgH: number, widthMm: number | null, depthMm: number | null): FitReport | null {
  if (!widthMm || !depthMm) return null;
  const sel = selectionAspect(image.crop, image.rotation_quarter, imgW, imgH);
  const enc = widthMm / depthMm;
  const ratio = sel / enc;
  const matches = Math.abs(ratio - 1) < 0.01;
  // contain: the selection is scaled to touch the enclosure on its longer relative axis.
  let marginH = 0;
  let marginV = 0;
  if (ratio > 1) marginV = (depthMm - widthMm / sel) / 2; // selection wider than enclosure: bands top/bottom
  else if (ratio < 1) marginH = (widthMm - depthMm * sel) / 2; // selection taller: bands left/right
  // cover: the selection is scaled to fill; the overhang on one axis is clipped.
  const clipH = ratio > 1 ? 1 - 1 / ratio : 0;
  const clipV = ratio < 1 ? 1 - ratio : 0;
  let text: string;
  if (matches) text = "The selection has the enclosure's proportions: the picture fills the footprint exactly.";
  else {
    const pct = Math.round(Math.abs(ratio - 1) * 100);
    const dir = ratio > 1 ? "wider" : "taller";
    text =
      image.fit === "contain"
        ? `The selection is ${pct}% ${dir} than the ${widthMm} × ${depthMm} mm footprint. Fit inside keeps all of it and leaves ${ratio > 1 ? `${marginV.toFixed(1)} mm bands top and bottom` : `${marginH.toFixed(1)} mm bands left and right`} in the enclosure colour.`
        : `The selection is ${pct}% ${dir} than the ${widthMm} × ${depthMm} mm footprint. Fill clips ${Math.round((ratio > 1 ? clipH : clipV) * 100)}% of it ${ratio > 1 ? "at the left and right" : "at the top and bottom"}; nothing is stretched.`;
  }
  return { ratio, matches, marginMm: { horizontal: marginH, vertical: marginV }, clipped: { horizontal: clipH, vertical: clipV }, text };
}

export const MIN_CROP = 0.02;

export function clampCrop(c: ImageCrop): ImageCrop {
  const w = Math.min(1, Math.max(MIN_CROP, c.w));
  const h = Math.min(1, Math.max(MIN_CROP, c.h));
  const x = Math.min(1 - w, Math.max(0, c.x));
  const y = Math.min(1 - h, Math.max(0, c.y));
  return { x, y, w, h };
}

/** Largest selection with the target pixel aspect, centred in the image. */
export function centredCrop(targetAspectPx: number, imgW: number, imgH: number, scale = 0.8): ImageCrop {
  // normalized w/h so that (w*imgW)/(h*imgH) = target
  let w = scale;
  let h = (w * imgW) / (targetAspectPx * imgH);
  if (h > scale) {
    h = scale;
    w = (h * targetAspectPx * imgH) / imgW;
  }
  return clampCrop({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
}

/** Given a normalized height, the width that keeps the target pixel aspect (and vice versa). */
export function widthForHeight(h: number, targetAspectPx: number, imgW: number, imgH: number): number {
  return (h * targetAspectPx * imgH) / imgW;
}
export function heightForWidth(w: number, targetAspectPx: number, imgW: number, imgH: number): number {
  return (w * imgW) / (targetAspectPx * imgH);
}

export function roundCrop(c: ImageCrop): ImageCrop {
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return { x: r(c.x), y: r(c.y), w: r(c.w), h: r(c.h) };
}

/**
 * Re-fit a selection to a target pixel aspect while keeping its centre and, where possible,
 * its width: used when the lock is switched on, the picture is turned, or a replacement
 * photograph has different pixel dimensions than the one the crop was made on.
 */
export function reconcileCrop(crop: ImageCrop, targetAspectPx: number, imgW: number, imgH: number): ImageCrop {
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  let w = crop.w;
  let h = heightForWidth(w, targetAspectPx, imgW, imgH);
  if (h > 1) {
    h = 1;
    w = widthForHeight(h, targetAspectPx, imgW, imgH);
  }
  if (w > 1) {
    w = 1;
    h = heightForWidth(w, targetAspectPx, imgW, imgH);
  }
  return clampCrop({ x: cx - w / 2, y: cy - h / 2, w, h });
}

/** True when the selection already has the target pixel aspect (within 1%). */
export function cropMatches(crop: ImageCrop, targetAspectPx: number, imgW: number, imgH: number): boolean {
  const sel = (crop.w * imgW) / (crop.h * imgH);
  return Math.abs(sel / targetAspectPx - 1) < 0.01;
}
