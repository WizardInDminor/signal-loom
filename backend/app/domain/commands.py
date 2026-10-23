"""Named MIDI commands: how the user's command library relates to the documented MIDI map, and how
a command is applied to a scene.

The documented facts (``MidiSpec.cc_map``, ``program_change``, ``bypass``) are what a manual or a
dataset says; a ``MidiCommand`` is what the user wants to *say* with them ("Engage A side"). The
two are kept consistent by construction, not by duplication:

- ``commands_from_midi_spec`` derives starter commands from the documented facts, copying their
  evidence, so a user never retypes a CC the profile already knows.
- ``apply_cc``/``apply_pc`` write the exact bytes into the scene's existing desired state together
  with an ``AppliedCommand`` snapshot. The compiler keeps checking those bytes against the
  documented map and ranges exactly as it checks hand-typed values.
"""

from __future__ import annotations

from ..models.common import Evidence
from ..models.profile import MidiCommand, MidiSpec, ValueChoice
from ..models.rig import AppliedCommand, CcValue, ProgramSelection, utcnow_iso


class CommandApplyError(ValueError):
    pass


def _slug(text: str) -> str:
    out = "".join(ch if ch.isalnum() else "-" for ch in text.lower()).strip("-")
    while "--" in out:
        out = out.replace("--", "-")
    return out[:30] or "cmd"


def commands_from_midi_spec(midi: MidiSpec) -> list[MidiCommand]:
    """Starter commands implied by the documented MIDI facts, with the facts' own evidence.

    - bypass with a CC and absolute values → "Engage" / "Bypass" fixed commands (deterministic as
      the bypass spec says; a toggle-style bypass becomes one "Toggle bypass" command);
    - every ``cc_map`` entry that is not the bypass CC → an "any value" command (its
      ``value_semantics`` text is carried as the description; nothing is parsed into numbers);
    - program change supported → one "Recall program" PC command for the lowest documented program
      (the user edits the number), only when PC support is documented as true.

    Commands whose wire definition already exists in ``midi.commands`` are not repeated.
    Nothing here invents a number that the spec does not state."""
    out: list[MidiCommand] = []
    bp = midi.bypass
    if bp.method == "cc" and bp.cc is not None:
        if bp.deterministic is False:
            out.append(
                MidiCommand(
                    id=f"cmd_bypass-toggle-cc{bp.cc}",
                    name="Toggle bypass",
                    category="Bypass",
                    kind="cc",
                    cc=bp.cc,
                    value_mode="fixed" if bp.on_value is not None else "any",
                    value=bp.on_value,
                    intent="toggle",
                    deterministic=False,
                    evidence=bp.evidence,
                    description=bp.note,
                )
            )
        else:
            if bp.on_value is not None:
                out.append(
                    MidiCommand(
                        id=f"cmd_engage-cc{bp.cc}",
                        name="Engage",
                        category="Bypass",
                        kind="cc",
                        cc=bp.cc,
                        value_mode="fixed",
                        value=bp.on_value,
                        intent="engage",
                        deterministic=bp.deterministic,
                        evidence=bp.evidence,
                        description=bp.note,
                    )
                )
            if bp.off_value is not None:
                out.append(
                    MidiCommand(
                        id=f"cmd_bypass-cc{bp.cc}",
                        name="Bypass",
                        category="Bypass",
                        kind="cc",
                        cc=bp.cc,
                        value_mode="fixed",
                        value=bp.off_value,
                        intent="bypass",
                        deterministic=bp.deterministic,
                        evidence=bp.evidence,
                        description=bp.note,
                    )
                )
    for c in midi.cc_map:
        if bp.method == "cc" and c.cc == bp.cc:
            continue
        if not c.reviewed:
            continue  # a control proposed from PDF text is not knowledge until a human reviewed it
        rng = (
            f"documented range {c.min_value if c.min_value is not None else 0}–{c.max_value if c.max_value is not None else 127}"
            if c.min_value is not None or c.max_value is not None
            else None
        )
        out.append(
            MidiCommand(
                id=f"cmd_{_slug(c.name)}-cc{c.cc}",
                name=c.name,
                category="Controls",
                kind="cc",
                cc=c.cc,
                value_mode="any",
                intent="toggle" if c.behavior == "toggle" else "set",
                deterministic=False if c.behavior == "toggle" else None,
                evidence=c.evidence,
                description=" · ".join(x for x in (c.value_semantics, rng) if x) or None,
                citation=c.citation.model_copy() if c.citation else None,
                verified_on_hardware=c.hardware_status == "verified",
            )
        )
    pcs = midi.program_change
    if pcs.supported is True:
        out.append(
            MidiCommand(
                id="cmd_recall-program",
                name="Recall program",
                category="Programs",
                kind="pc",
                pc=pcs.min if pcs.min is not None else 0,
                intent="recall",
                deterministic=True,
                evidence=pcs.evidence,
                description=pcs.note,
            )
        )
    existing_defs = {c.fingerprint() for c in midi.commands}
    existing_ids = {c.id for c in midi.commands}
    fresh: list[MidiCommand] = []
    for cmd in out:
        if cmd.fingerprint() in existing_defs or cmd.id in existing_ids:
            continue
        fresh.append(cmd)
    return fresh


def documented_value_choices(cmd: MidiCommand) -> list[ValueChoice]:
    return list(cmd.choices) if cmd.value_mode == "choice" else []


def _snapshot(cmd: MidiCommand, value_label: str | None) -> AppliedCommand:
    return AppliedCommand(
        command_id=cmd.id,
        name=cmd.name,
        definition=cmd.fingerprint(),
        value_label=value_label,
        deterministic=cmd.deterministic,
        applied_at=utcnow_iso(),
    )


def apply_cc(cmd: MidiCommand, value: int | None = None) -> CcValue:
    """The scene value a CC command produces. A fixed command ignores ``value``; a choice command
    needs one of its documented values; an "any" command needs an explicit value."""
    if cmd.kind != "cc" or cmd.cc is None:
        raise CommandApplyError("not a CC command")
    if cmd.value_mode == "fixed":
        assert cmd.value is not None
        return CcValue(cc=cmd.cc, value=cmd.value, label=cmd.name, command=_snapshot(cmd, None))
    if value is None or not 0 <= value <= 127:
        raise CommandApplyError(f"'{cmd.name}' needs a value between 0 and 127")
    if cmd.value_mode == "choice":
        choice = next((c for c in cmd.choices if c.value == value), None)
        if choice is None:
            raise CommandApplyError(
                f"{value} is not one of the documented values for '{cmd.name}' ({', '.join(str(c.value) for c in cmd.choices)})"
            )
        return CcValue(cc=cmd.cc, value=value, label=cmd.name, command=_snapshot(cmd, choice.label))
    return CcValue(cc=cmd.cc, value=value, label=cmd.name, command=_snapshot(cmd, None))


def apply_pc(cmd: MidiCommand) -> ProgramSelection:
    if cmd.kind != "pc" or cmd.pc is None:
        raise CommandApplyError("not a PC command")
    return ProgramSelection(pc=cmd.pc, bank_msb=cmd.bank_msb, bank_lsb=cmd.bank_lsb, command=_snapshot(cmd, None))


def evidence_word(cmd: MidiCommand) -> str:
    """One readable phrase for reports: where the numbers come from, plus the user's hardware claim."""
    if cmd.citation is not None:
        where = f"documented in attached manual{f', page {cmd.citation.page}' if cmd.citation.page else ''}"
    elif cmd.evidence == Evidence.DOCUMENTED:
        where = "documented (no page cited)"
    elif cmd.evidence == Evidence.THIRD_PARTY:
        where = "third-party source"
    elif cmd.evidence == Evidence.USER:
        where = "user entered"
    else:
        where = "evidence unknown"
    if cmd.verified_on_hardware:
        where += "; verified on hardware by the user"
    return where
