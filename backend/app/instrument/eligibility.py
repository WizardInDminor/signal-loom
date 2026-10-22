"""Which device controls may be modulated continuously, and why (charter §5).

The rule is deliberately conservative. A CC is *eligible* only when the device profile documents it
as a continuously variable, repeatable control (``CcDef.continuous = True``) or the user explicitly
declares it safe on this device with a note (``Mapping.user_override``). Unknown value semantics
are never promoted to a 0–127 sweep, and some controls are refused whatever anyone declares:

- CC 0 / CC 32 (bank select) and CC 120–127 (channel-mode messages);
- the profile's bypass CC and any CC whose documented name or semantics describe bypass/engage,
  toggling, bank selection, muting, preset scrolling or memory operations;
- a CC the profile documents as *not* continuous;
- a CC that a named command of the profile uses with intent engage/bypass/toggle.

The result names its *basis* so the UI can show provenance: ``documented`` (a real profile's
statement), ``synthetic`` (a Signal Loom virtual fixture whose profile says ``provenance.source ==
"synthetic_fixture"``), or ``user_declared`` (the user's override, always with a warning).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from ..models.profile import CcDef, DeviceProfile
from ..models.rig import DeviceInstance, Rig
from ..models.texture import Mapping

Basis = Literal["documented", "synthetic", "user_declared"]
SYNTHETIC_SOURCE = "synthetic_fixture"

BANK_SELECT_CCS = frozenset({0, 32})
CHANNEL_MODE_CCS = frozenset(range(120, 128))
_DISCRETE_WORDS = re.compile(
    r"\b(bypass|engage|toggle|bank|mute|unmute|scroll|preset\s*(up|down)|save|store|write|reset|tap|trigger|footswitch)\b",
    re.IGNORECASE,
)


@dataclass
class Eligibility:
    eligible: bool
    reason: str
    basis: Basis | None = None
    warnings: list[str] = field(default_factory=list)
    control_name: str | None = None
    evidence: str | None = None
    channel: int | None = None
    instance_label: str | None = None
    synthetic: bool = False
    hard_refusal: bool = False  # refused regardless of any override

    def as_dict(self) -> dict:
        return {
            "eligible": self.eligible,
            "reason": self.reason,
            "basis": self.basis,
            "warnings": list(self.warnings),
            "control_name": self.control_name,
            "evidence": self.evidence,
            "channel": self.channel,
            "instance_label": self.instance_label,
            "synthetic": self.synthetic,
            "hard_refusal": self.hard_refusal,
        }


def is_synthetic(profile: DeviceProfile | None) -> bool:
    return bool(profile and profile.provenance.source == SYNTHETIC_SOURCE)


def channel_of(inst: DeviceInstance, prof: DeviceProfile | None) -> int | None:
    if inst.midi_channel is not None:
        return inst.midi_channel
    return prof.midi.default_channel if prof else None


def _hard_refusal(prof: DeviceProfile, cc: int, cc_def: CcDef | None) -> str | None:
    if cc in BANK_SELECT_CCS:
        return f"CC {cc} is Bank Select; it changes which preset a Program Change recalls and is never swept."
    if cc in CHANNEL_MODE_CCS:
        return f"CC {cc} is a channel-mode message (All Sound Off … Poly On); never swept."
    bp = prof.midi.bypass
    if bp.method == "cc" and bp.cc == cc:
        return f"CC {cc} is {prof.display_name}'s bypass control: a switch, not a continuously variable knob."
    if cc_def is not None:
        if cc_def.continuous is False:
            return f"{prof.display_name} documents CC {cc} ({cc_def.name}) as a discrete control, not a sweep."
        text = f"{cc_def.name} {cc_def.value_semantics or ''}"
        if _DISCRETE_WORDS.search(text):
            return f"CC {cc} ({cc_def.name}) is documented as a switch-like control ({cc_def.value_semantics or cc_def.name}); never swept."
    for cmd in prof.midi.commands:
        if cmd.kind == "cc" and cmd.cc == cc and cmd.intent in ("engage", "bypass", "toggle"):
            return f"CC {cc} is used by the command '{cmd.name}' ({cmd.intent}); a state switch is never swept."
    return None


def check_cc(
    inst: DeviceInstance | None,
    prof: DeviceProfile | None,
    cc: int,
    *,
    user_override: bool = False,
    override_note: str | None = None,
) -> Eligibility:
    """Decide whether ``cc`` on this placed device may be swept continuously."""
    if inst is None:
        return Eligibility(
            False,
            "This mapping points at a device that is no longer on the rig; pick a device again.",
            hard_refusal=True,
        )
    label = inst.label
    if prof is None:
        return Eligibility(
            False, f"'{label}' has no device profile on this computer.", instance_label=label, hard_refusal=True
        )
    ch = channel_of(inst, prof)
    if not prof.midi.interfaces:
        return Eligibility(
            False,
            f"'{label}' has no MIDI interface in its profile.",
            instance_label=label,
            channel=ch,
            hard_refusal=True,
        )
    if ch is None or not 1 <= ch <= 16:
        return Eligibility(
            False,
            f"'{label}' has no MIDI channel set; set it on the instance.",
            instance_label=label,
            hard_refusal=True,
        )
    if not 0 <= cc <= 127:
        return Eligibility(False, f"CC {cc} is outside 0–127.", instance_label=label, channel=ch, hard_refusal=True)
    cc_def = next((c for c in prof.midi.cc_map if c.cc == cc), None)
    synthetic = is_synthetic(prof)
    hard = _hard_refusal(prof, cc, cc_def)
    name = cc_def.name if cc_def else None
    evidence = cc_def.evidence.value if cc_def else None
    if hard:
        return Eligibility(
            False,
            hard,
            control_name=name,
            evidence=evidence,
            channel=ch,
            instance_label=label,
            synthetic=synthetic,
            hard_refusal=True,
        )
    if cc_def is not None and cc_def.continuous is True:
        if synthetic:
            return Eligibility(
                True,
                f"'{name}' is a synthetic continuous control of a Signal Loom virtual fixture: simulation only, not a statement about any real pedal.",
                basis="synthetic",
                warnings=["synthetic: this device and its control exist only in the simulation"],
                control_name=name,
                evidence=evidence,
                channel=ch,
                instance_label=label,
                synthetic=True,
            )
        warnings = []
        if cc_def.evidence.value != "documented":
            warnings.append(f"the control's evidence is '{cc_def.evidence.value}', not documented")
        warnings.append("documented as continuous; not hardware-verified on your pedal")
        return Eligibility(
            True,
            f"{prof.display_name} documents CC {cc} ({name}) as a continuously variable control ({cc_def.value_semantics or 'range not stated'}).",
            basis="documented",
            warnings=warnings,
            control_name=name,
            evidence=evidence,
            channel=ch,
            instance_label=label,
        )
    if user_override and (override_note or "").strip():
        return Eligibility(
            True,
            f"You declared CC {cc} on '{label}' safe to sweep: “{override_note.strip()}”. The profile does not document it as continuous.",
            basis="user_declared",
            warnings=[
                "user-declared, not documented: the pedal's reaction to a 0–127 sweep of this CC is your claim, recorded with the mapping",
                *([] if cc_def else [f"CC {cc} is not in {prof.display_name}'s documented CC map at all"]),
            ],
            control_name=name,
            evidence="user",
            channel=ch,
            instance_label=label,
        )
    if cc_def is None:
        reason = f"CC {cc} is not in {prof.display_name}'s documented CC map; an unnamed CC is not assumed to be a safe sweep. Declare it yourself (with a note) if you have verified it."
    else:
        reason = f"{prof.display_name} lists CC {cc} ({name}) but does not state that it is continuously variable ({cc_def.value_semantics or 'semantics not stated'}; evidence {cc_def.evidence.value}). Declare it yourself (with a note) if you have verified it."
    return Eligibility(
        False, reason, control_name=name, evidence=evidence, channel=ch, instance_label=label, synthetic=synthetic
    )


def check_mapping(rig: Rig, profiles: dict[str, DeviceProfile], mapping: Mapping) -> Eligibility:
    inst = rig.instance(mapping.instance_id)
    prof = profiles.get(inst.profile_id) if inst else None
    return check_cc(inst, prof, mapping.cc, user_override=mapping.user_override, override_note=mapping.override_note)


def continuous_controls(inst: DeviceInstance, prof: DeviceProfile | None) -> list[dict]:
    """The documented continuous controls of a placed device (for the destination picker), plus every
    other documented CC with the reason it is *not* offered as a sweep."""
    out: list[dict] = []
    if prof is None:
        return out
    for c in sorted(prof.midi.cc_map, key=lambda c: c.cc):
        e = check_cc(inst, prof, c.cc)
        out.append(
            {
                "cc": c.cc,
                "name": c.name,
                "value_semantics": c.value_semantics,
                "evidence": c.evidence.value,
                **e.as_dict(),
            }
        )
    return out
