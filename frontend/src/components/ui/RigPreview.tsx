"use client";

import type { RigPreview as Preview } from "@/lib/types";
import { enclosureFill } from "@/lib/boardLayout";

/** A true-scale miniature of a board for the rig library: the board outline and its enclosures. */
export function RigPreview({ preview, className = "" }: { preview: Preview | null | undefined; className?: string }) {
  if (!preview) return <div className={`rounded bg-neutral-100 ${className}`} aria-hidden="true" />;
  const pad = 8;
  const w = preview.width_mm + pad * 2;
  const h = preview.depth_mm + pad * 2;
  const onBoard = preview.devices.filter((d) => !d.off_board);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      role="img"
      aria-label={`Board ${preview.width_mm} by ${preview.depth_mm} millimetres with ${onBoard.length} devices and ${preview.cable_count} cables`}
      data-testid="rig-preview"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x={pad} y={pad} width={preview.width_mm} height={preview.depth_mm} rx={3} fill="#1e293b" stroke="#64748b" strokeWidth={2} />
      {onBoard.map((d, i) => (
        <rect key={i} data-device={d.category} x={pad + d.x_mm} y={pad + d.y_mm} width={d.width_mm} height={d.height_mm} rx={2} fill={enclosureFill(d.category, { placeholder: d.placeholder })} stroke="#0f172a" strokeWidth={1} strokeDasharray={d.placeholder ? "4 3" : undefined} />
      ))}
    </svg>
  );
}
