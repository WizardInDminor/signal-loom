"""Textures: the first-class *musical idea* of the whole-rig instrument (Session 5).

A texture names a sonic intention, optionally starts from a Scene, carries a tempo, and holds
playable macros. A macro has a base value in [0, 1] and routes to destination mappings: one CC on
one placed device each, with an authored output range (reversed = inverse gesture) and, at most,
one triangle LFO per macro in this session.

Everything here is *authored intent* that travels with the rig document (saved, exported,
duplicated, imported under the same ids). Nothing here is performance state: the current phase,
lease, counters and last-commanded values live only in the backend engine (``app.live.performance``)
and are never written into a rig.

A mapping references a device *instance id* and a CC number. Whether that CC may actually be swept
continuously is not stored here as a fact; it is decided by ``app.instrument.eligibility`` from
the device profile (``CcDef.continuous``) or from the user's explicit override, which is recorded on
the mapping with its note so the provenance is visible.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from .common import StrictModel, new_id

TEMPO_MIN_BPM = 20.0
TEMPO_MAX_BPM = 300.0
BEATS_PER_CYCLE_MIN = 0.25
BEATS_PER_CYCLE_MAX = 64.0

LfoShape = Literal["triangle"]
TextureOrigin = Literal["user", "virtual_fixture"]

# Musical functions a device can serve in a texture's grouping. An organisational lens, never a
# signal-flow claim; the user can relabel any device per texture.
FUNCTION_ROLES: tuple[str, ...] = (
    "drive",
    "dynamics",
    "pitch",
    "modulation",
    "delay",
    "space",
    "routing",
    "other",
)


class Lfo(StrictModel):
    """One tempo-related low-frequency oscillator on a macro. Period = beats_per_cycle × 60 / BPM."""

    enabled: bool = False
    shape: LfoShape = "triangle"
    beats_per_cycle: float = Field(default=8.0, ge=BEATS_PER_CYCLE_MIN, le=BEATS_PER_CYCLE_MAX)
    depth: float = Field(default=0.0, ge=0.0, le=1.0)


class Mapping(StrictModel):
    """A macro destination: one CC on one placed device, scaled into an authored range.

    ``output_min > output_max`` is intentional and means the value falls as the macro rises.
    ``user_override`` is the user's explicit claim that this CC is safe to sweep continuously on
    this device even though the profile does not document it as continuous; it requires a note and
    is always shown with a warning. It never bypasses the hard exclusions (bank select, channel
    mode, bypass/toggle controls)."""

    id: str = Field(default_factory=lambda: new_id("map"))
    instance_id: str
    cc: int = Field(ge=0, le=127)
    output_min: int = Field(default=0, ge=0, le=127)
    output_max: int = Field(default=127, ge=0, le=127)
    label: str | None = Field(default=None, max_length=80)
    enabled: bool = True
    user_override: bool = False
    override_note: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _override_needs_a_note(self) -> Mapping:
        if self.user_override and not (self.override_note or "").strip():
            raise ValueError("a user override needs a note saying why this control is safe to sweep on this device")
        return self

    @property
    def inverted(self) -> bool:
        return self.output_min > self.output_max


class Macro(StrictModel):
    id: str = Field(default_factory=lambda: new_id("macro"))
    name: str = Field(default="Macro", min_length=1, max_length=60)
    base: float = Field(default=0.0, ge=0.0, le=1.0)
    mappings: list[Mapping] = Field(default_factory=list)
    lfo: Lfo = Field(default_factory=Lfo)

    @model_validator(mode="after")
    def _unique_mapping_ids(self) -> Macro:
        ids = [m.id for m in self.mappings]
        if len(set(ids)) != len(ids):
            raise ValueError("mapping ids must be unique within a macro")
        return self


class Texture(StrictModel):
    id: str = Field(default_factory=lambda: new_id("tex"))
    name: str = Field(min_length=1, max_length=120)
    intent: str | None = Field(default=None, max_length=500)  # the sonic idea in the musician's words
    notes: str | None = None
    base_scene_id: str | None = None  # the Scene the texture assumes as its starting point
    tempo_bpm: float = Field(default=90.0, ge=TEMPO_MIN_BPM, le=TEMPO_MAX_BPM)
    macros: list[Macro] = Field(default_factory=list)
    # Per-texture relabelling of what each device *does* in this idea (instance id → role).
    function_roles: dict[str, str] = Field(default_factory=dict)
    origin: TextureOrigin = "user"
    created_at: str | None = None
    updated_at: str | None = None

    @model_validator(mode="after")
    def _unique_macro_ids(self) -> Texture:
        ids = [m.id for m in self.macros]
        if len(set(ids)) != len(ids):
            raise ValueError("macro ids must be unique within a texture")
        for inst_id, role in self.function_roles.items():
            if role not in FUNCTION_ROLES:
                raise ValueError(f"unknown function role '{role}' for {inst_id}; one of {', '.join(FUNCTION_ROLES)}")
        return self

    def macro(self, macro_id: str) -> Macro | None:
        for m in self.macros:
            if m.id == macro_id:
                return m
        return None

    def mapping(self, mapping_id: str) -> tuple[Macro, Mapping] | None:
        for m in self.macros:
            for d in m.mappings:
                if d.id == mapping_id:
                    return m, d
        return None
