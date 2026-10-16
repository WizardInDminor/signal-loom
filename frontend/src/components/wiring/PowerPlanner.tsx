"use client";

import { useMemo, useState } from "react";
import { useRigStore } from "@/store/rigStore";
import type { PowerConsumer, PowerOutlet, Severity } from "@/lib/types";
import { Badge, Button, EvidenceBadge, Panel } from "@/components/ui/basics";
import { SURFACE_SHORT } from "@/lib/mounting";

/**
 * Power planner: one supply at a time, its outlets as rows, and the devices on each. Every row
 * is read from the analysis (which derives it from the typed power cables), and every edit is a
 * cable or an outlet setting, so the planner can never disagree with the wiring.
 */
export function PowerPlanner() {
  const { rig, analysis, assignPower, unassignPower, setOutletVoltage } = useRigStore();
  const plan = analysis?.power;
  const [chosen, setChosen] = useState<string | null>(null);
  const supplies = plan?.supplies ?? [];
  const supply = supplies.find((s) => s.instance_id === chosen) ?? supplies[0] ?? null;
  const consumers = useMemo(() => plan?.consumers ?? [], [plan]);
  const byId = useMemo(() => Object.fromEntries(consumers.map((c) => [c.instance_id, c])), [consumers]);
  if (!rig || !plan) return null;

  const unpowered = plan.unpowered.map((id) => byId[id]).filter(Boolean);
  const unknown = plan.unknown_requirements.map((id) => byId[id]).filter(Boolean);
  const fmtNeed = (c: PowerConsumer) => {
    if (!c.requirement_known) return "requirement unknown";
    const v = c.voltage_max_v != null ? `${c.voltage_v}–${c.voltage_max_v} V` : `${c.voltage_v} V`;
    const pol = c.polarity === "center_negative" ? "⊖" : c.polarity === "center_positive" ? "⊕" : "polarity ?";
    const ma = c.current_known ? `≥ ${c.current_ma_min} mA` : "current unknown";
    return `${v} ${pol} · ${ma}`;
  };
  const assignTo = (o: PowerOutlet, deviceId: string) => {
    if (!supply || !deviceId) return;
    const c = byId[deviceId];
    if (!c?.inlet_port_id) return;
    assignPower(supply.instance_id, o.port_id, deviceId, c.inlet_port_id);
  };
  const tone = (st: PowerOutlet["status"]) => (st === "error" ? "bad" : st === "warning" || st === "unknown" ? "warn" : st === "ok" ? "ok" : "neutral");
  const worst = (issues: Record<string, Severity>): Severity | null => (Object.values(issues).includes("error") ? "error" : Object.values(issues).includes("warning") ? "warning" : Object.values(issues).length ? "info" : null);
  const issueText: Record<string, string> = {
    "power.voltage_mismatch": "wrong voltage",
    "power.polarity_mismatch": "wrong polarity",
    "power.ac_dc_mismatch": "AC/DC mismatch",
    "power.current_insufficient": "outlet rating below the device's documented minimum",
    "power.outlet_overloaded": "shared outlet overloaded (documented minimums)",
    "power.outlet_load_unknown": "shared load cannot be checked",
    "power.expansion_outlet": "expansion link, not a pedal outlet",
    "power.invalid_setting": "voltage setting is not one of the outlet's options",
    "power.requirement_unknown": "device requirement unknown",
    "power.current_unknown": "device current unknown",
    "power.polarity_unknown": "polarity unknown",
    "power.ac_dc_unknown": "AC/DC of the outlet unknown",
    "power.outlet_current_unknown": "outlet rating unknown",
    "power.supply_unknown": "outlet voltage unknown",
    "power.outlet_shared_assumption": "devices share one outlet (common ground assumed acceptable)",
    "power.outlets_share_regulator": "outlets share a regulator",
    "connection.power_daisy_chain": "daisy chain",
  };
  const otherSupplies = (deviceId: string) => supplies.filter((s) => s.instance_id !== deviceId);

  return (
    <Panel title="Power planner" actions={supplies.length > 1 ? (
      <select aria-label="Power supply" value={supply?.instance_id ?? ""} onChange={(e) => setChosen(e.target.value)} data-testid="power-supply-select">
        {supplies.map((s) => <option key={s.instance_id} value={s.instance_id}>{s.label}</option>)}
      </select>
    ) : undefined}>
      <div className="flex flex-col gap-2 text-xs" data-testid="power-planner">
        {!supply ? (
          <p className="text-neutral-500">No power supply in this rig. Add one (Strymon Zuma, Zuma R300, or the generic isolated supply) on the Board.</p>
        ) : (
          <>
            <div className="text-neutral-600 flex flex-wrap items-center gap-2">
              <b>{supply.label}</b> <span>({supply.profile}, {SURFACE_SHORT[supply.surface]})</span>
              {supply.evidence && <EvidenceBadge evidence={supply.evidence} />}
              <span className="text-neutral-500">· {supply.outputs.filter((o) => !o.expansion).length} outlets, each rated on its own; capacities are never pooled.</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="power-outlets">
                <thead>
                  <tr className="text-left text-neutral-500">
                    <th>Outlet</th><th>Voltage · polarity</th><th>Rated</th><th>Devices on it</th><th>Documented need</th><th>Remaining</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {supply.outputs.map((o) => {
                    const sev = worst(o.issues);
                    const canAdd = !o.expansion && (o.assigned.length === 0 || true);
                    const candidates = consumers.filter((c) => !o.assigned.some((a) => a.instance_id === c.instance_id) && c.instance_id !== supply.instance_id);
                    return (
                      <tr key={o.port_id} className={`border-t border-line align-top ${o.status === "error" ? "bg-red-50" : o.expansion ? "bg-neutral-50 text-neutral-500" : ""}`} data-testid={`outlet-${o.port_id}`} data-status={o.status}>
                        <td className="py-1 pr-2 whitespace-nowrap">
                          <b>{o.label}</b>
                          {o.isolated === true ? <span className="block text-[10px] text-neutral-500">isolated</span> : o.isolated === false ? <span className="block text-[10px] text-amber-700">shares {o.shared_group ?? "ground"}</span> : <span className="block text-[10px] text-neutral-400">isolation not stated</span>}
                        </td>
                        <td className="py-1 pr-2 whitespace-nowrap">
                          {o.expansion ? (
                            <span>{o.voltage_v ?? "?"} V link <Badge tone="warn">not a pedal outlet</Badge></span>
                          ) : o.selectable ? (
                            <select aria-label={`${o.label} voltage`} data-testid={`outlet-voltage-${o.port_id}`} value={o.selected_voltage_v ?? o.voltage_v ?? ""} onChange={(e) => setOutletVoltage(supply.instance_id, o.port_id, Number(e.target.value))} className={!o.setting_valid ? "border-red-400" : ""}>
                              {!o.setting_valid && o.selected_voltage_v != null && <option value={o.selected_voltage_v}>{o.selected_voltage_v} V (invalid)</option>}
                              {o.options.map((opt) => <option key={opt.voltage_v} value={opt.voltage_v}>{opt.voltage_v} V · {opt.current_ma_max ?? "?"} mA</option>)}
                            </select>
                          ) : (
                            <span>{o.voltage_v != null ? `${o.voltage_v} V` : <Badge tone="warn">V unknown</Badge>}</span>
                          )}
                          {!o.expansion && <span className="ml-1 text-neutral-500">{o.ac_dc === "ac" ? "AC" : o.polarity === "center_negative" ? "⊖ centre −" : o.polarity === "center_positive" ? "⊕ centre +" : "polarity ?"}</span>}
                        </td>
                        <td className="py-1 pr-2 whitespace-nowrap" data-testid={`outlet-rated-${o.port_id}`}>{o.expansion ? "—" : o.current_ma_max != null ? `${o.current_ma_max} mA` : <Badge tone="warn">unknown</Badge>}</td>
                        <td className="py-1 pr-2">
                          <ul className="flex flex-col gap-0.5">
                            {o.assigned.map((a) => (
                              <li key={a.connection_id} className="flex items-center gap-1" data-testid={`assigned-${a.instance_id}`}>
                                <span>{a.label} <span className="text-neutral-400">({SURFACE_SHORT[a.surface]})</span></span>
                                <select aria-label={`Move ${a.label} to another outlet`} value="" onChange={(e) => { if (e.target.value === "__unplug") unassignPower(a.instance_id); else if (e.target.value) assignTo(supply.outputs.find((x) => x.port_id === e.target.value)!, a.instance_id); }} className="text-[10px]">
                                  <option value="">move…</option>
                                  {supply.outputs.filter((x) => !x.expansion && x.port_id !== o.port_id).map((x) => <option key={x.port_id} value={x.port_id}>→ {x.label}</option>)}
                                  <option value="__unplug">unplug</option>
                                </select>
                              </li>
                            ))}
                            {canAdd && candidates.length > 0 && (
                              <li>
                                <select aria-label={`Assign a device to ${o.label}`} data-testid={`assign-${o.port_id}`} value="" onChange={(e) => assignTo(o, e.target.value)} className="text-[10px]">
                                  <option value="">{o.assigned.length ? "+ add another (shared outlet)…" : "assign a device…"}</option>
                                  {candidates.map((c) => <option key={c.instance_id} value={c.instance_id}>{c.label}{c.powered ? " (move here)" : ""} — {fmtNeed(c)}</option>)}
                                </select>
                              </li>
                            )}
                          </ul>
                        </td>
                        <td className="py-1 pr-2 whitespace-nowrap" data-testid={`outlet-need-${o.port_id}`}>
                          {o.expansion ? "—" : o.assigned.length === 0 ? <span className="text-neutral-400">—</span> : (
                            <>
                              {o.assigned.map((a) => <div key={a.instance_id}>{fmtNeed(a)}</div>)}
                              {o.assigned.length > 1 && <div className="font-semibold">Σ ≥ {o.required_known_ma} mA{o.unknown_count ? ` + ${o.unknown_count} unknown` : ""}</div>}
                            </>
                          )}
                        </td>
                        <td className="py-1 pr-2 whitespace-nowrap" data-testid={`outlet-remaining-${o.port_id}`}>
                          {o.expansion ? "—" : o.remaining_ma == null ? (o.assigned.length ? <Badge tone="warn">unknown</Badge> : o.current_ma_max != null ? `${o.current_ma_max} mA` : "?") : <span className={o.remaining_ma < 0 ? "text-red-700 font-semibold" : ""}>{o.remaining_ma} mA</span>}
                        </td>
                        <td className="py-1">
                          <Badge tone={tone(o.status)}>{o.status === "expansion" ? "link" : o.status}</Badge>
                          {sev && (
                            <ul className="mt-0.5 text-[10px] text-neutral-600">
                              {Object.entries(o.issues).map(([code, s]) => <li key={code} className={s === "error" ? "text-red-700" : s === "warning" ? "text-amber-700" : ""}>{issueText[code] ?? code}</li>)}
                            </ul>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="grid sm:grid-cols-2 gap-2">
          <div className="border border-line rounded p-2" data-testid="power-unpowered">
            <div className="font-semibold">Not yet powered ({unpowered.length})</div>
            {unpowered.length === 0 ? <p className="text-neutral-500">Every device with a power inlet has a cable.</p> : (
              <ul className="flex flex-col gap-1 mt-1">
                {unpowered.map((c) => (
                  <li key={c.instance_id} className="flex flex-wrap items-center gap-1">
                    <span><b>{c.label}</b> <span className="text-neutral-500">{fmtNeed(c)}</span></span>
                    {supply && (
                      <select aria-label={`Power ${c.label} from`} data-testid={`power-${c.instance_id}`} value="" onChange={(e) => { const o = supply.outputs.find((x) => x.port_id === e.target.value); if (o) assignTo(o, c.instance_id); }} className="text-[10px]">
                        <option value="">plug into {supply.label}…</option>
                        {supply.outputs.filter((o) => !o.expansion).map((o) => <option key={o.port_id} value={o.port_id}>{o.label}{o.assigned.length ? ` (shared with ${o.assigned.map((a) => a.label).join(", ")})` : ""} · {o.voltage_v} V · {o.remaining_ma ?? o.current_ma_max ?? "?"} mA left</option>)}
                      </select>
                    )}
                    {otherSupplies(c.instance_id).length > 1 && <span className="text-[10px] text-neutral-400">(switch supply above)</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border border-line rounded p-2" data-testid="power-unknown">
            <div className="font-semibold">Requirement not documented ({unknown.length})</div>
            {unknown.length === 0 ? <p className="text-neutral-500">Every powered device documents its voltage and minimum current.</p> : (
              <ul className="mt-1 flex flex-col gap-0.5">
                {unknown.map((c) => <li key={c.instance_id}><b>{c.label}</b>: {!c.requirement_known ? <Badge tone="warn">voltage unknown</Badge> : null} {!c.current_known ? <Badge tone="warn">current unknown</Badge> : null} <span className="text-neutral-500">— fill the profile from the manual; nothing is assumed.</span></li>)}
              </ul>
            )}
          </div>
        </div>
        <p className="text-[11px] text-neutral-500">{plan.note}</p>
        {supplies.length === 0 && consumers.length > 0 && <Button variant="ghost" disabled>Add a supply on the Board to start assigning</Button>}
      </div>
    </Panel>
  );
}
