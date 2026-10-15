"""Import adapter for the Pedal Playground catalog format (user-supplied file, never bundled).

Format (verified 2026-10-15 from the public repo): a JSON array of objects with keys
``Brand``, ``Name``, ``Width``, ``Height``, ``Image``; dimensions in inches; ``Height`` is the
top-down depth; jack inclusion is inconsistent. No license accompanies the data, so Signal
Loom only reads a copy the user provides and records the provenance on every imported profile.
"""

from __future__ import annotations

import re
from typing import Any

from ..models.common import DeviceCategory, Evidence
from ..models.profile import DeviceProfile, Footprint, Measure, MidiSpec, PowerSpec, Provenance

IN_TO_MM = 25.4
MAX_RECORDS = 20000


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def parse_pedalplayground(
    payload: Any, *, source_label: str = "pedalplayground_import"
) -> tuple[list[DeviceProfile], list[str]]:
    """Defensively convert a Pedal Playground array into profiles. Returns (profiles, problems)."""
    problems: list[str] = []
    if not isinstance(payload, list):
        return [], ["Expected a JSON array of pedal records."]
    if len(payload) > MAX_RECORDS:
        return [], [f"File has {len(payload)} records; refusing more than {MAX_RECORDS}."]
    out: list[DeviceProfile] = []
    seen: set[str] = set()
    for i, rec in enumerate(payload):
        if not isinstance(rec, dict):
            problems.append(f"record {i}: not an object")
            continue
        brand = rec.get("Brand")
        name = rec.get("Name")
        w = rec.get("Width")
        h = rec.get("Height")
        if not isinstance(brand, str) or not isinstance(name, str) or not brand.strip() or not name.strip():
            problems.append(f"record {i}: missing Brand/Name")
            continue
        if not isinstance(w, int | float) or not isinstance(h, int | float) or w <= 0 or h <= 0 or w > 100 or h > 100:
            problems.append(f"record {i} ({brand} {name}): Width/Height must be positive inches")
            continue
        pid = f"pp-{slug(brand)}-{slug(name)}"
        if pid in seen:
            problems.append(f"record {i}: duplicate id {pid}, skipped")
            continue
        seen.add(pid)
        out.append(
            DeviceProfile(
                id=pid,
                manufacturer=brand.strip(),
                model=name.strip(),
                category=DeviceCategory.EFFECT,
                provenance=Provenance(
                    source=source_label,
                    url="https://github.com/PedalPlayground/pedalplayground",
                    evidence=Evidence.THIRD_PARTY,
                    license="none published (user-supplied copy; not redistributed by Signal Loom)",
                    attribution="Pedal Playground (Travis Lehman)",
                ),
                footprint=Footprint(
                    width=Measure(
                        value_mm=round(float(w) * IN_TO_MM, 1),
                        evidence=Evidence.THIRD_PARTY,
                        note=f"{w} in (Pedal Playground)",
                    ),
                    depth=Measure(
                        value_mm=round(float(h) * IN_TO_MM, 1),
                        evidence=Evidence.THIRD_PARTY,
                        note=f"{h} in top-down depth (Pedal Playground)",
                    ),
                    height=Measure(),
                    includes_jacks=None,
                ),
                ports=[],
                power=PowerSpec(),
                midi=MidiSpec(),
                declared_unknowns=[
                    "ports (not in dataset)",
                    "power (not in dataset)",
                    "MIDI (not in dataset)",
                    "whether dimensions include jacks",
                ],
                tags=["imported", "pedalplayground"],
                image_ref=None,  # images are not licensed for reuse; never reference them
            )
        )
    return out, problems
