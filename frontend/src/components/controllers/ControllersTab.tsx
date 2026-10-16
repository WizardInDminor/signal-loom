"use client";

import { useRigStore } from "@/store/rigStore";
import type { Mc8Bank, Ml10xPreset } from "@/lib/types";
import { Badge, Button, DiagnosticList, Field, Panel } from "@/components/ui/basics";

const ACTIONS = ["press", "release", "long_press", "long_press_release", "double_tap", "double_tap_release", "release_all", "long_press_scroll"];

export function ControllersTab() {
  const { rig, analysis, profiles, update } = useRigStore();
  if (!rig) return null;
  const mc8 = rig.controllers.mc8;
  const ml = rig.controllers.ml10x;
  const compiled = analysis?.compiled;
  const controllers = rig.instances.filter((i) => profiles[i.profile_id]?.category === "controller");
  const switchers = rig.instances.filter((i) => profiles[i.profile_id]?.category === "switcher");
  const positions = compiled?.mc8.limits.footswitch_positions ?? "ABCDEFGHIJKLMNOP".split("");
  const topo = analysis?.ml10x.topology;

  const editBank = (n: number, fn: (b: Mc8Bank) => void) => update((r) => { const b = r.controllers.mc8.banks.find((x) => x.number === n); if (b) fn(b); });
  const addBank = () =>
    update((r) => {
      const used = new Set(r.controllers.mc8.banks.map((b) => b.number));
      let n = 1;
      while (used.has(n)) n++;
      r.controllers.mc8.banks.push({ number: n, name: `Bank ${n}`, presets: [] });
    });
  const setPreset = (bank: number, pos: string, fn: (p: Mc8Bank["presets"][number]) => void) =>
    editBank(bank, (b) => {
      let p = b.presets.find((x) => x.position === pos);
      if (!p) {
        p = { position: pos, short_name: "", toggle_mode: false, scene_id: null, action: "press", extra_messages: [] };
        b.presets.push(p);
      }
      fn(p);
      if (!p.short_name && !p.scene_id) b.presets = b.presets.filter((x) => x !== p);
    });
  const editPreset = (n: number, fn: (p: Ml10xPreset) => void) => update((r) => { const p = r.controllers.ml10x.presets.find((x) => x.number === n); if (p) fn(p); });
  const addMlPreset = () =>
    update((r) => {
      const used = new Set(r.controllers.ml10x.presets.map((p) => p.number));
      let n = 0;
      while (used.has(n)) n++;
      r.controllers.ml10x.presets.push({ number: n, name: `Preset ${n}`, mode: "simple", chain: [], bypassed_loops: [], advanced_edges: [] });
    });

  return (
    <div className="grid lg:grid-cols-2 gap-3 items-start">
      <Panel title="Morningstar MC8 (original) — bank & switch plan" actions={<Button onClick={addBank}>+ Bank</Button>}>
        <div className="flex flex-col gap-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <Field label="MC8 instance">
              <select value={mc8.instance_id ?? ""} onChange={(e) => update((r) => { r.controllers.mc8.instance_id = e.target.value || null; })}>
                <option value="">— not assigned —</option>
                {controllers.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
              </select>
            </Field>
            <Field label="Firmware assumed" hint="limits: 30 banks · 22 presets/bank · 16 messages/preset">
              <input value={mc8.firmware_version ?? ""} placeholder={compiled?.mc8.firmware_assumed} onChange={(e) => update((r) => { r.controllers.mc8.firmware_version = e.target.value || null; })} />
            </Field>
          </div>
          <DiagnosticList items={compiled?.diagnostics ?? []} empty="" />
          {mc8.banks.sort((a, b) => a.number - b.number).map((bank) => {
            const bplan = compiled?.mc8.banks.find((b) => b.number === bank.number);
            return (
              <fieldset key={bank.number} className="border border-line rounded p-2">
                <legend className="px-1 font-semibold flex items-center gap-2">
                  Bank
                  <input aria-label="Bank number" type="number" min={1} max={30} className="w-14" value={bank.number} onChange={(e) => update((r) => { const b = r.controllers.mc8.banks.find((x) => x.number === bank.number); if (b) b.number = Number(e.target.value); })} />
                  <input aria-label="Bank name" value={bank.name} onChange={(e) => editBank(bank.number, (b) => { b.name = e.target.value; })} />
                  <Button variant="ghost" onClick={() => window.confirm(`Remove bank ${bank.number}?`) && update((r) => { r.controllers.mc8.banks = r.controllers.mc8.banks.filter((b) => b.number !== bank.number); })}>✕</Button>
                </legend>
                <DiagnosticList items={bplan?.diagnostics ?? []} empty="" />
                <div className="grid grid-cols-4 gap-1 mt-1">
                  {positions.map((pos, idx) => {
                    const p = bank.presets.find((x) => x.position === pos);
                    const sp = bplan?.switches.find((s) => s.position === pos);
                    const errs = sp?.diagnostics.filter((d) => d.severity === "error").length ?? 0;
                    return (
                      <div key={pos} className={`border rounded p-1 ${errs ? "border-red-300 bg-red-50" : p ? "border-green-300 bg-green-50" : "border-line"}`}>
                        <div className="flex justify-between font-semibold"><span>{pos}{idx >= 8 && <span className="text-neutral-400 font-normal"> pg2</span>}</span>{sp && <span className={sp.message_count > sp.message_limit ? "text-red-600" : "text-neutral-500"}>{sp.message_count}/{sp.message_limit}</span>}</div>
                        <input aria-label={`Switch ${pos} short name`} className="w-full" placeholder="name" maxLength={10} value={p?.short_name ?? ""} onChange={(e) => setPreset(bank.number, pos, (x) => { x.short_name = e.target.value; })} />
                        <select aria-label={`Switch ${pos} scene`} className="w-full" value={p?.scene_id ?? ""} onChange={(e) => setPreset(bank.number, pos, (x) => { x.scene_id = e.target.value || null; if (!x.short_name && e.target.value) x.short_name = rig.scenes.find((s) => s.id === e.target.value)?.name.slice(0, 10) ?? ""; })}>
                          <option value="">— scene —</option>
                          {rig.scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        {p && (
                          <select aria-label={`Switch ${pos} action`} className="w-full" value={p.action} onChange={(e) => setPreset(bank.number, pos, (x) => { x.action = e.target.value; })}>
                            {ACTIONS.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
                {bplan?.switches.map((s) => (
                  <details key={s.position} className="mt-1">
                    <summary className="cursor-pointer">{s.position} {s.short_name} — {s.message_count} messages{s.diagnostics.length ? ` · ${s.diagnostics.length} notes` : ""}</summary>
                    <ol className="list-decimal pl-5">{s.messages.map((m, k) => <li key={k}>{m.summary} <span className="text-neutral-500">— {m.explanation}</span></li>)}</ol>
                    {s.manual_steps.map((m, k) => <div key={k} className="text-neutral-600">Manual: {m}</div>)}
                    <DiagnosticList items={s.diagnostics} empty="" />
                  </details>
                ))}
              </fieldset>
            );
          })}
          {!mc8.banks.length && <p className="text-neutral-500">Add a bank, then pick a scene for each switch. Positions A–H are page 1, I–P page 2.</p>}
        </div>
      </Panel>
      <Panel title="Morningstar ML10X — loops & presets" actions={<Button onClick={addMlPreset}>+ Preset</Button>}>
        <div className="flex flex-col gap-2 text-xs">
          <div className="grid grid-cols-3 gap-2">
            <Field label="ML10X instance">
              <select value={ml.instance_id ?? ""} onChange={(e) => update((r) => { r.controllers.ml10x.instance_id = e.target.value || null; })}>
                <option value="">— not assigned —</option>
                {switchers.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
              </select>
            </Field>
            <Field label="Firmware" hint="1.1.2 stable · 1.2.0 beta (Advanced-mode bypass)">
              <select value={ml.firmware_version ?? ""} onChange={(e) => update((r) => { r.controllers.ml10x.firmware_version = e.target.value || null; })}>
                <option value="">unknown</option><option value="1.1.2">1.1.2</option><option value="1.2.0">1.2.0 (beta)</option>
              </select>
            </Field>
            <div className="pt-4 text-neutral-600">4 banks × 128 presets · 5 TRS loops = 10 mono loops</div>
          </div>
          {topo ? (
            <table className="w-full">
              <thead><tr className="text-left text-neutral-500"><th>Loop</th><th>Jack</th><th>Device (from cables)</th><th>Status</th></tr></thead>
              <tbody>{topo.loops.map((l) => <tr key={l.loop} className="border-t border-line"><td>{l.loop}</td><td>{l.name}</td><td>{l.send_to ?? "—"}{l.return_from && l.return_from !== l.send_to ? ` → ${l.return_from}` : ""}</td><td>{l.complete ? <Badge tone="ok">cabled</Badge> : l.occupied ? <Badge tone="bad">open</Badge> : <span className="text-neutral-400">empty</span>}</td></tr>)}</tbody>
            </table>
          ) : <p className="text-neutral-500">Assign the ML10X instance to see loop occupancy.</p>}
          <DiagnosticList items={analysis?.ml10x.diagnostics ?? []} empty="" />
          {ml.presets.sort((a, b) => a.number - b.number).map((p) => (
            <fieldset key={p.number} className="border border-line rounded p-2">
              <legend className="px-1 font-semibold flex items-center gap-2">
                Preset <input aria-label="Preset number" type="number" min={0} max={511} className="w-16" value={p.number} onChange={(e) => editPreset(p.number, (x) => { x.number = Number(e.target.value); })} />
                <input aria-label="Preset name" value={p.name} maxLength={16} onChange={(e) => editPreset(p.number, (x) => { x.name = e.target.value; })} />
                <select aria-label="Preset mode" value={p.mode} onChange={(e) => editPreset(p.number, (x) => { x.mode = e.target.value as "simple" | "advanced"; })}><option value="simple">simple</option><option value="advanced">advanced</option></select>
                <Button variant="ghost" onClick={() => update((r) => { r.controllers.ml10x.presets = r.controllers.ml10x.presets.filter((x) => x.number !== p.number); })}>✕</Button>
              </legend>
              {p.mode === "simple" ? (
                <div>
                  <div className="text-neutral-600 mb-1">Series chain: IN → {p.chain.map((l) => `L${l}`).join(" → ") || "(empty)"} → OUT · bank {Math.floor(p.number / 128) + 1}, PC {p.number % 128}</div>
                  <div className="flex flex-wrap gap-1">
                    {(topo?.loops ?? Array.from({ length: 10 }, (_, i) => ({ loop: i + 1, name: `L${i + 1}`, send_to: null, complete: false }))).map((l) => {
                      const idx = p.chain.indexOf(l.loop);
                      const inChain = idx >= 0;
                      const byp = p.bypassed_loops.includes(l.loop);
                      return (
                        <div key={l.loop} className={`border rounded px-1 py-0.5 flex items-center gap-1 ${inChain ? (byp ? "bg-neutral-100 border-neutral-400" : "bg-green-50 border-green-300") : "border-line"}`}>
                          <label className="flex items-center gap-1"><input type="checkbox" checked={inChain} onChange={(e) => editPreset(p.number, (x) => { x.chain = e.target.checked ? [...x.chain, l.loop] : x.chain.filter((k) => k !== l.loop); if (!e.target.checked) x.bypassed_loops = x.bypassed_loops.filter((k) => k !== l.loop); })} />L{l.loop} {l.send_to ?? l.name}</label>
                          {inChain && (
                            <>
                              <Button variant="ghost" aria-label="Earlier in chain" disabled={idx === 0} onClick={() => editPreset(p.number, (x) => { [x.chain[idx - 1], x.chain[idx]] = [x.chain[idx], x.chain[idx - 1]]; })}>←</Button>
                              <Button variant="ghost" aria-label="Later in chain" disabled={idx === p.chain.length - 1} onClick={() => editPreset(p.number, (x) => { [x.chain[idx + 1], x.chain[idx]] = [x.chain[idx], x.chain[idx + 1]]; })}>→</Button>
                              <label title="Saved as bypassed in this preset"><input type="checkbox" checked={byp} onChange={(e) => editPreset(p.number, (x) => { x.bypassed_loops = e.target.checked ? [...x.bypassed_loops, l.loop] : x.bypassed_loops.filter((k) => k !== l.loop); })} /> byp</label>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <Field label="Advanced routing edges, one per line as FROM>TO (nodes IN, OUT, IN_TIP, IN_RING, OUT_TIP, OUT_RING, L1–L10). Authored in the Morningstar editor; modelled here for validation only.">
                  <textarea rows={3} value={p.advanced_edges.map((e) => e.join(">")).join("\n")} onChange={(e) => editPreset(p.number, (x) => { x.advanced_edges = e.target.value.split("\n").filter((l) => l.includes(">")).map((l) => l.split(">").map((s) => s.trim().toUpperCase())); })} />
                </Field>
              )}
            </fieldset>
          ))}
        </div>
      </Panel>
    </div>
  );
}
