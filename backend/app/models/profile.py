"""Device profiles: the *definition* side of definitions-versus-instances."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import Field, model_validator

from .common import (
    AudioChannel,
    Connector,
    DeviceCategory,
    Edge,
    Evidence,
    MidiTrsType,
    Polarity,
    PortDirection,
    SignalKind,
    StrictModel,
    TrsRole,
)


class Measure(StrictModel):
    """A physical measurement in millimetres with provenance. ``value`` None = unknown."""

    value_mm: float | None = None
    evidence: Evidence = Evidence.UNKNOWN
    note: str | None = None


class Footprint(StrictModel):
    width: Measure = Field(default_factory=Measure)
    depth: Measure = Field(default_factory=Measure)
    height: Measure = Field(default_factory=Measure)
    includes_jacks: bool | None = None  # None = not stated by the source
    display_unit: str = "mm"

    @property
    def is_known(self) -> bool:
        return self.width.value_mm is not None and self.depth.value_mm is not None


class ImageAnchor(StrictModel):
    """Where a connector *appears* in the device's photograph: a normalized point (0–1) in the
    stored, orientation-corrected image, which may lie outside the enclosure crop (a protruding
    plug). This is a visual annotation only; wiring geometry comes from ``edge``/``position``.
    ``asset_id`` records which picture the point was placed on, so a replaced photograph can be
    flagged for reconciliation instead of silently misplacing markers."""

    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    asset_id: str = Field(pattern=r"^img_[0-9a-f]{12}$")


class SupplyOption(StrictModel):
    """One setting of a selectable power outlet: the voltage and what the outlet can deliver at it."""

    voltage_v: float = Field(gt=0)
    current_ma_max: int | None = Field(default=None, ge=0)  # None = not published at this setting
    note: str | None = None


class PortDef(StrictModel):
    """A physical connector on a device, in the device's own (unrotated) frame."""

    id: str
    label: str
    kind: SignalKind
    direction: PortDirection
    # Provenance of this connector's description (what it is, not where it is). None = not
    # stated separately, i.e. it shares the profile's provenance (hand-authored builtins);
    # "user" marks connections the user added or edited themselves.
    evidence: Evidence | None = None
    image_anchor: ImageAnchor | None = None
    connector: Connector = Connector.UNKNOWN
    audio_channel: AudioChannel | None = None
    trs_role: TrsRole | None = None
    midi_trs_type: MidiTrsType | None = None
    edge: Edge = Edge.TOP
    # Normalized position along the edge, 0..1 (left->right for top/bottom, top->bottom for
    # left/right). None means "unknown"; the UI then spreads unknown ports evenly and labels
    # them as estimates.
    position: float | None = Field(default=None, ge=0.0, le=1.0)
    position_evidence: Evidence = Evidence.UNKNOWN
    # Extra clearance required beyond the chassis for the plug (straight plug ~ 35-45 mm,
    # pancake ~ 20 mm). None = unknown.
    plug_clearance_mm: float | None = None
    # Inputs are exclusive by default: only one cable may feed them.
    exclusive: bool | None = None
    # Group id that pairs L/R jacks (e.g. "in", "out") so stereo pairing can be validated.
    pair_group: str | None = None
    # Semantic role, used by topology logic: "main_in", "main_out", "loop_send", "loop_return",
    # "thru", "supply_out", "supply_in", "exp_in", "exp_out", "controller_out". None = generic.
    role: str | None = None
    loop: int | None = None  # for loop_send / loop_return on a switcher
    # For power supply outputs: what the outlet provides (None = unknown). ``supply_voltage_v`` and
    # ``supply_current_ma_max`` describe a fixed outlet, or the factory/default setting of a
    # selectable one whose other settings are listed in ``supply_options`` (the rig picks one per
    # outlet in ``DeviceInstance.supply_settings``). ``role = "expansion_out"`` marks a jack that
    # feeds another supply (Strymon's 24 V Ojai link), never a pedal.
    supply_voltage_v: float | None = None
    supply_polarity: Polarity | None = None
    supply_current_ma_max: int | None = None
    supply_ac_dc: Literal["dc", "ac"] | None = None
    supply_options: list[SupplyOption] = Field(default_factory=list)
    # Electrically isolated from the supply's other outlets? None = not documented. Outlets that share
    # a regulator or ground carry the same ``supply_shared_group`` label.
    supply_isolated: bool | None = None
    supply_shared_group: str | None = None
    notes: str | None = None

    def is_exclusive(self) -> bool:
        if self.exclusive is not None:
            return self.exclusive
        return self.direction == PortDirection.IN


class PowerSpec(StrictModel):
    """What a device needs from a supply. ``current_ma_min`` is the manufacturer's documented
    minimum (what they ask a supply to provide), not a measured draw."""

    voltage_v: float | None = None
    # Upper end of an accepted range (e.g. 9-18 V); None = ``voltage_v`` only.
    voltage_max_v: float | None = None
    polarity: Polarity = Polarity.UNKNOWN
    ac_dc: str | None = None  # "dc" | "ac" | None
    current_ma_min: int | None = None
    connector: Connector = Connector.UNKNOWN
    evidence: Evidence = Evidence.UNKNOWN
    note: str | None = None


class CcDef(StrictModel):
    cc: int = Field(ge=0, le=127)
    name: str
    value_semantics: str | None = None  # e.g. "0-63 bypass, 64-127 engage"
    evidence: Evidence = Evidence.UNKNOWN


class ProgramChangeSpec(StrictModel):
    supported: bool | None = None
    min: int | None = None  # as transmitted on the wire (0-127)
    max: int | None = None
    # How the device's own manual/display numbers presets: "one_based" (PC 0 = preset 1),
    # "zero_based", or None for unknown.
    display_numbering: str | None = None
    bank_select_supported: bool | None = None
    note: str | None = None
    evidence: Evidence = Evidence.UNKNOWN


class BypassSpec(StrictModel):
    method: str | None = None  # "cc" | "footswitch_only" | "pc_preset" | None
    cc: int | None = None
    on_value: int | None = None
    off_value: int | None = None
    deterministic: bool | None = None  # True = absolute on/off values, False = toggle
    evidence: Evidence = Evidence.UNKNOWN
    note: str | None = None


class MidiSpec(StrictModel):
    interfaces: list[str] = Field(default_factory=list)  # "din_in", "trs_in", "usb", ...
    default_channel: int | None = Field(default=None, ge=1, le=16)
    channel_configurable: bool | None = None
    program_change: ProgramChangeSpec = Field(default_factory=ProgramChangeSpec)
    cc_map: list[CcDef] = Field(default_factory=list)
    bypass: BypassSpec = Field(default_factory=BypassSpec)
    source_url: str | None = None
    evidence: Evidence = Evidence.UNKNOWN
    note: str | None = None


class Capabilities(StrictModel):
    bypass_method: str | None = None
    patch_selection: str | None = None  # "pc", "none", "footswitch", ...
    params_via_midi: bool | None = None
    is_stereo: bool | None = None
    notes: str | None = None


class ImageCrop(StrictModel):
    """Normalized selection (0–1) in the stored, orientation-corrected image: the enclosure."""

    x: float = Field(default=0.0, ge=0.0, le=1.0)
    y: float = Field(default=0.0, ge=0.0, le=1.0)
    w: float = Field(default=1.0, gt=0.0, le=1.0)
    h: float = Field(default=1.0, gt=0.0, le=1.0)

    @model_validator(mode="after")
    def _inside(self) -> ImageCrop:
        if self.x + self.w > 1.0 + 1e-6 or self.y + self.h > 1.0 + 1e-6:
            raise ValueError("crop must lie inside the image")
        return self


class DeviceImage(StrictModel):
    """A user photograph fitted to a device's physical footprint.

    The footprint (width × depth, with its own evidence level) stays the source of truth; the
    image is a visual overlay. ``crop`` says which part of the photograph *is* the enclosure,
    ``rotation_quarter`` turns that part so its top edge matches the device's top edge,
    ``fit`` says what to do when the selection's proportions differ from the footprint
    (``contain``: whole selection visible, margins show the enclosure colour; ``cover``: the
    selection fills the footprint and its overhang is clipped). ``calibrated`` is true only when
    the selection was made against a known width and depth; it is a statement about the
    workflow, never about the measurements' evidence.
    """

    asset_id: str = Field(pattern=r"^img_[0-9a-f]{12}$")
    crop: ImageCrop = Field(default_factory=ImageCrop)
    rotation_quarter: int = Field(default=0, ge=0, le=3)
    fit: Literal["contain", "cover"] = "contain"
    calibrated: bool = False
    note: str | None = None


class Provenance(StrictModel):
    source: str = "hand_authored"  # "hand_authored" | "pedalplayground_import" | "user"
    url: str | None = None
    evidence: Evidence = Evidence.UNKNOWN
    license: str | None = None
    attribution: str | None = None
    retrieved: str | None = None


# A declared unknown that is about the jack list itself ("ports (not in dataset)", "jacks").
_PORTS_UNKNOWN = re.compile(r"^\s*(ports?|jacks?|connectors?)\b", re.IGNORECASE)


class DeviceProfile(StrictModel):
    id: str
    manufacturer: str
    model: str
    category: DeviceCategory = DeviceCategory.EFFECT
    revision: str | None = None
    image_ref: str | None = None  # legacy free-text reference; the structured image lives in ``image``
    image: DeviceImage | None = None
    provenance: Provenance = Field(default_factory=Provenance)
    footprint: Footprint = Field(default_factory=Footprint)
    ports: list[PortDef] = Field(default_factory=list)
    power: PowerSpec = Field(default_factory=PowerSpec)
    midi: MidiSpec = Field(default_factory=MidiSpec)
    capabilities: Capabilities = Field(default_factory=Capabilities)
    # Free-form attributes the profile author explicitly declares unknown, so the UI can
    # surface them instead of silently showing blanks.
    declared_unknowns: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    notes: str | None = None
    builtin: bool = False

    @property
    def display_name(self) -> str:
        return f"{self.manufacturer} {self.model}".strip()

    def port(self, port_id: str) -> PortDef | None:
        for p in self.ports:
            if p.id == port_id:
                return p
        return None

    def reconcile_declared_unknowns(self) -> None:
        """Drop a declared "ports unknown" marker once the profile actually has jacks.

        Importers declare e.g. ``"ports (not in dataset)"``; after the user maps the jacks that
        claim is simply false, while separately declared power/MIDI facts stay unknown until
        they are stated. Only the ports marker is touched."""
        if self.ports:
            self.declared_unknowns = [u for u in self.declared_unknowns if not _PORTS_UNKNOWN.match(u)]

    def unknowns(self) -> list[str]:
        """Compute the list of attributes that are unknown, for honest UI display."""
        out: list[str] = list(self.declared_unknowns)
        if self.footprint.width.value_mm is None or self.footprint.depth.value_mm is None:
            out.append("footprint")
        needs_power = any(p.kind == SignalKind.POWER and p.direction == PortDirection.IN for p in self.ports)
        if needs_power:
            if self.power.voltage_v is None:
                out.append("power.voltage")
            if self.power.polarity == Polarity.UNKNOWN:
                out.append("power.polarity")
            if self.power.current_ma_min is None:
                out.append("power.current")
        for p in self.ports:
            if p.position is None:
                out.append(f"port.{p.id}.position")
        if self.midi.interfaces and self.midi.program_change.supported is None:
            out.append("midi.program_change")
        # de-duplicate, keep order
        seen: set[str] = set()
        uniq: list[str] = []
        for u in out:
            if u not in seen:
                seen.add(u)
                uniq.append(u)
        return uniq
