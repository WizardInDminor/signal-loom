"use client";

import { useState } from "react";
import { useLiveStore } from "@/store/liveStore";
import type { CoverageRow, CoverageStatus, MessageKind } from "@/lib/types";
import { Badge } from "@/components/ui/basics";

const KIND_LABEL: Record<MessageKind, string> = { pc: "PC", cc: "CC", clock: "Clock", sysex_read: "SysEx (read-only)" };
const TONE: Record<CoverageStatus, "ok" | "warn" | "bad" | "neutral"> = { supported: "ok", unverified: "warn", unsupported: "bad", unreachable: "neutral" };
const WORD: Record<CoverageStatus, string> = { supported: "route documented", unverified: "unverified", unsupported: "unsupported", unreachable: "unreachable" };

/** One row per device × message kind: endpoint, hops, channel, status with evidence and reason. */
export function CoverageTable() {
  const { coverage } = useLiveStore();
  const [open, setOpen] = useState<string | null>(null);
  if (!coverage) return <p className="text-xs text-neutral-500">Coverage not loaded.</p>;
  const rows = coverage.rows;
  const key = (r: CoverageRow) => `${r.instance_id}:${r.kind}`;
  return (
    <div className="text-xs">
      <table className="w-full" data-testid="live-coverage">
        <thead><tr className="text-left text-neutral-500"><th>Device</th><th>Ch</th><th>Kind</th><th>From endpoint</th><th>Status</th><th>Evidence</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={key(r)} className="border-t border-line align-top" data-testid={`coverage-${r.instance_id}-${r.kind}`} data-status={r.status}>
              <td>{r.label}</td>
              <td>{r.channel ?? <Badge tone="bad">unset</Badge>}</td>
              <td>{KIND_LABEL[r.kind]}</td>
              <td>{r.endpoint_name ?? "—"}</td>
              <td><Badge tone={TONE[r.status]}>{WORD[r.status]}</Badge></td>
              <td>{r.evidence ? <Badge tone={r.evidence === "hardware_verified" ? "ok" : r.evidence === "unknown" ? "bad" : "neutral"}>{r.evidence.replace("_", " ")}</Badge> : ""}</td>
              <td><button type="button" className="underline text-neutral-600" onClick={() => setOpen(open === key(r) ? null : key(r))}>{open === key(r) ? "hide" : "why"}</button></td>
            </tr>
          )).flatMap((tr, i) => {
            const r = rows[i];
            if (open !== key(r)) return [tr];
            return [tr, (
              <tr key={`${key(r)}-why`} className="bg-neutral-50">
                <td colSpan={7} className="text-neutral-700">
                  <div>{r.reason}</div>
                  {r.hops.length > 0 && <div className="mt-1"><b>Hops:</b> {r.hops.join("  ·  ")}</div>}
                  {r.prerequisites.length > 0 && <div className="mt-1"><b>Prerequisites to check on the hardware:</b><ul className="list-disc pl-4">{r.prerequisites.map((p) => <li key={p}>{p}</li>)}</ul></div>}
                  {r.suggestions.length > 0 && <div className="mt-1"><b>Smallest plausible change:</b><ul className="list-disc pl-4">{r.suggestions.map((s) => <li key={s}>{s}</li>)}</ul></div>}
                  <div className="mt-1 text-neutral-500">“route documented” means every hop is published by its manufacturer; it is not a measurement on your board. Mark a hop hardware-verified only after your own test (see docs/live-hardware-validation.md).</div>
                </td>
              </tr>
            )];
          })}
          {!rows.length && <tr><td colSpan={7} className="text-neutral-500 py-1">No MIDI-capable device on this rig.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
