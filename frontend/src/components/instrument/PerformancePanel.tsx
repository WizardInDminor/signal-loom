"use client";

import { useState } from "react";
import { useRigStore } from "@/store/rigStore";
import { useLiveStore } from "@/store/liveStore";
import { useInstrumentStore } from "@/store/instrumentStore";
import type { Texture } from "@/lib/types";
import type { MacroPreview } from "@/lib/instrument";
import { Badge, Button } from "@/components/ui/basics";

type Mode = "preview" | "disarmed" | "armed" | "performing";

/**
 * "What is happening?" — the one place that can make the rig move: connect (virtual or real
 * ports), arm with the Session 4 phrase, then Start performance for this texture; Stop is always
 * at hand. The state badge says PREVIEW / DISARMED / ARMED / PERFORMING / STOPPED, the counters
 * show planned vs handed vs deduplicated vs deferred, and every destination shows the value the
 * texture asks for now and the last value Signal Loom commanded (never "pedal state").
 */
export function PerformancePanel({ texture, previews, onCreateDemo }: { texture: Texture; previews: Record<string, MacroPreview>; onCreateDemo: () => void }) {
  const { rig, ensureSaved, dirty } = useRigStore();
  const { status, busy, bindings, connect, suggestBindings, arm, disarm, stop: stopQueue } = useLiveStore();
  const { readiness, controllerId, starting, error, clearError, pendingConfirm, dismissConfirm, lastEnded, start, stop } = useInstrumentStore();
  const [phrase, setPhrase] = useState("");
  const [arming, setArming] = useState(false);
  if (!rig) return null;
  const perf = status?.performance;
  const connected = !!status && status.connected_rig_id === rig.id;
  const armed = connected && !!status?.armed;
  const performingThis = perf?.state === "performing" && perf.rig_id === rig.id;
  const performingOther = perf?.state === "performing" && perf.texture_id !== texture.id;
  const mode: Mode = performingThis ? "performing" : armed ? "armed" : connected ? "disarmed" : "preview";
  const label = { preview: "PREVIEW — not connected, nothing is transmitted", disarmed: "DISARMED — connected, nothing is transmitted", armed: "ARMED — not performing; Start is a separate step", performing: `PERFORMING ${perf?.texture_name ?? ""}` }[mode];
  const tone = { preview: "bg-neutral-100 text-neutral-700 border-line", disarmed: "bg-amber-50 text-amber-900 border-amber-300", armed: "bg-red-50 text-red-800 border-red-300", performing: "bg-red-600 text-white border-red-700" }[mode];
  const notControllable = !!readiness && readiness.mappings.filter((m) => m.enabled && m.eligibility.eligible).length === 0;
  // Why the last performance of this rig ended: from the backend's own status (survives tab switches and reloads).
  const backendEnded = perf && perf.state !== "performing" && perf.stop_reason && perf.rig_id === rig.id ? perf : null;
  const ended = performingThis ? null : (lastEnded?.stop_reason ? lastEnded : backendEnded);
  const oneDevice = readiness?.distinct_devices.length === 1;
  const onConnect = async () => {
    if (dirty && !(await ensureSaved())) return; // the live layer reads the saved document
    // Virtual mode with nothing bound: bind the simulated USB endpoints as part of this deliberate click.
    // Real ports are never bound automatically (that is the Live tab's explicit job).
    if (status?.mode === "virtual" && !(bindings?.bindings.length)) await suggestBindings();
    await connect();
  };
  const onArm = async () => { if (await arm(phrase)) { setArming(false); setPhrase(""); } };
  const canStart = !!readiness && readiness.can_start && !starting && !performingOther;
  const startTitle = readiness ? (readiness.can_start ? "Begin streaming this texture's values to the rig (budgeted, lease-protected)" : readiness.blockers[0] ?? "Route acknowledgements will be asked") : "Readiness not loaded";

  return (
    <section className="flex flex-col gap-2" data-testid="performance-panel" aria-label="What is happening">
      <div className={`rounded-md border px-3 py-2 flex flex-wrap items-center gap-2 ${tone}`} data-testid="instrument-state" data-state={mode}>
        <span className="font-semibold text-sm">{label}</span>
        {status && <Badge>{status.mode === "virtual" ? "virtual transport (simulation)" : "real MIDI ports"}</Badge>}
        {performingThis && perf && <span className="font-mono text-xs" data-testid="perf-lease">lease {perf.lease_remaining_s?.toFixed(1)} s{controllerId ? " · this tab controls" : " · controlled elsewhere"}</span>}
        <div className="ml-auto flex flex-wrap gap-1 items-center">
          {!connected && <Button variant="primary" onClick={() => void onConnect()} disabled={busy || !status} data-testid="perf-connect" title={status?.mode === "virtual" ? "Connect to the simulation; binds the simulated USB endpoints if none are bound yet. Nothing is armed." : "Connect to the real ports bound in the Live tab. Nothing is armed."}>Connect rig ({status?.mode === "virtual" ? "virtual" : "real ports"})</Button>}
          {connected && !armed && !arming && <Button variant="danger" onClick={() => setArming(true)} data-testid="perf-arm">Arm…</Button>}
          {connected && !armed && arming && (
            <span className="flex items-center gap-1">
              <input aria-label="Arm confirmation phrase" placeholder={`type: ${status?.arm_phrase}`} className="w-52" value={phrase} onChange={(e) => setPhrase(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void onArm(); }} autoFocus />
              <Button variant="danger" onClick={() => void onArm()} data-testid="perf-arm-confirm">Arm now</Button>
              <Button variant="ghost" onClick={() => { setArming(false); setPhrase(""); }}>Cancel</Button>
            </span>
          )}
          {armed && !performingThis && <Button variant="danger" onClick={() => void start(rig.id, texture.id)} disabled={!canStart} title={startTitle} data-testid="perf-start">▶ Start performance</Button>}
          {performingThis && <Button variant="primary" className="!bg-white !text-red-700 !border-white font-semibold" onClick={() => void stop()} data-testid="perf-stop">■ Stop</Button>}
          {!performingThis && <Button variant="danger" onClick={() => { void stop(); void stopQueue(); }} data-testid="perf-stop-idle" title="Stop any performance or queued messages now">■ Stop</Button>}
          {armed && !performingThis && <Button onClick={() => void disarm()} data-testid="perf-disarm">Disarm</Button>}
        </div>
      </div>

      {error && <div role="alert" data-testid="instrument-error" className="bg-red-50 border border-red-200 text-red-800 text-xs px-3 py-2 flex items-center gap-2"><span className="flex-1">{error}</span><Button variant="ghost" onClick={clearError} aria-label="Dismiss">×</Button></div>}

      {pendingConfirm && (
        <div role="alertdialog" aria-label="Confirm route prerequisites before performing" className="border border-amber-400 bg-amber-50 rounded-md p-3 text-xs" data-testid="perf-confirm">
          <div className="font-semibold mb-1">Before performing over these routes: nothing has been queued</div>
          <p className="mb-1">Confirm each hardware setting is in place and that you accept the unverified hops. Remembered until you disconnect.</p>
          <ul className="list-disc pl-4 mb-2" data-testid="perf-confirm-items">{pendingConfirm.items.map((it) => <li key={it}>{it}</li>)}</ul>
          <div className="flex gap-1">
            <Button variant="danger" onClick={() => void start(rig.id, texture.id, pendingConfirm.items)} data-testid="perf-confirm-start">I have checked these — start</Button>
            <Button onClick={dismissConfirm}>Don&apos;t start</Button>
          </div>
        </div>
      )}

      {ended && (
        <div className="text-xs border border-line rounded px-2 py-1 bg-neutral-50" data-testid="perf-ended">
          <b>STOPPED</b> ({ended.stopped_by}): {ended.stop_reason}. Values already transmitted are not undone; pedals keep what they last received.
        </div>
      )}

      {readiness && !readiness.can_start && !performingThis && (
        <ul className="text-xs text-neutral-700 flex flex-col gap-0.5" data-testid="perf-blockers">
          {readiness.blockers.map((b) => <li key={b}>· {b}</li>)}
          {readiness.confirmations_required.length > 0 && <li>· Start will ask you to confirm {readiness.confirmations_required.length} route prerequisite(s) / unverified hop(s).</li>}
        </ul>
      )}

      {readiness && notControllable && (
        <div className="border border-amber-300 bg-amber-50 rounded-md p-3 text-xs flex flex-col gap-1" data-testid="perf-not-controllable">
          <div className="font-semibold">Not yet controllable from this rig</div>
          <p>No destination of this texture is a documented or user-declared continuous control. Signal Loom does not promote unknown CCs to knobs, and bypass controls (such as the Sunset&apos;s hardware-verified CC 10/15) are switches, not sweeps.</p>
          <p>Declare a control you have verified yourself (with a note) in the patch list, or explore the isolated synthetic demo:</p>
          <div><Button onClick={onCreateDemo} data-testid="perf-create-demo">Create the Undertow virtual demo rig</Button></div>
        </div>
      )}
      {readiness && !notControllable && oneDevice && <p className="text-xs text-amber-800" data-testid="perf-one-device">Only one pedal is ready as a destination; a whole-rig gesture wants two or more.</p>}

      <div className="grid md:grid-cols-[1fr_auto] gap-2 items-start">
        <div className="min-w-0 overflow-x-auto">
        <table className="w-full text-xs whitespace-nowrap" data-testid="perf-destinations">
          <thead><tr className="text-left text-neutral-500"><th>Destination</th><th>Asked now</th><th>Last commanded</th><th>Ch</th><th>Range</th><th>Route</th></tr></thead>
          <tbody>
            {texture.macros.flatMap((macro) => macro.mappings.map((m) => {
              const r = readiness?.mappings.find((x) => x.mapping_id === m.id);
              const d = perf?.destinations.find((x) => x.mapping_id === m.id);
              const asked = previews[macro.id]?.values[m.id];
              return (
                <tr key={m.id} className="border-t border-line" data-testid={`perf-dest-${m.id}`} data-last={d?.last_commanded ?? ""}>
                  <td>{r?.label ?? m.instance_id} · CC {m.cc} {!m.enabled && <Badge>off</Badge>}{r && !r.ready && m.enabled && <Badge tone="bad">not ready</Badge>}</td>
                  <td className="font-mono" data-testid={`perf-asked-${m.id}`}>{asked ?? "—"}</td>
                  <td className="font-mono" data-testid={`perf-last-${m.id}`}>{performingThis && d ? (d.last_commanded ?? "—") : <span className="text-neutral-400">—</span>}</td>
                  <td>{r?.channel ?? "?"}</td>
                  <td className="font-mono">{m.output_min}→{m.output_max}</td>
                  <td>{r ? <Badge tone={r.route.status === "supported" ? "ok" : r.route.status === "unverified" ? "warn" : "neutral"}>{r.route.status}{r.route.endpoint_name ? ` · ${r.route.endpoint_name}` : ""}</Badge> : "—"}</td>
                </tr>
              );
            }))}
          </tbody>
        </table>
        </div>
        <div className="text-[11px] text-neutral-600 md:min-w-[220px]" data-testid="perf-counters">
          <div className="font-semibold text-neutral-700">Stream budget &amp; counters</div>
          {perf ? (
            <>
              <div>budget: {perf.budget.aggregate_per_s}/s total · {perf.budget.per_destination_per_s}/s per destination · lease {perf.lease_s}s</div>
              <div>state <b data-testid="perf-state">{perf.state}</b>{perf.texture_name ? ` · ${perf.texture_name}` : ""}</div>
              <div>ticks {perf.counters.ticks} · planned {perf.counters.planned} · handed <b data-testid="perf-handed">{perf.counters.handed}</b></div>
              <div>deduplicated {perf.counters.deduplicated} · deferred {perf.counters.deferred} · refused {perf.counters.refused}</div>
              {status && <div>sender queue {status.queue_length}{status.in_flight ? ` · in flight: ${status.in_flight}` : ""}</div>}
            </>
          ) : <div>—</div>}
          <div className="mt-1 text-neutral-500">“Asked now” is this screen&apos;s evaluation; “last commanded” is what the backend handed to the sender. Neither is pedal state; a virtual performance is not hardware evidence.</div>
        </div>
      </div>
    </section>
  );
}
