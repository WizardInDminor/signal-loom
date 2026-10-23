"use client";

import { useState } from "react";
import { Badge, Panel } from "@/components/ui/basics";
import type { Mc8Bank, Mc8Message, Mc8Preset, Mc8Report } from "@/lib/morningstar";
import { AnomalyList, EvidenceTag, KeyValue, RawToggle, StatusBadge, UnknownKeysTable } from "./bits";

const PAGE1 = "ABCDEFGH".split("");
const PAGE2 = "IJKLMNOP".split("");
const AUX = "QRSTUV".split("");

export function MessageTable({ messages, testId }: { messages: Mc8Message[]; testId?: string }) {
  const [raw, setRaw] = useState<number | null>(null);
  const shown = messages.filter((m) => m.status !== "empty" || m.anomalies.length || m.unknown_keys.length);
  if (!shown.length) return <p className="text-xs text-neutral-500">All {messages.length} message slots are empty.</p>;
  return (
    <table className="w-full text-xs" data-testid={testId}>
      <thead>
        <tr className="text-left text-neutral-500"><th>Slot</th><th>Status</th><th>Type</th><th>Message</th><th>Action</th><th>Toggle pos.</th><th>Bytes d1–d4</th><th></th></tr>
      </thead>
      <tbody>
        {shown.map((m) => (
          <tr key={m.slot} className="border-t border-line align-top" data-testid={`msg-slot-${m.slot}`}>
            <td>{m.slot}</td>
            <td><StatusBadge status={m.status} /></td>
            <td>
              {m.type_name ?? "—"}
              {m.status === "third_party" && m.type_enum && <span className="block text-[10px] text-neutral-500 font-mono">{m.type_enum}</span>}
              {m.type_code != null && m.status !== "known" && <span className="block text-[10px] text-neutral-500">code {m.type_code}</span>}
            </td>
            <td className="font-mono">{m.summary}</td>
            <td>
              {m.action_label ?? (m.action_code != null ? `code ${m.action_code}` : "—")}
              {m.action_evidence && m.action_evidence !== "documented" && m.status !== "empty" && <span className="block"><EvidenceTag evidence={m.action_evidence} /></span>}
            </td>
            <td>{m.toggle_position === "pos1" ? "Pos 1" : m.toggle_position === "pos2" ? "Pos 2" : m.toggle_position === "both" ? "Both" : m.toggle_position_code != null ? `code ${m.toggle_position_code}` : "—"}</td>
            <td className="font-mono">{m.data ? m.data.join(" ") : "—"}{typeof m.mi === "string" && m.mi !== "" && <span className="block text-[10px]">mi=“{m.mi}”</span>}</td>
            <td>
              <AnomalyList items={[...m.anomalies, ...m.unknown_keys.map((k) => `unknown key “${k}” preserved`)]} />
              {m.raw && <RawToggle value={m.raw} open={raw === m.slot} onToggle={() => setRaw(raw === m.slot ? null : m.slot)} />}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PresetCell({ p, selected, onSelect }: { p: Mc8Preset; selected: boolean; onSelect: () => void }) {
  const c = p.message_counts;
  const tone = c.unknown ? "border-red-300" : c.third_party ? "border-amber-300" : p.used ? "border-neutral-400" : "border-line";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Preset ${p.position}${p.short_name ? ` ${p.short_name}` : ", empty"}`}
      data-testid={`mc8-preset-${p.position}`}
      className={`flex flex-col items-start rounded border px-2 py-1 text-left text-xs min-w-[84px] ${tone} ${selected ? "bg-accent text-white" : p.used ? "bg-panel hover:bg-neutral-100" : "bg-neutral-50 text-neutral-400"}`}
    >
      <span className="font-semibold">{p.position}</span>
      <span className="font-mono truncate max-w-[80px]">{p.short_name || "—"}</span>
      <span className={`text-[10px] ${selected ? "text-white/80" : "text-neutral-500"}`}>
        {p.active_messages} msg{p.toggle_mode ? " · toggle" : ""}{c.third_party ? ` · ${c.third_party} 3rd` : ""}{c.unknown ? ` · ${c.unknown} ?` : ""}
      </span>
    </button>
  );
}

export function PresetDetail({ p }: { p: Mc8Preset }) {
  return (
    <div className="flex flex-col gap-2" data-testid="mc8-preset-detail">
      <KeyValue
        rows={[
          { k: "Position", v: `${p.position}${p.is_exp ? " (expression)" : PAGE2.includes(p.position) ? " (page 2)" : AUX.includes(p.position) ? " (external aux switch only)" : " (page 1)"}` },
          { k: "Short name", v: <code>{p.short_name || "—"}</code> },
          { k: "Toggle name", v: <code>{p.toggle_name || "—"}</code> },
          { k: "Long name", v: <code>{p.long_name || "—"}</code> },
          { k: "Flags", v: <span>{p.toggle_mode ? <Badge>preset toggle</Badge> : null} {p.blink ? <Badge>blink</Badge> : null} {p.message_scroll ? <Badge>message scroll</Badge> : null} {!p.toggle_mode && !p.blink && !p.message_scroll ? "none" : null}</span> },
          { k: "Toggle group", v: String(p.toggle_group ?? "—") },
          { k: "Messages", v: `${p.active_messages} of ${p.messages.length} slots used · ${p.message_counts.known} known · ${p.message_counts.third_party} third-party · ${p.message_counts.unknown} unknown` },
        ]}
      />
      <AnomalyList items={[...p.anomalies, ...p.unknown_keys.map((k) => `unknown key “${k}” on this preset is preserved verbatim`)]} />
      <MessageTable messages={p.messages} testId="mc8-preset-messages" />
    </div>
  );
}

export function BankView({ bank }: { bank: Mc8Bank }) {
  const [sel, setSel] = useState<string>(() => bank.presets.find((p) => p.used)?.position ?? "A");
  const all = [...bank.presets, ...bank.exp_presets];
  const current = all.find((p) => p.position === sel) ?? all[0];
  const grid = (positions: string[], label: string) => (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-neutral-500">{label}</span>
      <div className="flex flex-wrap gap-1">
        {positions.map((pos) => {
          const p = bank.presets.find((x) => x.position === pos);
          return p ? <PresetCell key={pos} p={p} selected={sel === pos} onSelect={() => setSel(pos)} /> : null;
        })}
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      <KeyValue
        rows={[
          { k: "Bank", v: <span>{bank.number} <code>{bank.name || "(unnamed)"}</code></span> },
          { k: "Clear toggles", v: bank.clear_toggle ? "on" : "off" },
          { k: "Used", v: `${bank.presets_used} switch presets · ${bank.exp_used} expression presets · ${bank.bank_messages.filter((m) => m.status !== "empty").length} bank messages` },
        ]}
      />
      <AnomalyList items={[...bank.anomalies, ...bank.unknown_keys.map((k) => `unknown key “${k}” on this bank is preserved verbatim`)]} />
      {grid(PAGE1, "Page 1 — footswitches A–H")}
      {grid(PAGE2, "Page 2 — footswitches I–P")}
      {grid(AUX, "Q–V — only reachable through external aux switches")}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-neutral-500">Expression presets</span>
        <div className="flex flex-wrap gap-1">
          {bank.exp_presets.map((p) => <PresetCell key={p.position} p={p} selected={sel === p.position} onSelect={() => setSel(p.position)} />)}
        </div>
      </div>
      {current && <Panel title={`Preset ${current.position}${current.short_name ? ` — ${current.short_name}` : ""}`}><PresetDetail p={current} /></Panel>}
      <Panel title="Bank messages (On Enter / On Exit)">
        <p className="text-[11px] text-neutral-500 mb-1">{bank.bank_message_note}</p>
        <MessageTable messages={bank.bank_messages} testId="mc8-bank-messages" />
      </Panel>
    </div>
  );
}

export function ControllerSettingsView({ cs }: { cs: NonNullable<Mc8Report["interpreted"]>["controller_settings"] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!cs) return null;
  return (
    <div className="flex flex-col gap-3 text-xs" data-testid="mc8-controller-settings">
      <p className="text-neutral-600">Global controller settings travel only in an all-banks backup. Names come from the file itself; the evidence tag says how far the meaning is established. Everything is preserved as written.</p>
      <table className="w-full">
        <thead><tr className="text-left text-neutral-500"><th>Setting</th><th>Value</th><th>Evidence</th><th>Note</th></tr></thead>
        <tbody>
          {cs.general.map((g) => (
            <tr key={g.key} className="border-t border-line"><td><code>{g.key}</code></td><td className="font-mono">{JSON.stringify(g.value)}</td><td><EvidenceTag evidence={g.evidence} /></td><td className="text-neutral-600">{g.note ?? (g.evidence === "named" ? "name is self-describing; semantics and units unverified" : "")}</td></tr>
          ))}
        </tbody>
      </table>
      {cs.midi_channels.length > 0 && (
        <div>
          <h4 className="font-semibold">MIDI channel names <EvidenceTag evidence="documented" /></h4>
          <div className="flex flex-wrap gap-1 mt-1">
            {cs.midi_channels.map((c) => <Badge key={c.channel}>ch {c.channel}{c.name ? `: ${c.name}` : ""}</Badge>)}
          </div>
        </div>
      )}
      {cs.bank_arrangement && (
        <div>
          <h4 className="font-semibold">Bank arrangement <EvidenceTag evidence="named" /></h4>
          <p className="text-neutral-600">active: {String(cs.bank_arrangement.is_active)} · banks active: {String(cs.bank_arrangement.num_banks_active)} · {cs.bank_arrangement.banks.filter((b) => b.name).map((b) => `${b.bank + 1} ${b.name}`).join(", ") || "no named banks"}</p>
        </div>
      )}
      <div>
        <h4 className="font-semibold">Sections</h4>
        <table className="w-full mt-1">
          <thead><tr className="text-left text-neutral-500"><th>Section</th><th>Type</th><th>Items</th><th>Interpreted</th><th></th></tr></thead>
          <tbody>
            {cs.sections.map((s) => (
              <tr key={s.key} className="border-t border-line align-top">
                <td><code>{s.key}</code></td><td>{s.type ?? "—"}</td><td>{s.count ?? "—"}</td>
                <td>{s.interpreted ? <Badge tone="ok">yes</Badge> : <Badge tone="warn">preserved only</Badge>}</td>
                <td><RawToggle value={s.raw} open={open === s.key} onToggle={() => setOpen(open === s.key ? null : s.key)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AnomalyList items={cs.anomalies} />
    </div>
  );
}

export function Mc8Inspector({ report, bankIndex, onBankIndex }: { report: Mc8Report; bankIndex: number; onBankIndex: (i: number) => void }) {
  const [tab, setTab] = useState<"banks" | "controller" | "unknown">("banks");
  const interp = report.interpreted;
  if (!interp) return null;
  const bank = interp.banks[bankIndex] ?? interp.banks[0];
  const cov = report.coverage!;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-xs items-center" data-testid="mc8-coverage">
        <Badge tone="ok">{cov.messages.known} known messages</Badge>
        <Badge tone={cov.messages.third_party ? "warn" : "neutral"}>{cov.messages.third_party} third-party-named</Badge>
        <Badge tone={cov.messages.unknown ? "bad" : "neutral"}>{cov.messages.unknown} unknown</Badge>
        <Badge>{cov.messages.empty} empty slots</Badge>
        <Badge tone={cov.anomalies ? "warn" : "ok"}>{cov.anomalies} anomalies</Badge>
        <Badge tone={cov.lossless_reserialization ? "ok" : "warn"}>{cov.lossless_reserialization ? "re-serializes byte-for-byte" : "re-serialization differs from file"}</Badge>
      </div>
      <div role="tablist" aria-label="MC8 views" className="flex gap-1 border-b border-line">
        {(["banks", "controller", "unknown"] as const).map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={`px-3 py-1 text-xs rounded-t ${tab === t ? "bg-accent text-white" : "hover:bg-neutral-100"}`}>
            {t === "banks" ? `Banks (${interp.banks.length})` : t === "controller" ? "Controller settings" : `Unknown data (${report.native.unknown_keys.length})`}
          </button>
        ))}
      </div>
      {tab === "banks" && (
        <div className="grid lg:grid-cols-[220px_1fr] gap-3 items-start">
          <div className="flex flex-col gap-1 max-h-[70vh] overflow-auto" role="listbox" aria-label="Banks">
            {interp.banks.map((b, i) => (
              <button key={b.index} type="button" role="option" aria-selected={i === bankIndex} onClick={() => onBankIndex(i)} data-testid={`mc8-bank-${b.number}`}
                className={`text-left text-xs rounded border px-2 py-1 ${i === bankIndex ? "bg-accent text-white border-accent" : b.used ? "bg-panel border-line hover:bg-neutral-100" : "bg-neutral-50 border-line text-neutral-400"}`}>
                <span className="font-semibold">Bank {b.number}</span> <span className="font-mono">{b.name || "—"}</span>
                <span className={`block text-[10px] ${i === bankIndex ? "text-white/80" : "text-neutral-500"}`}>{b.presets_used} presets · {b.message_counts.known + b.message_counts.third_party + b.message_counts.unknown} msgs{b.message_counts.third_party || b.message_counts.unknown ? ` · ${b.message_counts.third_party + b.message_counts.unknown} not modelled` : ""}</span>
              </button>
            ))}
          </div>
          {bank && <BankView key={bank.index} bank={bank} />}
        </div>
      )}
      {tab === "controller" && (interp.controller_settings ? <ControllerSettingsView cs={interp.controller_settings} /> : <p className="text-xs text-neutral-500">This is a single-bank file; global controller settings are only part of an all-banks backup (Controller Backup → All Banks in the editor).</p>)}
      {tab === "unknown" && <UnknownKeysTable keys={report.native.unknown_keys} />}
    </div>
  );
}
