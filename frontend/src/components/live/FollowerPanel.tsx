"use client";

import { useState } from "react";
import { useLiveStore } from "@/store/liveStore";
import { useRigStore } from "@/store/rigStore";
import { Badge, Button, Field } from "@/components/ui/basics";

/** What arrives on bound inputs, and an honest guess at which scene it could correspond to. */
export function FollowerPanel() {
  const { follower, observed, status, endpoints, inject } = useLiveStore();
  const { rig, selectScene } = useRigStore();
  const [channel, setChannel] = useState(1);
  const [number, setNumber] = useState(0);
  if (!rig || !status) return null;
  const virtualInputs = status.mode === "virtual" ? endpoints.filter((e) => e.direction === "in" && status.endpoints.some((s) => s.endpoint_id === e.id && s.open)) : [];
  const tone = follower?.status === "possible" ? "warn" : follower?.status === "ambiguous" ? "neutral" : "neutral";
  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="live-follower">
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{follower?.status === "possible" ? "possible active scene" : follower?.status === "ambiguous" ? "ambiguous" : "no evidence"}</Badge>
        <span className="text-neutral-700" data-testid="live-follower-text">{follower?.text}</span>
      </div>
      {follower?.candidates?.length ? (
        <ul className="flex flex-wrap gap-1">
          {follower.candidates.map((c) => (
            <li key={c.scene_id}><Button onClick={() => selectScene(c.scene_id)} title="Show this scene (selecting never sends anything)">{c.scene_name} — {c.matched}/{c.total} messages seen</Button></li>
          ))}
        </ul>
      ) : null}
      {virtualInputs.length > 0 && (
        <div className="flex flex-wrap items-end gap-1 border border-line rounded p-2">
          <span className="text-neutral-600 mr-1">Simulate the controller sending to the computer (virtual only):</span>
          <Field label="Channel"><input aria-label="Inject channel" type="number" min={1} max={16} className="w-14" value={channel} onChange={(e) => setChannel(Number(e.target.value))} /></Field>
          <Field label="PC"><input aria-label="Inject PC" type="number" min={0} max={127} className="w-14" value={number} onChange={(e) => setNumber(Number(e.target.value))} /></Field>
          <Button onClick={() => void inject(virtualInputs[0].id, "pc", channel, number)} data-testid="live-inject-pc">Inject PC</Button>
          {rig.scenes.map((s) => (
            <Button key={s.id} onClick={() => void injectScene(s.id)} data-testid={`live-inject-scene-${s.id}`} title="Inject every compiled message of this scene on the virtual input, as if the MC8 echoed a footswitch">Stomp “{s.name}” (simulated)</Button>
          ))}
        </div>
      )}
      <div>
        <div className="font-semibold mb-1">Observed on inputs <span className="font-normal text-neutral-500">— MIDI seen by the computer; says nothing about pedal state</span></div>
        <ol className="flex flex-col gap-0.5 max-h-40 overflow-auto font-mono text-[11px]" data-testid="live-observed">
          {[...observed].reverse().slice(0, 40).map((o) => <li key={o.seq}><span className="text-neutral-400">{o.at.slice(11, 19)}</span> {o.summary} <span className="text-neutral-500">on {o.endpoint_name}</span></li>)}
          {!observed.length && <li className="text-neutral-500 font-sans">{follower?.listening ? "Nothing observed yet." : "No input is open."}</li>}
        </ol>
      </div>
    </div>
  );

  async function injectScene(sceneId: string) {
    const { analysis } = useRigStore.getState();
    const plan = analysis?.compiled.scenes.find((p) => p.scene_id === sceneId);
    const ep = virtualInputs[0];
    if (!plan || !ep) return;
    for (const m of plan.messages) await inject(ep.id, m.type, m.channel, m.number, m.value);
  }
}
