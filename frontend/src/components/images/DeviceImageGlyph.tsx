"use client";

import type { ResolvedImage } from "@/lib/types";

/**
 * Draws a device's photograph into its physical footprint, in SVG user units (mm).
 *
 * `x, y, w, h` are the *rotated* bounding box the board uses for the device and `rotation` the
 * instance's rotation; the picture is placed in the unrotated enclosure frame and rotated with
 * the device, exactly like the jacks are. The crop is applied with a nested viewport (viewBox =
 * crop in pixels), so nothing is ever stretched: `contain` letterboxes (the enclosure fill shows
 * through), `cover` clips. Jacks, cables and measurements are drawn by the callers on top.
 */
export function DeviceImageGlyph({ x, y, w, h, rotation, image, clipId, rx = 3, opacity = 1 }: {
  x: number; y: number; w: number; h: number; rotation: number;
  image: Extract<ResolvedImage, { missing: false }>;
  /** Unique id for the clip path (SVG ids are document-global). */
  clipId: string;
  rx?: number;
  opacity?: number;
}) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const odd = rotation === 90 || rotation === 270;
  const W = odd ? h : w; // unrotated enclosure width
  const D = odd ? w : h; // unrotated enclosure depth
  const qOdd = image.rotation_quarter % 2 === 1;
  const pw = qOdd ? D : W; // picture box before its own quarter turn
  const ph = qOdd ? W : D;
  const c = image.crop;
  const vb = `${c.x * image.width} ${c.y * image.height} ${Math.max(1e-6, c.w * image.width)} ${Math.max(1e-6, c.h * image.height)}`;
  return (
    <g transform={`rotate(${rotation} ${cx} ${cy})`} opacity={opacity} data-testid="device-image" data-asset={image.asset_id} data-fit={image.fit} data-q={image.rotation_quarter}>
      <clipPath id={clipId}>
        <rect x={cx - W / 2} y={cy - D / 2} width={W} height={D} rx={rx} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <g transform={`rotate(${image.rotation_quarter * 90} ${cx} ${cy})`}>
          <svg x={cx - pw / 2} y={cy - ph / 2} width={pw} height={ph} viewBox={vb} preserveAspectRatio={image.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}>
            <image href={image.url} x={0} y={0} width={image.width} height={image.height} preserveAspectRatio="none" />
          </svg>
        </g>
      </g>
    </g>
  );
}
