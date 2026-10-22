"use client";

import { useState } from "react";
import { useLiveStore } from "@/store/liveStore";
import { useRigStore } from "@/store/rigStore";
import type { AppliedCommand, CcValue, LivePanel, MidiCommand } from "@/lib/types";
import { applyCc, applyPc, fingerprint } from "@/lib/commands";
import { Badge, Button } from "@/components/ui/basics";

/**
 * Generated controls per reachable pedal (from the profile's documented PC range, bypass CC,
 * CC map and named commands). Three state columns are kept apart: what Signal Loom last sent,
 * what was observed on an input (most pedals reply with nothing), and the simulated pedal (virtual
 * mode only). Changing a control never rewrites the scene: "Capture to scene" is a deliberate step
 * that writes ordinary, undoable, revisioned scene data through the rig store.
 */
export function DevicePanels() {
  const { panels, status } = useLiveStore();
  const { rig } = useRigStore();
  if (!rig || !panels) return null;
  const armed = !!status?.armed && status.connected_rig_id === rig.id;
  const shown = panels.panels.filter((p) => p.category !== "controller");
  return (
    <div className="grid md:grid-cols-2 gap-2 text-xs">
      {shown.map((p) => <Panel key={p.instance_id} panel={p} armed={armed} />)}
      {!shown.length && <p className="text-neutral-500">No pedal with MIDI on this rig.</p>}
    </div>
  );
}

const sentCommands: Record<string, AppliedCommand> = {}; // `${instance}:${cc}:${value}` → snapshot of the named command that sent it

/**
 * Turn a documented ``value_semantics`` text into a control shape. Only exact, common phrasings are
 * recognised ("0-63 bypass, 64-127 engage", "0 = bypass, 1-127 = engage", "any value toggles",
 * "0-3 = Banks 1-4"); anything else stays a 0–127 slider with the text shown beside it. Nothing is
 * invented: the buttons send the documented boundary values, nothing in between.
 */
type CcControl =
  | { kind: "slider"; max: number }
  | { kind: "pair"; off: number; on: number; offLabel: string; onLabel: string }
  | { kind: "toggle" };
function controlFor(semantics: string | null | undefined): CcControl {
  const t = (semantics ?? "").toLowerCase();
  if (/any value toggles/.test(t)) return { kind: "toggle" };
  const pair = /(\d+)(?:-(\d+))?\s*=?\s*bypass,?\s*(\d+)(?:-(\d+))?\s*=?\s*engage/.exec(t);
  if (pair) return { kind: "pair", off: Number(pair[1]), on: Number(pair[4] ?? pair[3]), offLabel: "Bypass", onLabel: "Engage" };
  const banks = /^0-(\d+)\s*=\s*banks?/.exec(t);
  if (banks) return { kind: "slider", max: Number(banks[1]) };
  return { kind: "slider", max: 127 };
}

function Panel({ panel: p, armed }: { panel: LivePanel; armed: boolean }) {
  const { send } = useLiveStore();
  const { rig, update, selectedSceneId, profiles } = useRigStore();
  const [pc, setPc] = useState<number>(p.last_sent?.program ?? p.controls.program?.min ?? 0);
  const [ccVals, setCcVals] = useState<Record<number, number>>({});
  const [capturing, setCapturing] = useState(false);
  const reachable = p.coverage.pc.status !== "unreachable" || p.coverage.cc.status !== "unreachable";
  const canSend = armed && reachable;
  const inst = rig?.instances.find((i) => i.id === p.instance_id);
  const profile = inst ? profiles[inst.profile_id] : undefined;
  const scene = rig?.scenes.find((s) => s.id === selectedSceneId) ?? rig?.scenes[0];
  const ccValue = (cc: number, fallback = 64) => ccVals[cc] ?? p.last_sent?.cc[String(cc)]?.value ?? fallback;
  const sendCc = (cc: number, value: number, label: string, deterministic: boolean | null = true, coalesce = false, cmd?: MidiCommand) => {
    if (cmd) {
      try { const cv = applyCc(cmd, cmd.value_mode === "fixed" ? undefined : value); if (cv.command) sentCommands[`${p.instance_id}:${cc}:${value}`] = cv.command; } catch { /* a value outside the command's choices: sent as a plain CC */ }
    }
    void send({ instance_id: p.instance_id, type: "cc", number: cc, value, label, deterministic, coalesce });
  };
  const sendPc = (n: number, cmd?: MidiCommand) => {
    if (cmd) { const ps = applyPc(cmd); if (ps.command) sentCommands[`${p.instance_id}:pc:${n}`] = ps.command; }
    void send({ instance_id: p.instance_id, type: "pc", number: n, label: `Live panel: PC ${n} on ${p.label}` });
  };
  const bypassState = (ls: LivePanel["last_sent"]) => {
    const b = p.controls.bypass;
    if (!b || !ls) return null;
    const v = ls.cc[String(b.cc)]?.value;
    if (v == null) return null;
    if (v === b.off_value) return false;
    if (v === b.on_value) return true;
    return b.off_value < b.on_value ? v > b.off_value : v < b.off_value;
  };

  /** What capture would write, computed from "last sent" only (never from simulated or observed state). */
  const captureChanges = () => {
    const ls = p.last_sent;
    if (!ls || !scene) return null;
    const current = scene.device_states.find((d) => d.instance_id === p.instance_id);
    const changes: string[] = [];
    const next = { program: current?.program ?? null, enabled: current?.enabled ?? null, cc_values: structuredClone(current?.cc_values ?? []) as CcValue[] };
    if (ls.program != null) {
      const same = current?.program && current.program.pc === ls.program && (current.program.bank_msb ?? null) === (ls.bank_msb ?? current.program.bank_msb ?? null);
      if (!same) {
        const cmd = sentCommands[`${p.instance_id}:pc:${ls.program}`];
        next.program = { pc: ls.program, bank_msb: ls.bank_msb ?? current?.program?.bank_msb ?? null, bank_lsb: ls.bank_lsb ?? current?.program?.bank_lsb ?? null, command: cmd ?? null };
        changes.push(`program → PC ${ls.program}${cmd ? ` (“${cmd.name}”)` : ""}`);
      }
    }
    const byp = bypassState(ls);
    if (byp != null && byp !== (current?.enabled ?? null)) { next.enabled = byp; changes.push(`state → ${byp ? "engaged" : "bypassed"}`); }
    for (const [ccStr, rec] of Object.entries(ls.cc)) {
      const cc = Number(ccStr);
      if (p.controls.bypass && cc === p.controls.bypass.cc) continue;
      if (cc === 0 || cc === 32) continue; // bank select travels with the program
      const existing = next.cc_values.find((c) => c.cc === cc);
      if (existing && existing.value === rec.value) continue;
      const cmd = sentCommands[`${p.instance_id}:${cc}:${rec.value}`];
      const name = p.controls.cc.find((c) => c.cc === cc)?.name ?? null;
      const row: CcValue = { cc, value: rec.value, label: cmd?.name ?? name ?? existing?.label ?? null, command: cmd ?? null };
      if (existing) Object.assign(existing, row); else next.cc_values.push(row);
      changes.push(`CC ${cc} → ${rec.value}${cmd ? ` (“${cmd.name}”)` : name ? ` (${name})` : ""}`);
    }
    return { changes, next };
  };
  const plan = capturing ? captureChanges() : null;
  const capture = () => {
    const c = captureChanges();
    if (!c || !scene) return;
    update((r) => {
      const s = r.scenes.find((x) => x.id === scene.id);
      if (!s) return;
      let d = s.device_states.find((x) => x.instance_id === p.instance_id);
      if (!d) { d = { instance_id: p.instance_id, program: null, enabled: null, cc_values: [] }; s.device_states.push(d); }
      d.program = c.next.program; d.enabled = c.next.enabled; d.cc_values = c.next.cc_values;
    });
    setCapturing(false);
  };
  const liveCmd = (a: AppliedCommand | null | undefined) => a && profile?.midi.commands?.find((c) => c.id === a.command_id && fingerprint(c) === a.definition);

  return (
    <section className="border border-line rounded-md p-2 flex flex-col gap-2" data-testid={`live-panel-${p.instance_id}`} aria-label={`Live panel ${p.label}`}>
      <header className="flex items-center gap-2">
        <b>{p.label}</b><span className="text-neutral-500">{p.profile} · ch {p.channel ?? "?"}</span>
        <Badge tone={p.coverage.pc.status === "supported" ? "ok" : p.coverage.pc.status === "unverified" ? "warn" : "bad"}>PC {p.coverage.pc.status}</Badge>
        <Badge tone={p.coverage.cc.status === "supported" ? "ok" : p.coverage.cc.status === "unverified" ? "warn" : "bad"}>CC {p.coverage.cc.status}</Badge>
      </header>
      {!reachable && <p className="text-neutral-500">Unreachable from any bound endpoint; see Coverage for the smallest change.</p>}
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-center max-h-[360px] overflow-auto pr-1">
        {p.controls.program && (
          <>
            <div className="flex items-center gap-1">
              <span className="w-24">Program</span>
              <input aria-label={`${p.label} PC`} type="number" min={p.controls.program.min} max={p.controls.program.max} className="w-16" value={pc} onChange={(e) => setPc(Number(e.target.value))} />
              <span className="text-neutral-400">{p.controls.program.display_numbering === "one_based" ? `shown as ${pc + 1}` : "zero-based"}{p.controls.program.supported === null ? " · PC support unverified" : ""}</span>
            </div>
            <Button disabled={!canSend} onClick={() => sendPc(pc)} data-testid={`live-send-pc-${p.instance_id}`}>Send PC</Button>
          </>
        )}
        {p.controls.bypass && (
          <>
            <div className="flex items-center gap-1"><span className="w-24">Bypass</span><span className="text-neutral-400">CC {p.controls.bypass.cc}: {p.controls.bypass.on_value} engage / {p.controls.bypass.off_value} bypass{p.controls.bypass.deterministic === false ? " (toggle!)" : ""} · {p.controls.bypass.evidence}</span></div>
            <div className="flex gap-1">
              <Button disabled={!canSend} onClick={() => sendCc(p.controls.bypass!.cc, p.controls.bypass!.on_value, `Engage ${p.label}`, p.controls.bypass!.deterministic)} data-testid={`live-engage-${p.instance_id}`}>Engage</Button>
              <Button disabled={!canSend} onClick={() => sendCc(p.controls.bypass!.cc, p.controls.bypass!.off_value, `Bypass ${p.label}`, p.controls.bypass!.deterministic)} data-testid={`live-bypass-${p.instance_id}`}>Bypass</Button>
            </div>
          </>
        )}
        {p.controls.cc.map((c) => {
          const ctl = controlFor(c.value_semantics);
          const title = `${c.name}${c.value_semantics ? ` — ${c.value_semantics}` : ""} (${c.evidence})`;
          const label = (
            <div className="flex flex-col min-w-0">
              <span className="truncate" title={title}><b>CC {c.cc}</b> · {c.name}</span>
              {c.value_semantics && <span className="text-[10px] text-neutral-400 truncate" title={c.value_semantics}>{c.value_semantics}</span>}
            </div>
          );
          if (ctl.kind === "pair") {
            return (
              <div key={c.cc} className="contents">
                {label}
                <div className="flex gap-1">
                  <Button disabled={!canSend} onClick={() => sendCc(c.cc, ctl.on, `${c.name}: ${ctl.onLabel}`)} data-testid={`live-send-cc-${p.instance_id}-${c.cc}-on`} title={`CC ${c.cc} = ${ctl.on}`}>{ctl.onLabel} ({ctl.on})</Button>
                  <Button disabled={!canSend} onClick={() => sendCc(c.cc, ctl.off, `${c.name}: ${ctl.offLabel}`)} data-testid={`live-send-cc-${p.instance_id}-${c.cc}-off`} title={`CC ${c.cc} = ${ctl.off}`}>{ctl.offLabel} ({ctl.off})</Button>
                </div>
              </div>
            );
          }
          if (ctl.kind === "toggle") {
            return (
              <div key={c.cc} className="contents">
                {label}
                <Button disabled={!canSend} onClick={() => sendCc(c.cc, 127, `${c.name} (toggle)`, false)} data-testid={`live-send-cc-${p.instance_id}-${c.cc}`} title={`CC ${c.cc} = 127 — result depends on the current state; asks for confirmation`}>Toggle (confirm)</Button>
              </div>
            );
          }
          return (
            <div key={c.cc} className="contents">
              <div className="flex items-center gap-1 min-w-0">
                {label}
                <input aria-label={`${p.label} CC ${c.cc}`} type="range" min={0} max={ctl.max} value={Math.min(ctl.max, ccValue(c.cc, ctl.max < 64 ? 0 : 64))} disabled={!canSend} className="flex-1 min-w-[60px]"
                  onChange={(e) => { const v = Number(e.target.value); setCcVals((s) => ({ ...s, [c.cc]: v })); sendCc(c.cc, v, `${c.name} (${p.label})`, true, true); }} />
                <input aria-label={`${p.label} CC ${c.cc} value`} type="number" min={0} max={ctl.max} className="w-14" value={Math.min(ctl.max, ccValue(c.cc, ctl.max < 64 ? 0 : 64))} onChange={(e) => setCcVals((s) => ({ ...s, [c.cc]: Number(e.target.value) }))} />
              </div>
              <Button disabled={!canSend} onClick={() => sendCc(c.cc, Math.min(ctl.max, ccValue(c.cc, ctl.max < 64 ? 0 : 64)), `${c.name} (${p.label})`)} data-testid={`live-send-cc-${p.instance_id}-${c.cc}`} title={title}>Send</Button>
            </div>
          );
        })}
      </div>
      {p.controls.commands.length > 0 && (
        <div>
          <div className="text-neutral-500 mb-0.5">Named commands</div>
          <div className="flex flex-wrap gap-1">
            {p.controls.commands.map((cmd) => {
              if (cmd.kind === "pc") return <Button key={cmd.id} disabled={!canSend} onClick={() => sendPc(cmd.pc ?? 0, cmd)} title={`PC ${cmd.pc}`}>{cmd.favorite ? "★ " : ""}{cmd.name}</Button>;
              if (cmd.value_mode === "choice") return cmd.choices.map((ch) => <Button key={`${cmd.id}-${ch.value}`} disabled={!canSend} onClick={() => sendCc(cmd.cc ?? 0, ch.value, `${cmd.name}: ${ch.label}`, cmd.deterministic ?? null, false, cmd)} title={`CC ${cmd.cc} = ${ch.value}`}>{cmd.favorite ? "★ " : ""}{cmd.name}: {ch.label}</Button>);
              if (cmd.value_mode === "fixed") return <Button key={cmd.id} disabled={!canSend} onClick={() => sendCc(cmd.cc ?? 0, cmd.value ?? 0, cmd.name, cmd.deterministic ?? null, false, cmd)} title={`CC ${cmd.cc} = ${cmd.value}`}>{cmd.favorite ? "★ " : ""}{cmd.name}</Button>;
              return <Button key={cmd.id} disabled={!canSend} onClick={() => sendCc(cmd.cc ?? 0, ccValue(cmd.cc ?? 0), cmd.name, cmd.deterministic ?? null, false, cmd)} title={`CC ${cmd.cc} = current slider value`}>{cmd.favorite ? "★ " : ""}{cmd.name} (slider value)</Button>;
            })}
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-1 border-t border-line pt-1">
        <StateCol title="Last sent by Signal Loom" testid={`live-last-${p.instance_id}`} empty="nothing sent" body={p.last_sent ? [p.last_sent.program != null ? `PC ${p.last_sent.program}${p.last_sent.bank_msb != null ? ` (bank ${p.last_sent.bank_msb})` : ""}` : null, ...Object.entries(p.last_sent.cc).map(([cc, r]) => `CC ${cc} = ${r.value}`)].filter(Boolean) as string[] : []} />
        <StateCol title="Observed reply" testid={`live-observed-${p.instance_id}`} empty="no reply observed (most pedals send none)" body={p.observed ? [p.observed.program != null ? `PC ${p.observed.program}` : null, ...Object.entries(p.observed.cc).map(([cc, v]) => `CC ${cc} = ${v}`), `on ${p.observed.endpoint_name}`].filter(Boolean) as string[] : []} />
        <StateCol title="Simulated pedal" testid={`live-sim-${p.instance_id}`} empty={p.simulated ? "untouched" : "not in simulation"} body={p.simulated && (p.simulated.program != null || p.simulated.bypassed != null || Object.keys(p.simulated.cc).length) ? [p.simulated.program != null ? `PC ${p.simulated.program}` : null, p.simulated.bypassed != null ? (p.simulated.bypassed ? "bypassed" : "engaged") : null, ...Object.entries(p.simulated.cc).map(([cc, v]) => `CC ${cc} = ${v}`)].filter(Boolean) as string[] : []} />
      </div>
      <div className="flex items-center gap-2">
        <Button disabled={!p.last_sent || !scene} onClick={() => setCapturing((v) => !v)} data-testid={`live-capture-${p.instance_id}`} title="Write the last-sent values into the selected scene (undoable, saved like any edit)">Capture to scene “{scene?.name ?? "—"}”…</Button>
        {scene && (() => { const st = scene.device_states.find((d) => d.instance_id === p.instance_id); const stale = st?.cc_values.filter((c) => c.command && !liveCmd(c.command)).length ?? 0; return stale ? <Badge tone="warn">{stale} scene command(s) changed since applied</Badge> : null; })()}
      </div>
      {capturing && plan && (
        <div className="border border-accent rounded p-2 bg-blue-50" data-testid={`live-capture-preview-${p.instance_id}`}>
          <div className="font-semibold mb-1">Capture into “{scene?.name}” — from values Signal Loom sent, not from any measured state</div>
          {plan.changes.length ? <ul className="list-disc pl-4">{plan.changes.map((c) => <li key={c}>{c}</li>)}</ul> : <p>The scene already says exactly this; nothing to write.</p>}
          <div className="flex gap-1 mt-1">
            <Button variant="primary" disabled={!plan.changes.length} onClick={capture} data-testid={`live-capture-confirm-${p.instance_id}`}>Write to scene</Button>
            <Button onClick={() => setCapturing(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}

function StateCol({ title, body, empty, testid }: { title: string; body: string[]; empty: string; testid: string }) {
  return (
    <div data-testid={testid}>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{title}</div>
      {body.length ? <ul className="font-mono text-[11px]">{body.map((b, i) => <li key={i}>{b}</li>)}</ul> : <div className="text-neutral-400">{empty}</div>}
    </div>
  );
}
