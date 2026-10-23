"""Scene intent -> deterministic, explainable MIDI action plan -> MC8 switch plan.

The compiler never sends anything. It produces an ordered list of messages with a source
mapping and diagnostics, so a user can see exactly why each command exists before touching
hardware.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..models.common import DeviceCategory, Diagnostic, Evidence, Severity
from ..models.profile import DeviceProfile
from ..models.rig import DeviceInstance, Mc8Message, Rig, Scene
from ..morningstar import specs
from .ml10x import Ml10xTopology, loop_occupancy
from .wiring import WiringContext, midi_reachability

CC_BANK_MSB = 0
CC_BANK_LSB = 32


@dataclass
class CompiledMessage:
    type: str  # "pc" | "cc"
    channel: int
    number: int  # PC program or CC number
    value: int | None  # CC value (None for PC)
    target_instance_id: str
    target_label: str
    source_kind: str  # "ml10x_bank" | "ml10x_preset" | "ml10x_loop" | "device_bank" | "device_program" | "device_bypass" | "device_cc"
    scene_id: str
    explanation: str
    deterministic: bool = True

    def as_dict(self) -> dict:
        return {
            "type": self.type,
            "channel": self.channel,
            "number": self.number,
            "value": self.value,
            "target_instance_id": self.target_instance_id,
            "target_label": self.target_label,
            "source_kind": self.source_kind,
            "scene_id": self.scene_id,
            "explanation": self.explanation,
            "deterministic": self.deterministic,
            "summary": self.summary(),
        }

    def summary(self) -> str:
        if self.type == "pc":
            return f"PC {self.number} ch {self.channel} -> {self.target_label}"
        return f"CC {self.number} = {self.value} ch {self.channel} -> {self.target_label}"


@dataclass
class ScenePlan:
    scene_id: str
    scene_name: str
    messages: list[CompiledMessage] = field(default_factory=list)
    manual_steps: list[str] = field(default_factory=list)
    diagnostics: list[Diagnostic] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "scene_id": self.scene_id,
            "scene_name": self.scene_name,
            "messages": [m.as_dict() for m in self.messages],
            "manual_steps": list(self.manual_steps),
            "diagnostics": [d.model_dump(mode="json") for d in self.diagnostics],
            "message_count": len(self.messages),
        }


def _channel_for(inst: DeviceInstance, profile: DeviceProfile | None) -> int | None:
    if inst.midi_channel is not None:
        return inst.midi_channel
    if profile and profile.midi.default_channel is not None:
        return profile.midi.default_channel
    return None


def compile_scene(rig: Rig, scene: Scene, profiles: dict[str, DeviceProfile], ctx: WiringContext) -> ScenePlan:
    plan = ScenePlan(scene_id=scene.id, scene_name=scene.name)
    d = plan.diagnostics
    ml = rig.controllers.ml10x
    mc8_inst = rig.instance(rig.controllers.mc8.instance_id) if rig.controllers.mc8.instance_id else None
    reach = midi_reachability(ctx, mc8_inst.id) if mc8_inst else set()

    def check_reach(target: DeviceInstance) -> None:
        if mc8_inst and target.id not in reach:
            d.append(
                Diagnostic(
                    code="midi.unreachable",
                    severity=Severity.WARNING,
                    message=f"No MIDI cable path from '{mc8_inst.label}' to '{target.label}'; these messages will not arrive.",
                    subject_type="scene",
                    subject_id=scene.id,
                    related_ids=[target.id],
                )
            )

    # 1. ML10X routing first, so the audio path is in place before pedal patches load.
    ml_inst = rig.instance(ml.instance_id) if ml.instance_id else None
    if scene.ml10x.preset_number is not None or scene.ml10x.loop_states:
        if ml_inst is None:
            d.append(
                Diagnostic(
                    code="ml10x.not_assigned",
                    severity=Severity.ERROR,
                    message="Scene sets ML10X routing but no ML10X instance is assigned in the controller settings.",
                    subject_type="scene",
                    subject_id=scene.id,
                )
            )
        else:
            ml_prof = profiles.get(ml_inst.profile_id)
            ch = _channel_for(ml_inst, ml_prof)
            if ch is None:
                d.append(
                    Diagnostic(
                        code="midi.channel_unknown",
                        severity=Severity.ERROR,
                        message=f"'{ml_inst.label}' has no MIDI channel set (factory default is unverified). Set it on the instance.",
                        subject_type="scene",
                        subject_id=scene.id,
                        related_ids=[ml_inst.id],
                    )
                )
            else:
                check_reach(ml_inst)
                _compile_ml10x(rig, scene, ml_inst, ch, ctx, plan)

    # 2. Device states in rig instance order (deterministic).
    order = {inst.id: i for i, inst in enumerate(rig.instances)}
    for st in sorted(scene.device_states, key=lambda s: order.get(s.instance_id, 10**6)):
        inst = rig.instance(st.instance_id)
        if inst is None:
            d.append(
                Diagnostic(
                    code="scene.instance_missing",
                    severity=Severity.ERROR,
                    message=f"Scene refers to a device instance '{st.instance_id}' that is not on the rig.",
                    subject_type="scene",
                    subject_id=scene.id,
                )
            )
            continue
        prof = profiles.get(inst.profile_id)
        has_midi = bool(prof and prof.midi.interfaces)
        if not has_midi:
            if st.program is not None or st.cc_values:
                d.append(
                    Diagnostic(
                        code="scene.device_not_midi",
                        severity=Severity.ERROR,
                        message=f"'{inst.label}' has no MIDI interface; program/CC intents cannot be compiled.",
                        subject_type="scene",
                        subject_id=scene.id,
                        related_ids=[inst.id],
                    )
                )
            if st.enabled is not None:
                plan.manual_steps.append(
                    f"{inst.label}: switch {'ON' if st.enabled else 'OFF'} by hand (no MIDI control)."
                )
            if st.manual_note:
                plan.manual_steps.append(f"{inst.label}: {st.manual_note}")
            continue
        ch = _channel_for(inst, prof)
        if ch is None:
            d.append(
                Diagnostic(
                    code="midi.channel_unknown",
                    severity=Severity.ERROR,
                    message=f"'{inst.label}' has no MIDI channel set; set it on the instance (profile default unknown).",
                    subject_type="scene",
                    subject_id=scene.id,
                    related_ids=[inst.id],
                )
            )
            if st.manual_note:
                plan.manual_steps.append(f"{inst.label}: {st.manual_note}")
            continue
        check_reach(inst)
        assert prof is not None
        _check_cc_conflicts(scene, inst, prof, st, plan)
        if st.program is not None:
            _check_applied_command(scene, inst, prof, st.program.command, "PC", plan)
            _compile_program(scene, inst, prof, ch, st.program, plan)
        if st.enabled is not None:
            _compile_bypass(scene, inst, prof, ch, st.enabled, plan)
        for cv in st.cc_values:
            known = next((c for c in prof.midi.cc_map if c.cc == cv.cc), None)
            name = known.name if known else (cv.label or f"CC {cv.cc}")
            if known is None:
                d.append(
                    Diagnostic(
                        code="midi.cc_undocumented",
                        severity=Severity.INFO,
                        message=f"CC {cv.cc} on '{inst.label}' is not in the profile's documented CC map; sent as specified.",
                        subject_type="scene",
                        subject_id=scene.id,
                        related_ids=[inst.id],
                    )
                )
            else:
                # Session 6: structured control knowledge. Neither finding changes the bytes.
                if not known.reviewed:
                    d.append(
                        Diagnostic(
                            code="midi.cc_unreviewed",
                            severity=Severity.WARNING,
                            message=f"CC {cv.cc} ({known.name}) on '{inst.label}' was proposed from a document and not yet reviewed; sent as specified.",
                            subject_type="scene",
                            subject_id=scene.id,
                            related_ids=[inst.id],
                        )
                    )
                if not known.in_range(cv.value):
                    lo = known.min_value if known.min_value is not None else 0
                    hi = known.max_value if known.max_value is not None else 127
                    d.append(
                        Diagnostic(
                            code="midi.cc_out_of_range",
                            severity=Severity.WARNING,
                            message=f"CC {cv.cc} = {cv.value} on '{inst.label}' is outside the documented range {lo}–{hi} of '{known.name}'; sent as specified.",
                            subject_type="scene",
                            subject_id=scene.id,
                            related_ids=[inst.id],
                        )
                    )
            deterministic = True
            if cv.command is not None:
                _check_applied_command(scene, inst, prof, cv.command, f"CC {cv.cc}", plan)
                deterministic = cv.command.deterministic is not False
                live = prof.midi.command(cv.command.command_id)
                if live is not None and live.deterministic is False:
                    deterministic = False
                meaning = f" ({cv.command.value_label})" if cv.command.value_label else ""
                explanation = f"Scene '{scene.name}' applies '{cv.command.name}' on {inst.label}: CC {cv.cc} = {cv.value}{meaning}."
            else:
                explanation = f"Scene '{scene.name}' sets {name} to {cv.value} on {inst.label}."
            plan.messages.append(
                CompiledMessage(
                    type="cc",
                    channel=ch,
                    number=cv.cc,
                    value=cv.value,
                    target_instance_id=inst.id,
                    target_label=inst.label,
                    source_kind="device_cc",
                    scene_id=scene.id,
                    explanation=explanation,
                    deterministic=deterministic,
                )
            )
        if st.manual_note:
            plan.manual_steps.append(f"{inst.label}: {st.manual_note}")
    plan.manual_steps.extend(scene.manual_steps)
    return plan


def _check_applied_command(
    scene: Scene, inst: DeviceInstance, prof: DeviceProfile, applied, what: str, plan: ScenePlan
) -> None:
    """Reproducibility guard. The scene's numbers are sent as saved; this only tells the user when
    the library command they came from no longer says the same thing, or is gone, or is a toggle."""
    if applied is None:
        return
    d = plan.diagnostics
    live = prof.midi.command(applied.command_id)
    if live is None:
        d.append(
            Diagnostic(
                code="midi.command_removed",
                severity=Severity.WARNING,
                message=f"'{applied.name}' ({what}) on '{inst.label}' was removed from the {prof.display_name} command library; the scene still sends the values that were applied. Review or replace it.",
                subject_type="scene",
                subject_id=scene.id,
                related_ids=[inst.id],
            )
        )
        return
    if live.fingerprint() != applied.definition:
        d.append(
            Diagnostic(
                code="midi.command_changed",
                severity=Severity.WARNING,
                message=f"The definition of '{live.name}' on {prof.display_name} changed since it was applied in scene '{scene.name}' ({applied.definition} → {live.fingerprint()}); the scene still sends {what} as saved until you reapply the command.",
                subject_type="scene",
                subject_id=scene.id,
                related_ids=[inst.id],
            )
        )
    if live.deterministic is False or applied.deterministic is False:
        d.append(
            Diagnostic(
                code="midi.command_toggle",
                severity=Severity.WARNING,
                message=f"'{live.name}' on '{inst.label}' is a toggle (the result depends on the device's prior state); scene recall cannot be guaranteed from an unknown starting state.",
                subject_type="scene",
                subject_id=scene.id,
                related_ids=[inst.id],
            )
        )
    if live.evidence == Evidence.UNKNOWN and not live.verified_on_hardware:
        d.append(
            Diagnostic(
                code="midi.command_unverified",
                severity=Severity.INFO,
                message=f"'{live.name}' on '{inst.label}' has no stated source (evidence unknown); the device's response is not established.",
                subject_type="scene",
                subject_id=scene.id,
                related_ids=[inst.id],
            )
        )


def _check_cc_conflicts(scene: Scene, inst: DeviceInstance, prof: DeviceProfile, st, plan: ScenePlan) -> None:
    """Two instructions for one CC on one device in one scene contradict each other unless they agree.
    Bypass-by-CC and Bank Select CCs take part, so "engaged" plus "CC 10 = 0" is caught too."""
    wants: dict[int, list[tuple[int, str]]] = {}
    bp = prof.midi.bypass
    if st.enabled is not None and bp.method == "cc" and bp.cc is not None:
        on_v = bp.on_value if bp.on_value is not None else 127
        off_v = bp.off_value if bp.off_value is not None else 0
        wants.setdefault(bp.cc, []).append((on_v if st.enabled else off_v, "engaged" if st.enabled else "bypassed"))
    if st.program is not None:
        if st.program.bank_msb is not None:
            wants.setdefault(CC_BANK_MSB, []).append((st.program.bank_msb, "Bank Select MSB"))
        if st.program.bank_lsb is not None:
            wants.setdefault(CC_BANK_LSB, []).append((st.program.bank_lsb, "Bank Select LSB"))
    for cv in st.cc_values:
        label = cv.command.name if cv.command else (cv.label or f"CC {cv.cc}")
        wants.setdefault(cv.cc, []).append((cv.value, label))
    for cc, entries in sorted(wants.items()):
        if len(entries) < 2:
            continue
        values = {v for v, _ in entries}
        described = " and ".join(f"{v} ({who})" for v, who in entries)
        if len(values) > 1:
            plan.diagnostics.append(
                Diagnostic(
                    code="scene.cc_conflict",
                    severity=Severity.ERROR,
                    message=f"CC {cc} on '{inst.label}' is set to {described} in scene '{scene.name}'; the device would receive contradictory instructions. Keep one.",
                    subject_type="scene",
                    subject_id=scene.id,
                    related_ids=[inst.id],
                )
            )
        else:
            plan.diagnostics.append(
                Diagnostic(
                    code="scene.cc_repeated",
                    severity=Severity.INFO,
                    message=f"CC {cc} on '{inst.label}' is set twice to the same value ({described}) in scene '{scene.name}'.",
                    subject_type="scene",
                    subject_id=scene.id,
                    related_ids=[inst.id],
                )
            )


def _compile_ml10x(
    rig: Rig, scene: Scene, ml_inst: DeviceInstance, ch: int, ctx: WiringContext, plan: ScenePlan
) -> None:
    d = plan.diagnostics
    ml = rig.controllers.ml10x
    gate = specs.ml10x_feature_gate(ml.firmware_version)
    topo: Ml10xTopology = loop_occupancy(ctx, ml_inst)
    preset = None
    if scene.ml10x.preset_number is not None:
        n = scene.ml10x.preset_number
        total = specs.ML10X_BANKS * specs.ML10X_PRESETS_PER_BANK
        if n >= total:
            d.append(
                Diagnostic(
                    code="ml10x.preset_out_of_range",
                    severity=Severity.ERROR,
                    message=f"ML10X preset {n} is outside 0-{total - 1}.",
                    subject_type="scene",
                    subject_id=scene.id,
                )
            )
            return
        bank, pc = divmod(n, specs.ML10X_PRESETS_PER_BANK)
        preset = next((p for p in ml.presets if p.number == n), None)
        pname = f" '{preset.name}'" if preset and preset.name else ""
        if preset is None:
            d.append(
                Diagnostic(
                    code="ml10x.preset_undefined",
                    severity=Severity.WARNING,
                    message=f"Scene selects ML10X preset {n}, which has no routing defined in this rig. The PC is still sent; define the preset to validate its path.",
                    subject_type="scene",
                    subject_id=scene.id,
                )
            )
        # Absolute state: always select the bank first, then the preset within it.
        plan.messages.append(
            CompiledMessage(
                type="cc",
                channel=ch,
                number=specs.ML10X_CC_CHANGE_BANK,
                value=bank,
                target_instance_id=ml_inst.id,
                target_label=ml_inst.label,
                source_kind="ml10x_bank",
                scene_id=scene.id,
                explanation=f"Select ML10X bank {bank + 1} (CC#0 value {bank}) so that the following PC lands in the right bank regardless of prior state.",
            )
        )
        plan.messages.append(
            CompiledMessage(
                type="pc",
                channel=ch,
                number=pc,
                value=None,
                target_instance_id=ml_inst.id,
                target_label=ml_inst.label,
                source_kind="ml10x_preset",
                scene_id=scene.id,
                explanation=f"Recall ML10X preset {n}{pname} (bank {bank + 1}, PC {pc}) for scene '{scene.name}'.",
            )
        )
    for key, engaged in sorted(scene.ml10x.loop_states.items(), key=lambda kv: int(kv[0])):
        loop = int(key)
        if loop < 1 or loop > 10:
            d.append(
                Diagnostic(
                    code="ml10x.loop_out_of_range",
                    severity=Severity.ERROR,
                    message=f"Loop {loop} does not exist; ML10X loops are 1-10.",
                    subject_type="scene",
                    subject_id=scene.id,
                )
            )
            continue
        lp = topo.loop(loop)
        if lp and not lp.complete:
            d.append(
                Diagnostic(
                    code="ml10x.loop_not_cabled",
                    severity=Severity.WARNING,
                    message=f"Scene sets loop {loop} ({lp.name}) but it is not fully cabled; the loop state cannot have the intended effect.",
                    subject_type="scene",
                    subject_id=scene.id,
                    related_ids=[ml_inst.id],
                )
            )
        if preset is not None:
            if preset.mode == "advanced" and not gate.advanced_mode_cc_bypass:
                d.append(
                    Diagnostic(
                        code="ml10x.loop_cc_advanced_unsupported",
                        severity=Severity.ERROR,
                        message=f"Loop {loop} state cannot be set by CC while ML10X preset {preset.number} is in Advanced mode ({gate.note}). Save the loop state inside the preset in the Morningstar editor instead.",
                        subject_type="scene",
                        subject_id=scene.id,
                    )
                )
                continue
            if preset.mode == "simple" and loop not in preset.chain:
                d.append(
                    Diagnostic(
                        code="ml10x.loop_not_in_preset",
                        severity=Severity.WARNING,
                        message=f"Loop {loop} is not part of ML10X preset {preset.number}'s chain; the ML10X ignores loop CCs for loops outside the current preset.",
                        subject_type="scene",
                        subject_id=scene.id,
                    )
                )
        plan.messages.append(
            CompiledMessage(
                type="cc",
                channel=ch,
                number=specs.ML10X_CC_LOOP_ENGAGE_BASE + loop - 1,
                value=specs.ML10X_LOOP_ENGAGE_VALUE if engaged else specs.ML10X_LOOP_BYPASS_VALUE,
                target_instance_id=ml_inst.id,
                target_label=ml_inst.label,
                source_kind="ml10x_loop",
                scene_id=scene.id,
                explanation=f"{'Engage' if engaged else 'Bypass'} ML10X loop {loop} ({specs.ML10X_LOOP_NAMES[loop]}) via CC#{specs.ML10X_CC_LOOP_ENGAGE_BASE + loop - 1} (absolute value, Simple-mode presets).",
            )
        )


def _compile_program(
    scene: Scene, inst: DeviceInstance, prof: DeviceProfile, ch: int, program, plan: ScenePlan
) -> None:
    d = plan.diagnostics
    pcs = prof.midi.program_change
    if pcs.supported is False:
        d.append(
            Diagnostic(
                code="midi.pc_unsupported",
                severity=Severity.ERROR,
                message=f"'{inst.label}' does not respond to Program Change according to its profile.",
                subject_type="scene",
                subject_id=scene.id,
                related_ids=[inst.id],
            )
        )
        return
    if pcs.supported is None:
        d.append(
            Diagnostic(
                code="midi.pc_unverified",
                severity=Severity.WARNING,
                message=f"Program Change support for '{inst.label}' is unknown; the PC is compiled but unverified.",
                subject_type="scene",
                subject_id=scene.id,
                related_ids=[inst.id],
            )
        )
    lo = pcs.min if pcs.min is not None else 0
    hi = pcs.max if pcs.max is not None else 127
    if program.pc < lo or program.pc > hi:
        d.append(
            Diagnostic(
                code="midi.pc_out_of_range",
                severity=Severity.ERROR,
                message=f"PC {program.pc} is outside the documented range {lo}-{hi} for '{inst.label}'.",
                subject_type="scene",
                subject_id=scene.id,
                related_ids=[inst.id],
            )
        )
        return
    if (program.bank_msb is not None or program.bank_lsb is not None) and pcs.bank_select_supported is False:
        d.append(
            Diagnostic(
                code="midi.bank_select_unsupported",
                severity=Severity.ERROR,
                message=f"'{inst.label}' does not support Bank Select, but the scene specifies one.",
                subject_type="scene",
                subject_id=scene.id,
                related_ids=[inst.id],
            )
        )
        return
    if program.bank_msb is not None:
        plan.messages.append(
            CompiledMessage(
                type="cc",
                channel=ch,
                number=CC_BANK_MSB,
                value=program.bank_msb,
                target_instance_id=inst.id,
                target_label=inst.label,
                source_kind="device_bank",
                scene_id=scene.id,
                explanation=f"Bank Select MSB (CC#0) = {program.bank_msb} before the PC for {inst.label}.",
            )
        )
    if program.bank_lsb is not None:
        plan.messages.append(
            CompiledMessage(
                type="cc",
                channel=ch,
                number=CC_BANK_LSB,
                value=program.bank_lsb,
                target_instance_id=inst.id,
                target_label=inst.label,
                source_kind="device_bank",
                scene_id=scene.id,
                explanation=f"Bank Select LSB (CC#32) = {program.bank_lsb} before the PC for {inst.label}.",
            )
        )
    shown = program.pc + 1 if pcs.display_numbering == "one_based" else program.pc
    numbering = f" (shown as preset {shown} on the device)" if pcs.display_numbering == "one_based" else ""
    if program.command is not None:
        explanation = (
            f"Scene '{scene.name}' applies '{program.command.name}' on {inst.label}: PC {program.pc}{numbering}."
        )
    else:
        explanation = f"Scene '{scene.name}' recalls program {program.pc}{numbering} on {inst.label}."
    plan.messages.append(
        CompiledMessage(
            type="pc",
            channel=ch,
            number=program.pc,
            value=None,
            target_instance_id=inst.id,
            target_label=inst.label,
            source_kind="device_program",
            scene_id=scene.id,
            explanation=explanation,
        )
    )


def _compile_bypass(
    scene: Scene, inst: DeviceInstance, prof: DeviceProfile, ch: int, enabled: bool, plan: ScenePlan
) -> None:
    d = plan.diagnostics
    bp = prof.midi.bypass
    if bp.method != "cc" or bp.cc is None:
        plan.manual_steps.append(
            f"{inst.label}: set {'ENGAGED' if enabled else 'BYPASSED'} by hand (no documented MIDI bypass command)."
        )
        d.append(
            Diagnostic(
                code="midi.bypass_not_addressable",
                severity=Severity.WARNING,
                message=f"'{inst.label}' has no documented MIDI bypass command; added a manual step instead.",
                subject_type="scene",
                subject_id=scene.id,
                related_ids=[inst.id],
            )
        )
        return
    on_v = bp.on_value if bp.on_value is not None else 127
    off_v = bp.off_value if bp.off_value is not None else 0
    deterministic = bp.deterministic is not False
    if not deterministic:
        d.append(
            Diagnostic(
                code="midi.bypass_toggle",
                severity=Severity.WARNING,
                message=f"Bypass on '{inst.label}' is a toggle (result depends on the prior state); scene recall cannot be guaranteed from an unknown starting state.",
                subject_type="scene",
                subject_id=scene.id,
                related_ids=[inst.id],
            )
        )
    plan.messages.append(
        CompiledMessage(
            type="cc",
            channel=ch,
            number=bp.cc,
            value=on_v if enabled else off_v,
            target_instance_id=inst.id,
            target_label=inst.label,
            source_kind="device_bypass",
            scene_id=scene.id,
            deterministic=deterministic,
            explanation=f"{'Engage' if enabled else 'Bypass'} {inst.label} via CC#{bp.cc} = {on_v if enabled else off_v}"
            + (f" ({bp.note})" if bp.note else "")
            + ".",
        )
    )


# -------------------------------------------------------------------------- MC8 switch plan


@dataclass
class SwitchPlan:
    bank_number: int
    position: str
    short_name: str
    scene_id: str | None
    scene_name: str | None
    action: str
    messages: list[CompiledMessage]
    extra_messages: list[Mc8Message]
    manual_steps: list[str]
    diagnostics: list[Diagnostic]

    @property
    def message_count(self) -> int:
        return len(self.messages) + len(self.extra_messages)

    def as_dict(self) -> dict:
        return {
            "bank_number": self.bank_number,
            "position": self.position,
            "short_name": self.short_name,
            "scene_id": self.scene_id,
            "scene_name": self.scene_name,
            "action": self.action,
            "messages": [m.as_dict() for m in self.messages],
            "extra_messages": [m.model_dump(mode="json") for m in self.extra_messages],
            "manual_steps": self.manual_steps,
            "diagnostics": [x.model_dump(mode="json") for x in self.diagnostics],
            "message_count": self.message_count,
            "message_limit": specs.MC8_MESSAGES_PER_PRESET,
        }


def compile_rig(rig: Rig, profiles: dict[str, DeviceProfile], ctx: WiringContext) -> dict:
    """Compile every scene and the MC8 bank/switch plan. Deterministic for equal inputs."""
    scene_plans = {s.id: compile_scene(rig, s, profiles, ctx) for s in rig.scenes}
    mc8 = rig.controllers.mc8
    mc8_inst = rig.instance(mc8.instance_id) if mc8.instance_id else None
    rig_diags: list[Diagnostic] = []
    if mc8_inst is None and any(b.presets for b in mc8.banks):
        rig_diags.append(
            Diagnostic(
                code="mc8.not_assigned",
                severity=Severity.ERROR,
                message="Switch assignments exist but no MC8 instance is assigned in the controller settings.",
                subject_type="rig",
            )
        )
    if (
        mc8_inst is not None
        and profiles.get(mc8_inst.profile_id)
        and profiles[mc8_inst.profile_id].category != DeviceCategory.CONTROLLER
    ):
        rig_diags.append(
            Diagnostic(
                code="mc8.wrong_category",
                severity=Severity.WARNING,
                message=f"'{mc8_inst.label}' is assigned as the MC8 but its profile is not a controller.",
                subject_type="instance",
                subject_id=mc8_inst.id,
            )
        )
    banks_out = []
    seen_banks: set[int] = set()
    for bank in sorted(mc8.banks, key=lambda b: b.number):
        bdiags: list[Diagnostic] = []
        if bank.number < 1 or bank.number > specs.MC8_BANKS:
            bdiags.append(
                Diagnostic(
                    code="mc8.bank_out_of_range",
                    severity=Severity.ERROR,
                    message=f"Bank {bank.number} is outside 1-{specs.MC8_BANKS} on the MC8.",
                    subject_type="rig",
                )
            )
        if bank.number in seen_banks:
            bdiags.append(
                Diagnostic(
                    code="mc8.bank_duplicate",
                    severity=Severity.ERROR,
                    message=f"Bank {bank.number} is defined twice.",
                    subject_type="rig",
                )
            )
        seen_banks.add(bank.number)
        if len(bank.name) > specs.MC8_BANK_NAME_MAX:
            bdiags.append(
                Diagnostic(
                    code="mc8.bank_name_long",
                    severity=Severity.WARNING,
                    message=f"Bank name '{bank.name}' exceeds {specs.MC8_BANK_NAME_MAX} characters (limit observed in real exports, unverified).",
                    subject_type="rig",
                )
            )
        switches = []
        seen_pos: set[str] = set()
        for preset in sorted(bank.presets, key=lambda p: p.position):
            sdiags: list[Diagnostic] = []
            subj = f"{bank.number}:{preset.position}"
            if preset.position not in specs.MC8_POSITIONS:
                sdiags.append(
                    Diagnostic(
                        code="mc8.position_invalid",
                        severity=Severity.ERROR,
                        message=f"Position '{preset.position}' is not an MC8 preset (A-V).",
                        subject_type="switch",
                        subject_id=subj,
                    )
                )
            elif preset.position in specs.MC8_AUX_ONLY_POSITIONS:
                sdiags.append(
                    Diagnostic(
                        code="mc8.position_aux_only",
                        severity=Severity.WARNING,
                        message=f"Preset {preset.position} is only reachable with an external aux switch (footswitches cover A-P over two pages).",
                        subject_type="switch",
                        subject_id=subj,
                    )
                )
            elif preset.position in specs.MC8_FOOTSWITCH_POSITIONS[specs.MC8_FOOTSWITCHES :]:
                sdiags.append(
                    Diagnostic(
                        code="mc8.position_page2",
                        severity=Severity.INFO,
                        message=f"Preset {preset.position} lives on page 2 (toggle page with switches B+C, or a Toggle Page message).",
                        subject_type="switch",
                        subject_id=subj,
                    )
                )
            if preset.position in seen_pos:
                sdiags.append(
                    Diagnostic(
                        code="mc8.position_duplicate",
                        severity=Severity.ERROR,
                        message=f"Position {preset.position} is assigned twice in bank {bank.number}.",
                        subject_type="switch",
                        subject_id=subj,
                    )
                )
            seen_pos.add(preset.position)
            if preset.action not in specs.MC8_ACTIONS:
                sdiags.append(
                    Diagnostic(
                        code="mc8.action_invalid",
                        severity=Severity.ERROR,
                        message=f"Action '{preset.action}' is not an MC8 action type.",
                        subject_type="switch",
                        subject_id=subj,
                    )
                )
            if len(preset.short_name) > specs.MC8_SHORT_NAME_MAX:
                sdiags.append(
                    Diagnostic(
                        code="mc8.short_name_long",
                        severity=Severity.WARNING,
                        message=f"Short name '{preset.short_name}' exceeds {specs.MC8_SHORT_NAME_MAX} characters.",
                        subject_type="switch",
                        subject_id=subj,
                    )
                )
            if preset.toggle_name and len(preset.toggle_name) > specs.MC8_TOGGLE_NAME_MAX:
                sdiags.append(
                    Diagnostic(
                        code="mc8.toggle_name_long",
                        severity=Severity.WARNING,
                        message=f"Toggle name exceeds {specs.MC8_TOGGLE_NAME_MAX} characters (unverified limit).",
                        subject_type="switch",
                        subject_id=subj,
                    )
                )
            if preset.long_name and len(preset.long_name) > specs.MC8_LONG_NAME_MAX:
                sdiags.append(
                    Diagnostic(
                        code="mc8.long_name_long",
                        severity=Severity.WARNING,
                        message=f"Long name exceeds {specs.MC8_LONG_NAME_MAX} characters (unverified limit).",
                        subject_type="switch",
                        subject_id=subj,
                    )
                )
            if preset.toggle_mode and preset.scene_id:
                sdiags.append(
                    Diagnostic(
                        code="mc8.toggle_mode_with_scene",
                        severity=Severity.WARNING,
                        message="Scene recalls are absolute; Toggle Mode makes the second press send Pos 2 messages (none compiled here). Turn Toggle Mode off for scene switches.",
                        subject_type="switch",
                        subject_id=subj,
                    )
                )
            scene = rig.scene(preset.scene_id) if preset.scene_id else None
            msgs: list[CompiledMessage] = []
            manual: list[str] = []
            if preset.scene_id and scene is None:
                sdiags.append(
                    Diagnostic(
                        code="mc8.scene_missing",
                        severity=Severity.ERROR,
                        message=f"Switch {preset.position} refers to a scene that no longer exists.",
                        subject_type="switch",
                        subject_id=subj,
                    )
                )
            elif scene is not None:
                sp = scene_plans[scene.id]
                msgs = list(sp.messages)
                manual = list(sp.manual_steps)
                sdiags.extend(sp.diagnostics)
            for em in preset.extra_messages:
                if em.type not in ("pc", "cc"):
                    sdiags.append(
                        Diagnostic(
                            code="mc8.message_type_unsupported",
                            severity=Severity.ERROR,
                            message=f"Extra message type '{em.type}' is not compiled in this version (PC and CC only).",
                            subject_type="switch",
                            subject_id=subj,
                        )
                    )
                if em.channel is None:
                    sdiags.append(
                        Diagnostic(
                            code="midi.channel_unknown",
                            severity=Severity.ERROR,
                            message="Extra message has no MIDI channel.",
                            subject_type="switch",
                            subject_id=subj,
                        )
                    )
                if em.type == "cc" and em.value is None:
                    sdiags.append(
                        Diagnostic(
                            code="mc8.message_value_missing",
                            severity=Severity.ERROR,
                            message="CC extra message has no value.",
                            subject_type="switch",
                            subject_id=subj,
                        )
                    )
            total = len(msgs) + len(preset.extra_messages)
            if total > specs.MC8_MESSAGES_PER_PRESET:
                sdiags.append(
                    Diagnostic(
                        code="mc8.message_limit",
                        severity=Severity.ERROR,
                        message=f"Switch {preset.position} needs {total} messages but an MC8 preset holds at most {specs.MC8_MESSAGES_PER_PRESET}. Split the scene across two presets (Engage Preset) or reduce intents.",
                        subject_type="switch",
                        subject_id=subj,
                    )
                )
            if not msgs and not preset.extra_messages and not manual:
                sdiags.append(
                    Diagnostic(
                        code="mc8.switch_empty",
                        severity=Severity.INFO,
                        message=f"Switch {preset.position} sends nothing.",
                        subject_type="switch",
                        subject_id=subj,
                    )
                )
            switches.append(
                SwitchPlan(
                    bank_number=bank.number,
                    position=preset.position,
                    short_name=preset.short_name,
                    scene_id=scene.id if scene else None,
                    scene_name=scene.name if scene else None,
                    action=preset.action,
                    messages=msgs,
                    extra_messages=list(preset.extra_messages),
                    manual_steps=manual,
                    diagnostics=sdiags,
                )
            )
        banks_out.append(
            {
                "number": bank.number,
                "name": bank.name,
                "diagnostics": [x.model_dump(mode="json") for x in bdiags],
                "switches": [s.as_dict() for s in switches],
            }
        )
    unassigned = [s for s in rig.scenes if not any(p.scene_id == s.id for b in mc8.banks for p in b.presets)]
    for s in unassigned:
        rig_diags.append(
            Diagnostic(
                code="mc8.scene_unassigned",
                severity=Severity.INFO,
                message=f"Scene '{s.name}' is not assigned to any MC8 switch.",
                subject_type="scene",
                subject_id=s.id,
            )
        )
    return {
        "scenes": [scene_plans[s.id].as_dict() for s in sorted(rig.scenes, key=lambda s: (s.order, s.name))],
        "mc8": {
            "instance_id": mc8_inst.id if mc8_inst else None,
            "firmware_assumed": mc8.firmware_version or specs.MC8_FIRMWARE_ASSUMED,
            "limits": {
                "banks": specs.MC8_BANKS,
                "presets_per_bank": specs.MC8_SWITCH_PRESETS_PER_BANK,
                "messages_per_preset": specs.MC8_MESSAGES_PER_PRESET,
                "footswitch_positions": specs.MC8_FOOTSWITCH_POSITIONS,
            },
            "banks": banks_out,
        },
        "diagnostics": [x.model_dump(mode="json") for x in rig_diags],
    }
