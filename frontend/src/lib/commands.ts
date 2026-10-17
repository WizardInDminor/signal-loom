import type { AppliedCommand, CcValue, CommandKind, DeviceProfile, MidiCommand, ProgramSelection } from "./types";
import { newId } from "./api";

/**
 * Mirror of backend `app/domain/commands.py` and `MidiCommand.fingerprint()`: the wire-relevant
 * definition of a command as a canonical string. The backend compares the string a scene saved at
 * apply time with the live command, so the two implementations must agree byte for byte.
 */
export function fingerprint(c: MidiCommand): string {
  let core: string;
  if (c.kind === "cc") {
    let val: string;
    if (c.value_mode === "fixed") val = String(c.value);
    else if (c.value_mode === "choice") val = "choice[" + [...c.choices].sort((a, b) => a.value - b.value).map((x) => `${x.value}=${x.label}`).join(",") + "]";
    else val = "any";
    core = `cc ${c.cc} ${val}`;
  } else {
    core = `pc ${c.pc} bank ${c.bank_msb ?? "-"}/${c.bank_lsb ?? "-"}`;
  }
  const det = c.deterministic === true ? "yes" : c.deterministic === false ? "no" : "unknown";
  return `${core} intent=${c.intent ?? "-"} deterministic=${det}`;
}

export function wireSummary(c: MidiCommand): string {
  if (c.kind === "cc") {
    if (c.value_mode === "fixed") return `CC ${c.cc} = ${c.value}`;
    if (c.value_mode === "choice") return `CC ${c.cc} = ` + c.choices.map((x) => `${x.value} (${x.label})`).join(" | ");
    return `CC ${c.cc} = <value>`;
  }
  const bank = c.bank_msb != null || c.bank_lsb != null ? ` (bank MSB ${c.bank_msb ?? "-"} / LSB ${c.bank_lsb ?? "-"})` : "";
  return `PC ${c.pc}${bank}`;
}

/** How the device itself shows a wire-level PC, per the profile's documented numbering. */
export function displayedProgram(pc: number, profile: DeviceProfile | undefined): string {
  const n = profile?.midi.program_change.display_numbering;
  if (n === "one_based") return `shown as preset ${pc + 1} on the device`;
  if (n === "zero_based") return `PC ${pc} (device counts from 0)`;
  return `PC ${pc} (device numbering not stated)`;
}

export function evidenceWord(c: MidiCommand): string {
  let where: string;
  if (c.citation) where = `documented in attached manual${c.citation.page ? `, page ${c.citation.page}` : ""}`;
  else if (c.evidence === "documented") where = "documented (no page cited)";
  else if (c.evidence === "third_party") where = "third-party source";
  else if (c.evidence === "user") where = "user entered";
  else where = "evidence unknown";
  if (c.verified_on_hardware) where += "; verified on hardware by you";
  return where;
}

function snapshot(c: MidiCommand, valueLabel: string | null): AppliedCommand {
  return { command_id: c.id, name: c.name, definition: fingerprint(c), value_label: valueLabel, deterministic: c.deterministic ?? null, applied_at: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00") };
}

/** The scene value a CC command produces; throws a readable message when a value is needed or invalid. */
export function applyCc(c: MidiCommand, value?: number | null): CcValue {
  if (c.kind !== "cc" || c.cc == null) throw new Error("not a CC command");
  if (c.value_mode === "fixed") return { cc: c.cc, value: c.value ?? 0, label: c.name, command: snapshot(c, null) };
  if (value == null || !Number.isInteger(value) || value < 0 || value > 127) throw new Error(`“${c.name}” needs a value between 0 and 127`);
  if (c.value_mode === "choice") {
    const choice = c.choices.find((x) => x.value === value);
    if (!choice) throw new Error(`${value} is not one of the documented values for “${c.name}”`);
    return { cc: c.cc, value, label: c.name, command: snapshot(c, choice.label) };
  }
  return { cc: c.cc, value, label: c.name, command: snapshot(c, null) };
}

export function applyPc(c: MidiCommand): ProgramSelection {
  if (c.kind !== "pc" || c.pc == null) throw new Error("not a PC command");
  return { pc: c.pc, bank_msb: c.bank_msb ?? null, bank_lsb: c.bank_lsb ?? null, command: snapshot(c, null) };
}

export type CommandStatus = "ok" | "changed" | "removed";
/** Does the live library still say what the scene saved? Bytes are unaffected either way. */
export function commandStatus(applied: AppliedCommand | null | undefined, profile: DeviceProfile | undefined): CommandStatus | null {
  if (!applied) return null;
  const live = profile?.midi.commands?.find((c) => c.id === applied.command_id);
  if (!live) return "removed";
  return fingerprint(live) === applied.definition ? "ok" : "changed";
}

export function blankCommand(kind: CommandKind = "cc"): MidiCommand {
  return {
    id: newId("cmd"), name: "", category: null, tags: [], description: null, favorite: false, kind,
    cc: kind === "cc" ? 0 : null, value_mode: "fixed", value: kind === "cc" ? 127 : null, choices: [],
    pc: kind === "pc" ? 0 : null, bank_msb: null, bank_lsb: null, intent: null, deterministic: null,
    evidence: "user", citation: null, verified_on_hardware: false, note: null,
  };
}

/** Favorites first, then alphabetical; optional text filter over name, category, tags, description and the wire summary. */
export function orderedCommands(commands: MidiCommand[], query = ""): MidiCommand[] {
  const q = query.trim().toLowerCase();
  const hit = (c: MidiCommand) => !q || [c.name, c.category ?? "", c.description ?? "", wireSummary(c), ...c.tags].join(" ").toLowerCase().includes(q);
  return commands.filter(hit).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
}

/** Client-side mirror of the model rules, so the form can explain before the server refuses. */
export function commandProblems(c: MidiCommand): string[] {
  const out: string[] = [];
  if (!c.name.trim()) out.push("Give the command a name.");
  if (c.kind === "cc") {
    if (c.cc == null || c.cc < 0 || c.cc > 127) out.push("CC number must be 0–127.");
    if (c.value_mode === "fixed" && (c.value == null || c.value < 0 || c.value > 127)) out.push("A fixed command needs its value (0–127); choose “any value” if it is picked per scene.");
    if (c.value_mode === "choice") {
      if (!c.choices.length) out.push("Add at least one documented value.");
      if (new Set(c.choices.map((x) => x.value)).size !== c.choices.length) out.push("Choice values must be distinct.");
      if (c.choices.some((x) => !x.label.trim() || x.value < 0 || x.value > 127)) out.push("Every choice needs a value 0–127 and a meaning.");
    }
  } else if (c.pc == null || c.pc < 0 || c.pc > 127) out.push("PC number (as sent on the wire) must be 0–127.");
  if (c.intent === "toggle" && c.deterministic === true) out.push("A toggle cannot be deterministic: its result depends on the device's prior state.");
  if (c.evidence === "documented" && !c.citation) out.push("Marked documented without a manual citation: allowed, but say where in the note.");
  return out.filter((m) => !m.startsWith("Marked documented")); // the citation hint is advisory, shown separately
}
