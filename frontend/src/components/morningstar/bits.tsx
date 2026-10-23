"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/basics";
import type { Evidence, MessageStatus, NativeSummary, UnknownKey } from "@/lib/morningstar";

/** Known / third-party / unknown: the one legend the whole bridge uses. */
export function StatusBadge({ status }: { status: MessageStatus | "same" | "differs" | "only_native" | "only_modeled" | "both_empty" }) {
  const map: Record<string, { tone: "ok" | "warn" | "bad" | "neutral"; label: string }> = {
    empty: { tone: "neutral", label: "empty" },
    known: { tone: "ok", label: "known" },
    third_party: { tone: "warn", label: "third-party name" },
    unknown: { tone: "bad", label: "unknown" },
    same: { tone: "ok", label: "same" },
    differs: { tone: "warn", label: "differs" },
    only_native: { tone: "bad", label: "controller only" },
    only_modeled: { tone: "bad", label: "Signal Loom only" },
    both_empty: { tone: "neutral", label: "empty" },
  };
  const m = map[status] ?? { tone: "neutral" as const, label: status };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function EvidenceTag({ evidence }: { evidence: Evidence | string }) {
  const tone = evidence === "documented" || evidence === "sample" ? "ok" : evidence === "unknown" ? "bad" : "warn";
  const label = evidence === "sample" ? "fixture-confirmed" : evidence.replace("_", " ");
  return <Badge tone={tone}>{label}</Badge>;
}

export function FilePicker({ label, testId, onText, hint }: { label: string; testId: string; onText: (text: string, name: string) => void; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-neutral-600">
      <span className="font-medium text-neutral-800">{label}</span>
      <input
        type="file"
        accept=".json,application/json"
        data-testid={testId}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) onText(await f.text(), f.name);
        }}
      />
      {hint && <span className="text-[11px] text-neutral-400">{hint}</span>}
    </label>
  );
}

export function KeyValue({ rows }: { rows: { k: string; v: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs">
      {rows.map((r) => (
        <div key={r.k} className="contents">
          <dt className="text-neutral-500">{r.k}</dt>
          <dd className="min-w-0 break-words">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function NativeSummaryPanel({ native, fileName }: { native: NativeSummary; fileName: string | null }) {
  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="native-summary">
      <div className="flex flex-wrap items-center gap-2">
        {fileName && <code className="text-[11px]">{fileName}</code>}
        <Badge tone={native.ok ? "ok" : "bad"}>{native.ok ? "native snapshot loaded" : "not loadable"}</Badge>
        {native.dump_type && <Badge>{native.dump_type}</Badge>}
        {native.hash_matches !== null && <Badge tone={native.hash_matches ? "ok" : "warn"}>{native.hash_matches ? "hash OK" : "hash mismatch"}</Badge>}
        {native.byte_exact !== null && <Badge tone={native.byte_exact ? "ok" : "neutral"}>{native.byte_exact ? "byte-exact" : "re-formatted"}</Badge>}
        <Badge tone={native.unknown_keys.length ? "warn" : "ok"}>{native.unknown_keys.length} unknown key{native.unknown_keys.length === 1 ? "" : "s"}</Badge>
      </div>
      <KeyValue
        rows={[
          { k: "Device model", v: native.device_model === 4 ? "4 — Morningstar MC8 (original)" : native.device_model === 7 ? "7 — Morningstar ML10X" : String(native.device_model ?? "?") },
          { k: "Schema", v: String(native.schema_version ?? "?") },
          { k: "Exported", v: native.download_date ?? "?" },
          { k: "Size", v: `${native.size_bytes.toLocaleString()} bytes` },
          { k: "Hash", v: `${native.hash ?? "—"}${native.hash_evidence ? ` · ${native.hash_evidence}` : ""}` },
        ]}
      />
      {native.problems.length > 0 && (
        <ul className="text-red-700 list-disc pl-4" data-testid="native-problems">
          {native.problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      {native.warnings.length > 0 && (
        <ul className="text-amber-800 list-disc pl-4" data-testid="native-warnings">
          {native.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}

export function UnknownKeysTable({ keys }: { keys: UnknownKey[] }) {
  if (!keys.length) return <p className="text-xs text-neutral-500">Every key in this file is one Signal Loom has seen in a real editor export.</p>;
  return (
    <table className="w-full text-xs" data-testid="unknown-keys">
      <thead><tr className="text-left text-neutral-500"><th>Where</th><th>Key</th><th>Value (preserved verbatim)</th></tr></thead>
      <tbody>
        {keys.map((u, i) => (
          <tr key={i} className="border-t border-line align-top"><td><code>{u.path}</code></td><td><code>{u.key}</code></td><td className="font-mono break-all">{u.value_preview}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export function AnomalyList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="text-[11px] text-amber-800 list-disc pl-4">
      {items.map((a, i) => <li key={i}>{a}</li>)}
    </ul>
  );
}

export function RawToggle({ value, open, onToggle }: { value: unknown; open: boolean; onToggle: () => void }) {
  return (
    <div className="text-[11px]">
      <button type="button" className="underline text-neutral-600" onClick={onToggle} aria-expanded={open}>{open ? "Hide raw" : "Show raw"}</button>
      {open && <pre className="mt-1 max-h-64 overflow-auto bg-neutral-50 border border-line rounded p-2 text-[10px]">{JSON.stringify(value, null, 1)}</pre>}
    </div>
  );
}
