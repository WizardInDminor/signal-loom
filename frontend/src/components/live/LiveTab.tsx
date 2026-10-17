"use client";

import { useState } from "react";
import { useLiveStore } from "@/store/liveStore";
import { useRigStore } from "@/store/rigStore";
import { Badge, Button, ErrorBanner, Panel } from "@/components/ui/basics";
import { LiveSetup } from "./LiveSetup";
import { CoverageTable } from "./CoverageTable";
import { AuditionPanel } from "./AuditionPanel";
import { DevicePanels } from "./DevicePanels";
import { FollowerPanel } from "./FollowerPanel";

/**
 * Live: the optional, explicitly armed control layer. The backend owns the MIDI ports; this tab
 * only asks it to connect, arm, dry-run, audition, send and stop. It is disarmed whenever the
 * backend starts, disconnects, rebinds or loses a port, and nothing here sends on load, on scene
 * selection or on an edit.
 */
export function LiveTab() {
  const { rig, ensureSaved, dirty } = useRigStore();
  const { status, busy, error, clearError, connect, disconnect, arm, disarm, stop, pendingConfirm, dismissConfirm } = useLiveStore();
  const [phrase, setPhrase] = useState("");
  const [arming, setArming] = useState(false);
  if (!rig) return null;
  if (!status) return <p className="text-xs text-neutral-500">Reaching the live service…</p>;
  const connected = status.connected_rig_id === rig.id;
  const armed = status.armed && connected;
  const onConnect = async () => {
    if (dirty && !(await ensureSaved())) return; // live reads the saved document; save first, never guess
    await connect();
  };
  const onArm = async () => {
    if (await arm(phrase)) { setArming(false); setPhrase(""); }
  };
  return (
    <div className="flex flex-col gap-3">
      <ErrorBanner message={error} onClose={clearError} />
      <div className={`rounded-md border px-3 py-2 flex flex-wrap items-center gap-2 ${armed ? "border-red-400 bg-red-50" : "border-line bg-panel"}`} data-testid="live-header" data-armed={armed ? "true" : "false"}>
        <span className={`font-semibold text-sm ${armed ? "text-red-800" : "text-neutral-700"}`} data-testid="live-armed-state">{armed ? "ARMED — auditions and panel controls transmit MIDI" : "Disarmed — nothing is transmitted"}</span>
        <Badge>{status.mode === "virtual" ? "virtual simulation" : "real MIDI ports"}</Badge>
        {connected ? <Badge tone="ok">connected</Badge> : <Badge>not connected</Badge>}
        {status.queue_length > 0 && <Badge tone="warn">{status.queue_length} queued</Badge>}
        {status.in_flight && <span data-testid="live-in-flight"><Badge tone="warn">sending {status.in_flight}</Badge></span>}
        {connected && <span data-testid="live-watching"><Badge tone={status.watching ? "ok" : "bad"}>{status.watching ? `ports watched every ${status.watch_interval_s}s` : "ports not watched"}</Badge></span>}
        <div className="ml-auto flex flex-wrap gap-1 items-center">
          {!connected && <Button variant="primary" onClick={() => void onConnect()} disabled={busy} data-testid="live-connect">Connect this rig ({status.mode})</Button>}
          {connected && !armed && !arming && <Button variant="danger" onClick={() => setArming(true)} data-testid="live-arm">Arm…</Button>}
          {connected && !armed && arming && (
            <span className="flex items-center gap-1">
              <input aria-label="Arm confirmation phrase" placeholder={`type: ${status.arm_phrase}`} className="w-56" value={phrase} onChange={(e) => setPhrase(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void onArm(); }} autoFocus />
              <Button variant="danger" onClick={() => void onArm()} data-testid="live-arm-confirm">Arm now</Button>
              <Button variant="ghost" onClick={() => { setArming(false); setPhrase(""); }}>Cancel</Button>
            </span>
          )}
          {armed && <Button variant="primary" onClick={() => void disarm()} data-testid="live-disarm">Disarm</Button>}
          <Button variant="danger" onClick={() => void stop()} data-testid="live-stop-header" title="Cancel queued messages immediately">Stop</Button>
          {connected && <Button onClick={() => void disconnect()} disabled={busy} data-testid="live-disconnect" title="Disarms, drops the queue and closes every port">Disconnect</Button>}
        </div>
        <p className="w-full text-[11px] text-neutral-600">
          Wire the computer to the board once; bind the endpoint(s) below; the coverage table says which pedals each message kind really reaches and with what evidence. Arming is a deliberate gesture and is undone by disconnecting, rebinding, a lost port (the backend watches the ports while connected, whether or not this tab is open) or a backend restart. Stop and Disarm wait for the one message already handed to the driver and cancel everything behind it. The MC8 keeps working on its own without the computer; nothing here replaces it.
        </p>
      </div>

      {pendingConfirm && (
        <div role="alertdialog" aria-label={pendingConfirm.reason === "route" ? "Confirm route prerequisites" : "Confirm state-dependent messages"} className="border border-amber-400 bg-amber-50 rounded-md p-3 text-xs" data-testid="live-confirm" data-reason={pendingConfirm.reason}>
          {pendingConfirm.reason === "route" ? (
            <>
              <div className="font-semibold mb-1">Before the first send over these routes: nothing has been queued</div>
              <p className="mb-1">Confirm that each hardware setting below is in place and that you accept the unverified hops. This is remembered until you disconnect.</p>
              <ul className="list-disc pl-4 mb-2" data-testid="live-confirm-items">{pendingConfirm.items.map((it) => <li key={it}>{it}</li>)}</ul>
            </>
          ) : (
            <>
              <div className="font-semibold mb-1">Some messages are toggles or depend on the pedal&apos;s current state</div>
              <ul className="list-disc pl-4 mb-2">{pendingConfirm.messages.map((m, i) => <li key={i}>{m.summary} — {m.explanation}</li>)}</ul>
            </>
          )}
          <div className="flex gap-1">
            <Button variant="danger" onClick={() => void pendingConfirm.retry()} data-testid="live-confirm-send">{pendingConfirm.reason === "route" ? "I have checked these — send" : "Send anyway"}</Button>
            <Button onClick={dismissConfirm}>Don&apos;t send</Button>
          </div>
        </div>
      )}

      <div className="grid xl:grid-cols-2 gap-3 items-start">
        <Panel title="1 · Transport, endpoints and bindings"><LiveSetup /></Panel>
        <Panel title="2 · Coverage — which pedal each message kind really reaches"><CoverageTable /></Panel>
      </div>
      <Panel title="3 · Scene audition — dry run first, then transmit while armed"><AuditionPanel /></Panel>
      <Panel title="4 · Pedal panels — dial in a control, then capture it to the scene on purpose"><DevicePanels /></Panel>
      <Panel title="5 · Controller observation — what the MC8 sends to the computer, and what it could mean"><FollowerPanel /></Panel>
    </div>
  );
}
