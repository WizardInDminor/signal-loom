"""Post-review safety (PR #7 finding 1): what may change while a performance is running.

The engine resolves each destination (device, channel, CC, endpoint, route) when a performance
starts and keeps those templates for the session. Any change to the rig's MIDI addressing or to
the performing texture's destinations would leave the stream pointed at an obsolete address, so
such changes are **refused** (409 ``live.performing_locked``) while the performance runs, whatever
path they arrive through: the rig PUT, rig deletion, the MC8 bank import, and profile edits in the
catalog. Everything the musician is meant to do mid-performance stays allowed: macro base, LFO
on/off/depth/division, tempo, the texture's name/intent/notes/starting scene/function roles, other
textures, scenes, the MC8 plan, board geometry, device positions, labels, pictures, rig name.

The check and the save run under the live service's lock, so a save cannot slip between Start's
resolution and its first message.
"""

from __future__ import annotations

from ..models.rig import Rig
from ..models.texture import Texture


def _structural(texture: Texture) -> list:
    """The parts of a texture the engine snapshots at Start: macro identities and every mapping
    field. Base, LFO settings, tempo and descriptive fields are deliberately excluded."""
    return [(m.id, [d.model_dump(mode="json") for d in m.mappings]) for m in texture.macros]


def rig_mutation_conflicts(old: Rig, new: Rig, texture_id: str) -> list[str]:
    """Human-readable reasons why replacing ``old`` with ``new`` would invalidate a performance of
    ``texture_id``. Empty means the change is safe to apply while performing."""
    reasons: list[str] = []
    old_i = {i.id: i for i in old.instances}
    new_i = {i.id: i for i in new.instances}
    for iid in [*old_i, *[k for k in new_i if k not in old_i]]:
        a, b = old_i.get(iid), new_i.get(iid)
        if a is None and b is not None:
            reasons.append(f"device '{b.label}' was added")
        elif b is None and a is not None:
            reasons.append(f"device '{a.label}' was removed")
        elif a is not None and b is not None:
            if a.midi_channel != b.midi_channel:
                reasons.append(f"'{a.label}': MIDI channel {a.midi_channel} → {b.midi_channel}")
            if a.profile_id != b.profile_id:
                reasons.append(f"'{a.label}': device profile changed")
            if [p.model_dump(mode="json") for p in a.port_overrides] != [
                p.model_dump(mode="json") for p in b.port_overrides
            ] or a.removed_port_ids != b.removed_port_ids:
                reasons.append(f"'{a.label}': jacks changed")
    if [c.model_dump(mode="json") for c in old.connections] != [c.model_dump(mode="json") for c in new.connections]:
        reasons.append("cables changed")
    t_old, t_new = old.texture(texture_id), new.texture(texture_id)
    if t_old is not None and t_new is None:
        reasons.append(f"the performing texture '{t_old.name}' was removed")
    elif t_old is not None and t_new is not None and _structural(t_old) != _structural(t_new):
        reasons.append(f"the performing texture '{t_old.name}' changed its macros or destinations")
    return reasons
