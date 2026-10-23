"use client";

import type { Diagnostic, Severity, SignalKind } from "@/lib/types";
import type { ReactNode } from "react";

export const KIND_COLOR: Record<SignalKind, string> = {
  audio: "var(--audio)",
  midi: "var(--midi)",
  expression: "var(--expression)",
  power: "var(--power)",
  usb: "var(--usb)",
};

export function Button({ children, variant = "default", className = "", ref, ...rest }: { children: ReactNode; variant?: "default" | "primary" | "danger" | "ghost"; ref?: React.Ref<HTMLButtonElement> } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = "inline-flex items-center gap-1 rounded px-2.5 py-1 text-sm border transition disabled:opacity-50 disabled:cursor-not-allowed";
  const v = {
    default: "bg-panel border-line hover:bg-neutral-100",
    primary: "bg-accent text-white border-accent hover:opacity-90",
    danger: "bg-panel border-red-300 text-red-700 hover:bg-red-50",
    ghost: "border-transparent hover:bg-neutral-100",
  }[variant];
  return (
    <button ref={ref} type="button" className={`${base} ${v} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
      <span>{label}</span>
      {children}
      {hint && <span className="text-[11px] text-neutral-400">{hint}</span>}
    </label>
  );
}

export function Panel({ title, children, className = "", actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`bg-panel border border-line rounded-md ${className}`}>
      {title && (
        <header className="flex items-center justify-between px-3 py-1.5 border-b border-line">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

const SEV_STYLE: Record<Severity, string> = {
  error: "bg-red-50 border-red-200 text-red-800",
  warning: "bg-amber-50 border-amber-200 text-amber-800",
  info: "bg-blue-50 border-blue-200 text-blue-800",
};

export function DiagnosticList({ items, empty = "No issues.", onFocus }: { items: Diagnostic[]; empty?: string; onFocus?: (d: Diagnostic) => void }) {
  if (!items.length) return <p className="text-xs text-neutral-500">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1" aria-label="Diagnostics">
      {items.map((d, i) => (
        <li key={i} className={`text-xs border rounded px-2 py-1 ${SEV_STYLE[d.severity]}`}>
          <button type="button" className="text-left w-full" onClick={() => onFocus?.(d)} disabled={!onFocus}>
            <span className="font-semibold uppercase mr-1">{d.severity}</span>
            <code className="opacity-70 mr-1">{d.code}</code>
            {d.message}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "ok" | "bad" }) {
  const t = { neutral: "bg-neutral-100 text-neutral-700", warn: "bg-amber-100 text-amber-800", ok: "bg-green-100 text-green-800", bad: "bg-red-100 text-red-800" }[tone];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] ${t}`}>{children}</span>;
}

export function EvidenceBadge({ evidence }: { evidence: string }) {
  const tone = evidence === "documented" ? "ok" : evidence === "unknown" ? "bad" : "warn";
  return <Badge tone={tone}>{evidence.replace("_", " ")}</Badge>;
}

export function ErrorBanner({ message, onClose }: { message: string | null; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" data-testid="error-banner" className="bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2 flex items-center gap-2">
      <span className="flex-1">{message}</span>
      {onClose && (
        <Button variant="ghost" onClick={onClose} aria-label="Dismiss error">
          ×
        </Button>
      )}
    </div>
  );
}

export function confirmDialog(message: string): boolean {
  return typeof window !== "undefined" ? window.confirm(message) : false;
}
