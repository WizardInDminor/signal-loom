"use client";

import { useState } from "react";
import { useLiveStore } from "@/store/liveStore";
import { useRigStore } from "@/store/rigStore";
import type { EndpointBinding, LiveBindings } from "@/lib/types";
import { Badge, Button, DiagnosticList, Field } from "@/components/ui/basics";

/** Transport mode, endpoint bindings (workstation-local), receiver networks and collisions. */
export function LiveSetup() {
  const { rig, analysis } = useRigStore();
  const { status, endpoints, bindings, coverage, busy, setMode, saveBindings, suggestBindings, refreshEndpoints, release, reacquire } = useLiveStore();
  const [newEndpoint, setNewEndpoint] = useState("");
  const [newInstance, setNewInstance] = useState("");
  const [newPort, setNewPort] = useState("");
  if (!rig || !status) return null;
  const connected = status.connected_rig_id === rig.id;
  const virtual = status.mode === "virtual";
  const candidates = rig.instances.filter((i) => (analysis?.instances[i.id]?.effective_ports ?? []).some((p) => p.kind === "usb" || (p.kind === "midi" && p.direction === "in")));
  const portsOf = (id: string) => (analysis?.instances[id]?.effective_ports ?? []).filter((p) => p.kind === "usb" || (p.kind === "midi" && p.direction === "in"));
  const edit = (fn: (b: LiveBindings) => void) => {
    const next: LiveBindings = structuredClone(bindings ?? { rig_id: rig.id, transport_mode: status.mode, bindings: [], channel_groups: [], send_delay_ms: 20, verified_hops: {} });
    fn(next);
    void saveBindings(next);
  };
  const addBinding = () => {
    const ep = endpoints.find((e) => e.id === newEndpoint);
    if (!ep || !newInstance || !newPort) return;
    const b: EndpointBinding = { endpoint_id: ep.id, instance_id: newInstance, port_id: newPort, direction: ep.direction === "in" ? "in" : "out" };
    edit((x) => { x.bindings.push(b); });
    setNewEndpoint(""); setNewInstance(""); setNewPort("");
  };
  const stateOf = (id: string) => status.endpoints.find((e) => e.endpoint_id === id);

  return (
    <div className="flex flex-col gap-3 text-xs" data-testid="live-setup">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Transport" hint={virtual ? "Simulation: no hardware is touched; simulated pedals keep state." : "Real ports on this computer (python-rtmidi)."}>
          <select aria-label="Transport mode" value={status.mode} disabled={busy} onChange={(e) => void setMode(e.target.value as "virtual" | "rtmidi")}>
            {(["virtual", "rtmidi"] as const).map((m) => (
              <option key={m} value={m} disabled={!status.transports[m].available}>{status.transports[m].label}{status.transports[m].available ? "" : " — unavailable"}</option>
            ))}
          </select>
        </Field>
        {!status.transports.rtmidi.available && <span className="text-neutral-500 max-w-md" data-testid="rtmidi-reason">Real MIDI: {status.transports.rtmidi.reason}</span>}
        <Button onClick={() => void refreshEndpoints()} disabled={busy} title="Re-enumerate ports; a lost port disarms, a returned port is rebound but never re-armed">Rescan ports</Button>
        {virtual && <Button onClick={() => void suggestBindings()} disabled={busy} data-testid="live-suggest">Suggest virtual bindings</Button>}
      </div>

      <div>
        <div className="font-semibold mb-1">Endpoints on this computer {virtual && <Badge>simulated</Badge>}</div>
        <ul className="flex flex-col gap-0.5" data-testid="live-endpoints">
          {endpoints.map((e) => {
            const st = stateOf(e.id);
            return (
              <li key={e.id} className="flex items-center gap-2">
                <code className="text-[11px]">{e.name}</code>
                <span className="text-neutral-400">{e.direction === "in" ? "→ computer" : "computer →"}</span>
                {e.busy && <Badge tone="bad">owned by another app</Badge>}
                {st?.open && <Badge tone="ok">open</Badge>}
                {st?.missing && <Badge tone="bad">missing</Badge>}
                {st?.released && <Badge tone="warn">released</Badge>}
                {st?.error && !st.busy && <span className="text-red-700">{st.error}</span>}
                {connected && st && !st.released && <Button variant="ghost" className="!py-0 !px-1" onClick={() => void release(e.id)} title="Close this port in Signal Loom so another program (an editor) can own it">release</Button>}
                {connected && st?.released && <Button variant="ghost" className="!py-0 !px-1" onClick={() => void reacquire(e.id)}>reacquire</Button>}
              </li>
            );
          })}
          {!endpoints.length && <li className="text-neutral-500">No endpoints enumerated.</li>}
        </ul>
      </div>

      <div>
        <div className="font-semibold mb-1">Bindings — which endpoint is plugged into which jack <span className="font-normal text-neutral-500">(saved for this computer only, never in a project file)</span></div>
        <table className="w-full" data-testid="live-bindings">
          <thead><tr className="text-left text-neutral-500"><th>Endpoint</th><th>Device jack</th><th>Direction</th><th /></tr></thead>
          <tbody>
            {(bindings?.bindings ?? []).map((b, k) => {
              const ep = endpoints.find((e) => e.id === b.endpoint_id);
              const inst = rig.instances.find((i) => i.id === b.instance_id);
              return (
                <tr key={k} className="border-t border-line">
                  <td><code className="text-[11px]">{ep?.name ?? b.endpoint_id}</code>{!ep && <Badge tone="bad">not present</Badge>}</td>
                  <td>{inst?.label ?? b.instance_id}: {b.port_id}</td>
                  <td>{b.direction === "in" ? "device → computer" : "computer → device"}</td>
                  <td><Button variant="ghost" aria-label={`Remove binding ${k + 1}`} onClick={() => edit((x) => { x.bindings.splice(k, 1); })}>✕</Button></td>
                </tr>
              );
            })}
            <tr className="border-t border-line">
              <td>
                <select aria-label="New binding endpoint" value={newEndpoint} onChange={(e) => setNewEndpoint(e.target.value)}>
                  <option value="">— endpoint —</option>
                  {endpoints.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </td>
              <td className="flex gap-1">
                <select aria-label="New binding device" value={newInstance} onChange={(e) => { setNewInstance(e.target.value); setNewPort(portsOf(e.target.value)[0]?.id ?? ""); }}>
                  <option value="">— device —</option>
                  {candidates.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                </select>
                <select aria-label="New binding jack" value={newPort} onChange={(e) => setNewPort(e.target.value)} disabled={!newInstance}>
                  {portsOf(newInstance).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </td>
              <td colSpan={2}><Button onClick={addBinding} disabled={!newEndpoint || !newInstance || !newPort || busy} data-testid="live-add-binding">+ Bind</Button></td>
            </tr>
          </tbody>
        </table>
        <div className="flex items-center gap-2 mt-1">
          <Field label="Delay between messages (ms)">
            <input aria-label="Send delay" type="number" min={0} max={2000} className="w-20" value={bindings?.send_delay_ms ?? 20} onChange={(e) => edit((x) => { x.send_delay_ms = Math.max(0, Math.min(2000, Number(e.target.value) || 0)); })} />
          </Field>
          <span className="text-neutral-500">Conservative by default; raise it if a pedal drops messages.</span>
        </div>
      </div>

      {coverage && (
        <div>
          <div className="font-semibold mb-1">Receiver networks (collision scope = one bound endpoint&apos;s downstream chain)</div>
          {coverage.networks.map((n) => (
            <div key={n.endpoint_id} className="border border-line rounded p-2 mb-1" data-testid={`live-network-${n.endpoint_id}`}>
              <div><b>{n.endpoint_name}</b> → {n.members.map((m) => `${m.label} (ch ${m.channel ?? "?"})`).join(", ")}</div>
              <DiagnosticList items={n.collisions} empty="No channel shared by two devices on this network." />
              {n.collisions.some((c) => c.code === "live.channel_collision") && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {n.collisions.filter((c) => c.code === "live.channel_collision").map((c, k) => {
                    const ch = Number(/Channel (\d+)/.exec(c.message)?.[1]);
                    return <Button key={k} onClick={() => edit((x) => { x.channel_groups.push({ channel: ch, instance_ids: c.related_ids, note: "declared deliberate" }); })}>Declare channel {ch} shared on purpose</Button>;
                  })}
                </div>
              )}
            </div>
          ))}
          {!coverage.networks.length && <p className="text-neutral-500">No bound output endpoint reaches a device yet.</p>}
          <DiagnosticList items={coverage.diagnostics.filter((d) => !d.code.startsWith("live.channel_"))} empty="" />
        </div>
      )}
    </div>
  );
}
