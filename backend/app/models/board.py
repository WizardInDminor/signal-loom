"""Manufacturer pedalboards: the frame a rig's board *is*.

A spec records what is known about a commercial board (overall size, number of rails, whether a
supply can hang underneath and how much room it has) with the evidence for each figure. Where a
manufacturer does not publish a figure it stays unknown and the UI says "unverified"; nothing
here is inferred from a photograph or another model.
"""

from __future__ import annotations

from pydantic import Field

from .common import StrictModel
from .profile import Measure, Provenance


class PedalboardSpec(StrictModel):
    id: str
    manufacturer: str
    model: str
    # Overall dimensions including the frame. Depth is front-to-back as seen by the player.
    width: Measure = Field(default_factory=Measure)
    depth: Measure = Field(default_factory=Measure)
    height: Measure = Field(default_factory=Measure)
    # Rail layout. ``rails`` is a count; ``rail_pitch`` is centre-to-centre spacing. Rails are only
    # drawn when their geometry is known; a count alone is reported as text.
    rails: int | None = None
    rail_pitch: Measure = Field(default_factory=Measure)
    # Underside. None = not stated by the manufacturer.
    underside_mountable: bool | None = None
    underside_clearance: Measure = Field(default_factory=Measure)  # usable height under the rails
    open_front: bool | None = None
    mounting_notes: str | None = None
    # Third-party compatibility statements (e.g. a supply maker's bracket list), kept as text.
    compatible_brackets: list[str] = Field(default_factory=list)
    provenance: Provenance = Field(default_factory=Provenance)
    declared_unknowns: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)

    @property
    def display_name(self) -> str:
        return f"{self.manufacturer} {self.model}".strip()
