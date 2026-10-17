"use client";

import { useState } from "react";
import { useLiveStore } from "@/store/liveStore";
import { useRigStore } from "@/store/rigStore";
import { Badge, Button, DiagnosticList, Field } from "@/components/ui/basics";

/**
 * Pick a scene, see the exact compiled messages as a dry run (nothing sent), then — only when
 * armed — audition them in order with the configured delay. The send log below distinguishes
 * queued / sent / cancelled / failed entries from anything observed on an input.
 */
export function AuditionPanel() {
  const { rig, selectedSceneId, selectScene } = useRigStore();
  const { status, bindings, dryRun, runDryRun, audition, stop, log, lastWarnings } = useLiveStore();
  const [delay, setDelay] = useState<number | null>(null);
  if (!rig || !status) return null;
  const scenes = [...rig.scenes].sort((a, b) => a.order - b.order);
  const scene = rig.scenes.find((s) => s.id === selectedSceneId) ?? scenes[0];
  const connected = status.connected_rig_id === rig.id;
  const armed = status.armed && connected;
  const effectiveDelay = delay ?? bindings?.send_delay_ms ?? 20;
  const shownDry = dryRun && dryRun.scene_id === scene?.id ? dryRun : null;
  const sendLog = [...log].reverse().slice(0, 60);
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Scene">
          <select aria-label="Live scene" value={scene?.id ?? ""} onChange={(e) => selectScene(e.target.value)}>
            {scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Button onClick={() => scene && void runDryRun(scene.id)} disabled={!scene} data-testid="live-dry-run" title="Resolve the compiled messages to endpoints and bytes. Nothing is transmitted.">Dry run (sends nothing)</Button>
        <Field label="Delay (ms)"><input aria-label="Audition delay" type="number" min={0} max={2000} className="w-20" value={effectiveDelay} onChange={(e) => setDelay(Number(e.target.value))} /></Field>
        <Button variant="primary" onClick={() => scene && void audition(scene.id, effectiveDelay)} disabled={!scene || !armed} data-testid="live-audition" title={armed ? "Transmit the compiled messages in order" : "Arm first: nothing is sent while disarmed"}>
          {armed ? "Audition (transmits)" : "Audition — disarmed"}
        </Button>
        <Button variant="danger" onClick={() => void stop()} data-testid="live-stop" title="Cancel every queued message now. Already transmitted messages are not undone.">Stop</Button>
        {status.queue_length > 0 && <Badge tone="warn">{status.queue_length} queued</Badge>}
      </div>
      {lastWarnings.length > 0 && <ul className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">{lastWarnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {shownDry ? (
        <div data-testid="live-dry-run-result">
          <div className="flex items-center gap-2 mb-1"><Badge>dry run</Badge><span className="text-neutral-600">{shownDry.note}</span></div>
          <table className="w-full" data-testid="live-dry-run-table">
            <thead><tr className="text-left text-neutral-500"><th>#</th><th>Message</th><th>Bytes</th><th>Via endpoint</th><th>Route</th><th>Why</th></tr></thead>
            <tbody>
              {shownDry.messages.map((m, k) => (
                <tr key={k} className="border-t border-line align-top" data-route={m.route_status}>
                  <td>{k + 1}</td>
                  <td className="whitespace-nowrap">{m.summary}{!m.deterministic && <Badge tone="warn">toggle</Badge>}</td>
                  <td><code>{m.hex}</code></td>
                  <td>{m.endpoint_name ?? <span className="text-neutral-400">none</span>}</td>
                  <td><Badge tone={m.route_status === "supported" ? "ok" : m.route_status === "unverified" ? "warn" : "bad"}>{m.route_status}</Badge></td>
                  <td className="text-neutral-600">{m.explanation}</td>
                </tr>
              ))}
              {!shownDry.messages.length && <tr><td colSpan={6} className="text-neutral-500">This scene compiles to no MIDI message.</td></tr>}
            </tbody>
          </table>
          {shownDry.manual_steps.length > 0 && <div className="mt-1"><b>Still by hand:</b> {shownDry.manual_steps.join(" · ")}</div>}
          <DiagnosticList items={shownDry.diagnostics} empty="" />
        </div>
      ) : <p className="text-neutral-500">Run a dry run to see the exact messages, bytes, destination endpoint and route status for “{scene?.name}”. The compiled plan is the same one the Scenes tab shows; nothing is sent.</p>}
      <div>
        <div className="font-semibold mb-1">Send log <span className="font-normal text-neutral-500">— what Signal Loom attempted and transmitted; not what any pedal did</span></div>
        <ol className="flex flex-col gap-0.5 max-h-56 overflow-auto font-mono text-[11px]" data-testid="live-log" aria-label="Send log">
          {sendLog.map((e) => (
            <li key={e.seq} data-kind={e.kind} className={e.kind === "sent" ? "text-green-800" : e.kind === "failed" ? "text-red-700" : e.kind === "cancelled" || e.kind === "stopped" ? "text-amber-800" : e.kind === "armed" ? "text-red-800 font-semibold" : "text-neutral-600"}>
              <span className="text-neutral-400">{e.at.slice(11, 19)}</span> <span className="uppercase">{e.kind}</span> {e.message}
            </li>
          ))}
          {!sendLog.length && <li className="text-neutral-500 font-sans">Nothing sent yet.</li>}
        </ol>
      </div>
    </div>
  );
}
