"""Texture review for the rig analysis: dangling references and ineligible destinations are
reported, never repaired or retargeted (charter §4)."""

from __future__ import annotations

from ..models.common import Diagnostic, Severity
from ..models.profile import DeviceProfile
from ..models.rig import Rig
from .eligibility import check_mapping, device_level_conflicts
from .evaluator import mapping_endpoints


def texture_review(rig: Rig, profiles: dict[str, DeviceProfile]) -> tuple[list[Diagnostic], dict]:
    """Diagnostics plus a per-texture report: for every mapping its eligibility and its values at
    macro 0 / ½ / 1 (the backend's numbers, which the UI prints)."""
    diags: list[Diagnostic] = []
    report: dict = {}
    for tex in rig.textures:
        entry: dict = {
            "id": tex.id,
            "name": tex.name,
            "base_scene_missing": False,
            "mappings": {},
            "eligible_devices": [],
        }
        if tex.base_scene_id and rig.scene(tex.base_scene_id) is None:
            entry["base_scene_missing"] = True
            diags.append(
                Diagnostic(
                    code="texture.scene_missing",
                    severity=Severity.WARNING,
                    message=f"Texture '{tex.name}' starts from scene '{tex.base_scene_id}', which no longer exists; pick a starting scene again or clear it.",
                    subject_type="texture",
                    subject_id=tex.id,
                )
            )
        devices: set[str] = set()
        conflicts = device_level_conflicts(tex, rig)
        reported: set[tuple[str, int]] = set()
        for macro in tex.macros:
            for m in macro.mappings:
                e = check_mapping(rig, profiles, m)
                entry["mappings"][m.id] = {
                    **e.as_dict(),
                    **mapping_endpoints(m),
                    "macro_id": macro.id,
                    "inverted": m.inverted,
                    "conflict": conflicts.get(m.id),
                }
                if m.id in conflicts and (m.instance_id, m.cc) not in reported:
                    reported.add((m.instance_id, m.cc))
                    others = [
                        d.id
                        for mac in tex.macros
                        for d in mac.mappings
                        if (d.instance_id, d.cc) == (m.instance_id, m.cc)
                    ]
                    diags.append(
                        Diagnostic(
                            code="texture.destination_conflict",
                            severity=Severity.WARNING,
                            message=f"Texture '{tex.name}': {conflicts[m.id]}. The texture cannot be performed until this is resolved; nothing is chosen for you.",
                            subject_type="texture",
                            subject_id=tex.id,
                            related_ids=[*others, m.instance_id],
                        )
                    )
                if rig.instance(m.instance_id) is None:
                    diags.append(
                        Diagnostic(
                            code="texture.instance_missing",
                            severity=Severity.WARNING,
                            message=f"Texture '{tex.name}', macro '{macro.name}': destination CC {m.cc} points at device '{m.instance_id}', which is not on the rig. It is kept as is and never retargeted; pick a device again or remove it.",
                            subject_type="texture",
                            subject_id=tex.id,
                            related_ids=[m.id],
                        )
                    )
                elif not e.eligible and m.enabled:
                    diags.append(
                        Diagnostic(
                            code="texture.mapping_ineligible",
                            severity=Severity.WARNING,
                            message=f"Texture '{tex.name}', macro '{macro.name}': CC {m.cc} on '{e.instance_label}' cannot be swept — {e.reason}",
                            subject_type="texture",
                            subject_id=tex.id,
                            related_ids=[m.id, m.instance_id],
                        )
                    )
                elif e.eligible and m.enabled:
                    devices.add(m.instance_id)
                    if e.basis == "user_declared":
                        diags.append(
                            Diagnostic(
                                code="texture.mapping_user_declared",
                                severity=Severity.INFO,
                                message=f"Texture '{tex.name}': CC {m.cc} on '{e.instance_label}' is swept on your own declaration (“{m.override_note}”), not on documentation.",
                                subject_type="texture",
                                subject_id=tex.id,
                                related_ids=[m.id, m.instance_id],
                            )
                        )
        entry["eligible_devices"] = sorted(devices)
        report[tex.id] = entry
    return diags, report
