"use client";

import { useEffect, useMemo, useState } from "react";
import type { CcDef, CcValue, DeviceInstance, DeviceProfile, DeviceSceneState, MidiCommand, ProgramSelection } from "@/lib/types";
import { applyCc, applyPc, displayedProgram, evidenceWord, orderedCommands, wireSummary } from "@/lib/commands";
import { BEHAVIOR_TONE, behaviorLabel, behaviorOf, isReviewed, rangeText } from "@/lib/knowledge";
import { Badge, Button, EvidenceBadge } from "@/components/ui/basics";

/**
 * "Add MIDI command" for one placed pedal in a scene. Favorites first, search, exact preview with
 * the instance's channel, value choice (documented meanings and a precise number), conflicts with
 * what the scene already says, and a link to the cited manual page. Applying writes an ordinary
 * CC value or program selection (plus snapshot) into the existing desired state.
 */
export function CommandPicker({ instance, profile, state, onApplyCc, onApplyPc, onClose }: {
  instance: DeviceInstance;
  profile: DeviceProfile;
  state: DeviceSceneState | undefined;
  onApplyCc: (cv: CcValue, replaceConflicting: boolean) => void;
  onApplyPc: (p: ProgramSelection) => void;
  onClose: () => void;
}) {
  const commands = useMemo(() => profile.midi.commands ?? [], [profile.midi.commands]);
  const [q, setQ] = useState("");
  const [picked, setPickedState] = useState<MidiCommand | null>(null);
  // Session 6: a reviewed documented control can be applied directly, with a value inside its documented range.
  const [pickedCtl, setPickedCtl] = useState<CcDef | null>(null);
  const [value, setValue] = useState<number | null>(null);
  const channel = instance.midi_channel ?? profile.midi.default_channel ?? null;
  const shown = useMemo(() => orderedCommands(commands, q), [commands, q]);
  const controls = useMemo(() => {
    const t = q.trim().toLowerCase();
    return [...profile.midi.cc_map].filter((c) => isReviewed(c)).filter((c) => !t || `cc ${c.cc} ${c.name} ${behaviorLabel(c)}`.toLowerCase().includes(t)).sort((a, b) => a.cc - b.cc);
  }, [profile.midi.cc_map, q]);
  const proposedCount = profile.midi.cc_map.filter((c) => !isReviewed(c)).length;
  const docs = profile.documents ?? [];
  const files = new Map((profile.document_files ?? []).map((f) => [f.document_id, f]));
  const setPicked = (c: MidiCommand) => {
    setPickedState(c);
    setPickedCtl(null);
    setValue(c.value_mode === "choice" ? (c.choices[0]?.value ?? null) : (c.value ?? null));
  };
  const pickControl = (d: CcDef) => {
    setPickedState(null);
    setPickedCtl(d);
    setValue(d.min_value ?? 0);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const preview = (() => {
    if (pickedCtl) {
      if (value == null || !Number.isInteger(value) || value < 0 || value > 127) return { err: `“${pickedCtl.name}” needs a value between 0 and 127` };
      return { cv: { cc: pickedCtl.cc, value, label: pickedCtl.name, command: null } as CcValue, pc: null as ProgramSelection | null };
    }
    if (!picked) return null;
    try {
      if (picked.kind === "pc") return { pc: applyPc(picked), cv: null as CcValue | null };
      return { cv: applyCc(picked, value), pc: null as ProgramSelection | null };
    } catch (e) { return { err: (e as Error).message }; }
  })();
  const conflicts = preview && "cv" in preview && preview.cv ? (state?.cc_values ?? []).filter((x) => x.cc === preview.cv!.cc && x.value !== preview.cv!.value) : [];
  const bypassClash = preview && "cv" in preview && preview.cv && state?.enabled != null && profile.midi.bypass.method === "cc" && profile.midi.bypass.cc === preview.cv.cc
    ? (state.enabled ? (profile.midi.bypass.on_value ?? 127) : (profile.midi.bypass.off_value ?? 0)) !== preview.cv.value
    : false;
  const sameAlready = preview && "cv" in preview && preview.cv ? (state?.cc_values ?? []).some((x) => x.cc === preview.cv!.cc && x.value === preview.cv!.value) : false;
  const programClash = preview && "pc" in preview && preview.pc && state?.program && (state.program.pc !== preview.pc.pc || (state.program.bank_msb ?? null) !== (preview.pc.bank_msb ?? null));

  const apply = () => {
    if (!preview || "err" in preview) return;
    if (preview.pc) { onApplyPc(preview.pc); onClose(); return; }
    if (preview.cv) { onApplyCc(preview.cv, conflicts.length > 0); onClose(); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`Add MIDI command to ${instance.label}`} className="fixed inset-0 z-40 bg-black/30 flex items-start justify-center p-6 overflow-auto" onClick={onClose}>
      <div className="bg-panel border border-line rounded-md shadow-xl w-full max-w-3xl text-xs" onClick={(e) => e.stopPropagation()} data-testid="command-picker">
        <header className="flex items-center gap-2 px-3 py-2 border-b border-line">
          <h2 className="text-sm font-semibold">Add MIDI command — {instance.label}</h2>
          <span className="text-neutral-500">{profile.manufacturer} {profile.model} · channel {channel ?? "not set"}{instance.midi_channel != null ? " (instance)" : channel != null ? " (profile default)" : ""}</span>
          <Button variant="ghost" className="ml-auto" onClick={onClose} aria-label="Close">✕</Button>
        </header>
        <div className="grid md:grid-cols-[1fr_1fr] gap-0">
          <div className="border-r border-line p-2 flex flex-col gap-1 max-h-[70vh] overflow-auto">
            <input aria-label="Search commands" autoFocus placeholder="Search by name, category, CC/PC…" value={q} onChange={(e) => setQ(e.target.value)} />
            {!commands.length && !controls.length && <p className="text-neutral-500 p-2">This profile has no MIDI commands or documented controls yet. Add them in the Device library (Knowledge Workbench), or type CC values by hand below.</p>}
            {shown.map((c, i) => {
              const firstNonFav = i > 0 && !c.favorite && shown[i - 1].favorite;
              return (
                <div key={c.id}>
                  {i === 0 && c.favorite && <div className="text-[10px] uppercase tracking-wide text-neutral-400 px-1">Favorites</div>}
                  {firstNonFav && <div className="text-[10px] uppercase tracking-wide text-neutral-400 px-1 mt-1">All commands</div>}
                  <button type="button" className={`w-full text-left border rounded px-2 py-1 ${picked?.id === c.id ? "border-accent bg-blue-50" : "border-line hover:bg-neutral-50"}`} onClick={() => setPicked(c)} data-testid={`pick-${c.id}`}>
                    <div className="flex items-center gap-1 flex-wrap">
                      {c.favorite && <span className="text-amber-500">★</span>}
                      <span className="font-medium">{c.name}</span>
                      <code className="bg-neutral-100 rounded px-1 text-[11px]">{wireSummary(c)}</code>
                      {c.intent && <Badge tone={c.intent === "toggle" ? "warn" : "neutral"}>{c.intent}</Badge>}
                      <EvidenceBadge evidence={c.evidence} />
                    </div>
                    {c.description && <div className="text-neutral-500">{c.description}</div>}
                  </button>
                </div>
              );
            })}
            {controls.length > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-wide text-neutral-400 px-1 mt-2">Documented controls{proposedCount ? <span className="normal-case"> · {proposedCount} awaiting review are not offered</span> : null}</div>
                {controls.map((d) => {
                  const b = behaviorOf(d);
                  return (
                    <button key={d.cc} type="button" className={`w-full text-left border rounded px-2 py-1 ${pickedCtl?.cc === d.cc ? "border-accent bg-blue-50" : "border-line hover:bg-neutral-50"}`} onClick={() => pickControl(d)} data-testid={`control-pick-${d.cc}`}>
                      <div className="flex items-center gap-1 flex-wrap">
                        <code className="bg-neutral-100 rounded px-1 text-[11px]">CC {d.cc}</code>
                        <span className="font-medium">{d.name}</span>
                        <Badge tone={b ? BEHAVIOR_TONE[b] : "bad"}>{behaviorLabel(d)}</Badge>
                        {rangeText(d) && <span className="text-neutral-500 font-mono text-[11px]">{rangeText(d)}</span>}
                        <EvidenceBadge evidence={d.evidence} />
                        {d.hardware_status === "verified" && <Badge tone="ok">✓ on my pedal</Badge>}
                      </div>
                      {d.value_semantics && <div className="text-neutral-500">{d.value_semantics}</div>}
                    </button>
                  );
                })}
              </>
            )}
          </div>
          <div className="p-3 flex flex-col gap-2" data-testid="command-detail">
            {pickedCtl ? (
              <>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-sm font-semibold">{pickedCtl.name}</span>
                  <Badge>CC {pickedCtl.cc}</Badge>
                  <Badge tone={behaviorOf(pickedCtl) ? BEHAVIOR_TONE[behaviorOf(pickedCtl)!] : "bad"}>{behaviorLabel(pickedCtl)}</Badge>
                  <EvidenceBadge evidence={pickedCtl.evidence} />
                  {pickedCtl.hardware_status === "verified" && <Badge tone="ok">verified on hardware (your claim)</Badge>}
                </div>
                <p className="text-neutral-600">{pickedCtl.value_semantics ?? "Value meaning not stated."}{pickedCtl.notes ? ` ${pickedCtl.notes}` : ""}</p>
                {pickedCtl.citation && (files.get(pickedCtl.citation.document_id)?.present ? <a className="underline" href={`/catalog/${encodeURIComponent(profile.id)}/workbench?doc=${pickedCtl.citation.document_id}&page=${pickedCtl.citation.page ?? 1}`} target="_blank" rel="noreferrer" data-testid="picker-control-citation">Open {docs.find((x) => x.document_id === pickedCtl.citation!.document_id)?.title ?? "document"}{pickedCtl.citation.page ? ` at PDF page ${pickedCtl.citation.page}` : ""} ↗</a> : <span className="text-amber-800">Cites a document that is not on this computer.</span>)}
                <label className="flex items-center gap-2">Value ({pickedCtl.min_value ?? 0}–{pickedCtl.max_value ?? 127}) <input aria-label="Control value" type="number" min={pickedCtl.min_value ?? 0} max={pickedCtl.max_value ?? 127} className="w-20" value={value ?? ""} onChange={(e) => setValue(e.target.value === "" ? null : Number(e.target.value))} /></label>
                <div className="border border-line rounded p-2 bg-neutral-50" data-testid="command-preview">
                  <div className="text-[10px] uppercase tracking-wide text-neutral-400">Will send</div>
                  {preview && "err" in preview ? <p className="text-red-700">{preview.err}</p> : preview?.cv ? <p className="font-mono">CC {preview.cv.cc} = {preview.cv.value} on channel {channel ?? "?"} → {instance.label}</p> : null}
                </div>
                <ul className="flex flex-col gap-1">
                  {channel == null && <li className="text-red-700">This pedal has no MIDI channel: set it on the device (Board tab) or the profile default. The compiler will refuse until then.</li>}
                  {value != null && (value < (pickedCtl.min_value ?? 0) || value > (pickedCtl.max_value ?? 127)) && <li className="text-amber-800">Outside the documented range {pickedCtl.min_value ?? 0}–{pickedCtl.max_value ?? 127}; the compiler will warn.</li>}
                  {(behaviorOf(pickedCtl) === "toggle") && <li className="text-amber-800">Toggle: the result depends on the device&apos;s prior state; scene recall cannot be guaranteed from an unknown starting state.</li>}
                  {behaviorOf(pickedCtl) == null && <li className="text-neutral-500">The control&apos;s behaviour is not stated.</li>}
                  {conflicts.length > 0 && <li className="text-amber-800" data-testid="command-conflict">This scene already sets CC {conflicts[0].cc} = {conflicts.map((x) => x.value).join(", ")} on this pedal. Applying replaces it.</li>}
                  {sameAlready && <li className="text-neutral-500">The scene already sends exactly this.</li>}
                </ul>
                <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={apply} disabled={!preview || "err" in preview || sameAlready} data-testid="command-apply">Add to scene</Button></div>
              </>
            ) : !picked ? <p className="text-neutral-500">Pick a command or a documented control to see exactly what it will send.</p> : (
              <>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-sm font-semibold">{picked.name}</span>
                  {picked.category && <Badge>{picked.category}</Badge>}
                  <EvidenceBadge evidence={picked.evidence} />
                  {picked.verified_on_hardware && <Badge tone="ok">verified on hardware (your claim)</Badge>}
                </div>
                <p className="text-neutral-600">{evidenceWord(picked)}.{picked.description ? ` ${picked.description}` : ""}</p>
                {picked.citation && (() => {
                  const d = docs.find((x) => x.document_id === picked.citation!.document_id);
                  const present = files.get(picked.citation!.document_id)?.present;
                  return present ? <a className="underline" href={`/documents/${picked.citation!.document_id}${picked.citation!.page ? `?page=${picked.citation!.page}` : ""}`} target="_blank" rel="noreferrer" data-testid="picker-citation">Open {d?.title ?? "document"}{picked.citation!.page ? ` at page ${picked.citation!.page}` : ""} ↗</a> : <span className="text-amber-800">Cites a document that is not on this computer.</span>;
                })()}
                {picked.kind === "cc" && picked.value_mode === "choice" && (
                  <div className="flex flex-col gap-1">
                    <span className="text-neutral-600">Value</span>
                    <div className="flex flex-wrap gap-1">{picked.choices.map((ch) => <button key={ch.value} type="button" className={`border rounded px-2 py-0.5 ${value === ch.value ? "border-accent bg-blue-50" : "border-line"}`} onClick={() => setValue(ch.value)} data-testid={`choice-${ch.value}`}>{ch.label} <span className="text-neutral-500">= {ch.value}</span></button>)}</div>
                  </div>
                )}
                {picked.kind === "cc" && picked.value_mode === "any" && (
                  <label className="flex items-center gap-2">Value (0–127) <input aria-label="Command value" type="number" min={0} max={127} className="w-20" value={value ?? ""} onChange={(e) => setValue(e.target.value === "" ? null : Number(e.target.value))} /></label>
                )}
                {picked.kind === "cc" && picked.value_mode === "choice" && (
                  <label className="flex items-center gap-2 text-neutral-500">or exact number <input aria-label="Exact value" type="number" min={0} max={127} className="w-20" value={value ?? ""} onChange={(e) => setValue(e.target.value === "" ? null : Number(e.target.value))} /> <span className="text-[10px]">(must be one of the documented values)</span></label>
                )}
                <div className="border border-line rounded p-2 bg-neutral-50" data-testid="command-preview">
                  <div className="text-[10px] uppercase tracking-wide text-neutral-400">Will send</div>
                  {preview && "err" in preview ? <p className="text-red-700">{preview.err}</p> : preview?.pc ? (
                    <p className="font-mono">{preview.pc.bank_msb != null ? `CC 0 = ${preview.pc.bank_msb} → ` : ""}{preview.pc.bank_lsb != null ? `CC 32 = ${preview.pc.bank_lsb} → ` : ""}PC {preview.pc.pc} on channel {channel ?? "?"} → {instance.label} <span className="font-sans text-neutral-500">({displayedProgram(preview.pc.pc, profile)})</span></p>
                  ) : preview?.cv ? (
                    <p className="font-mono">CC {preview.cv.cc} = {preview.cv.value} on channel {channel ?? "?"} → {instance.label}{preview.cv.command?.value_label ? <span className="font-sans text-neutral-500"> ({preview.cv.command.value_label})</span> : null}</p>
                  ) : null}
                </div>
                <ul className="flex flex-col gap-1">
                  {channel == null && <li className="text-red-700">This pedal has no MIDI channel: set it on the device (Board tab) or the profile default. The compiler will refuse until then.</li>}
                  {picked.deterministic === false && <li className="text-amber-800">Toggle: the result depends on the device&apos;s prior state; scene recall cannot be guaranteed from an unknown starting state.</li>}
                  {picked.deterministic == null && <li className="text-neutral-500">Whether the result is deterministic is not stated.</li>}
                  {picked.evidence === "unknown" && <li className="text-amber-800">The source of these numbers is unknown; the device&apos;s response is not established.</li>}
                  {picked.kind === "cc" && profile.midi.cc_map.length > 0 && !profile.midi.cc_map.some((d) => d.cc === picked.cc) && <li className="text-neutral-500">CC {picked.cc} is not in the profile&apos;s documented CC map; it is sent as specified.</li>}
                  {picked.kind === "pc" && profile.midi.program_change.supported !== true && <li className="text-amber-800">Program Change support for this device is {profile.midi.program_change.supported === false ? "documented as absent" : "not documented"}.</li>}
                  {conflicts.length > 0 && <li className="text-amber-800" data-testid="command-conflict">This scene already sets CC {conflicts[0].cc} = {conflicts.map((x) => x.value).join(", ")}{conflicts[0].command ? ` (“${conflicts[0].command.name}”)` : ""} on this pedal. Applying replaces it, so the device never gets contradictory instructions.</li>}
                  {bypassClash && <li className="text-amber-800" data-testid="command-bypass-clash">The scene&apos;s state column already says “{state?.enabled ? "engaged" : "bypassed"}” for this pedal via the same CC with a different value; the compiler will report the contradiction until you clear one of them.</li>}
                  {sameAlready && <li className="text-neutral-500">The scene already sends exactly this.</li>}
                  {programClash && <li className="text-amber-800">Replaces the program currently set in this scene (PC {state?.program?.pc}).</li>}
                </ul>
                <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={apply} disabled={!preview || "err" in preview || sameAlready} data-testid="command-apply">Add to scene</Button></div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
