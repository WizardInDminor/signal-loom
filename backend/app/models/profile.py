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
    # Is this a continuously variable, repeatable control (a knob or expression-style sweep over
    # 0–127 with the same result for the same value)? True = documented so; False = documented as
    # discrete (a switch, a bank select, a trigger); None = not stated. Only True makes the control
    # eligible for continuous modulation (Session 5); a profile that says nothing promotes nothing.
    continuous: bool | None = None


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


DOCUMENT_ID_PATTERN = r"^doc_[0-9a-f]{12}$"
COMMAND_ID_PATTERN = r"^cmd_[A-Za-z0-9_-]{1,40}$"

DocumentKind = Literal["manual", "quick_start", "midi_chart", "other"]
CommandKind = Literal["cc", "pc"]
ValueMode = Literal["fixed", "choice", "any"]
CommandIntent = Literal["engage", "bypass", "set", "toggle", "recall", "other"]


class DocumentRef(StrictModel):
    """A user-supplied PDF attached to a profile. The bytes live in the managed document store
    (``app.documents``) under ``document_id``; the profile only carries this reference and the
    user's own title for it, so a profile JSON never contains a manual and a project file never
    does unless the user opts in."""

    document_id: str = Field(pattern=DOCUMENT_ID_PATTERN)
    title: str = Field(min_length=1, max_length=120)
    kind: DocumentKind = "manual"
    note: str | None = None


class ValueChoice(StrictModel):
    """One documented meaning of a CC value ("0 = bypass", "127 = engage")."""

    value: int = Field(ge=0, le=127)
    label: str = Field(min_length=1, max_length=60)


class CommandCitation(StrictModel):
    """Where in an attached document the command is described. Attaching a citation makes the
    command *documented*; it never makes it hardware-verified."""

    document_id: str = Field(pattern=DOCUMENT_ID_PATTERN)
    page: int | None = Field(default=None, ge=1)
    note: str | None = None  # e.g. "MIDI implementation chart, row 'Bypass'"


class MidiCommand(StrictModel):
    """A named, reusable MIDI command of a device: one CC or one PC with its meaningful values.

    This is the user-facing library the Scene editor picks from. It lives beside the documented
    ``cc_map``/``program_change``/``bypass`` facts, which stay the reference the compiler checks
    numbers against; ``commands_from_midi_spec`` (``app.domain.commands``) derives starter
    commands from those facts, copying their evidence. The MIDI channel is never part of a
    command: it comes from the placed instance when the command is applied.

    Evidence is a statement about where the numbers come from (``documented`` with a citation,
    ``third_party``, ``user`` from memory, ``unknown``); ``verified_on_hardware`` is a separate,
    explicit claim by the user that they tried it on the device.
    """

    id: str = Field(pattern=COMMAND_ID_PATTERN)
    name: str = Field(min_length=1, max_length=80)
    category: str | None = Field(default=None, max_length=40)
    tags: list[str] = Field(default_factory=list)
    description: str | None = None
    favorite: bool = False
    kind: CommandKind
    # CC: the controller number and how its value is chosen. "fixed" sends ``value``; "choice"
    # offers ``choices`` (value → meaning) and the user picks one when applying; "any" asks for a
    # number (0–127) when applying, with ``value`` as an optional suggestion.
    cc: int | None = Field(default=None, ge=0, le=127)
    value_mode: ValueMode = "fixed"
    value: int | None = Field(default=None, ge=0, le=127)
    choices: list[ValueChoice] = Field(default_factory=list)
    # PC: the number on the wire (0–127) and an optional bank. The device's displayed preset
    # number follows the profile's ``program_change.display_numbering``; it is not stored here.
    pc: int | None = Field(default=None, ge=0, le=127)
    bank_msb: int | None = Field(default=None, ge=0, le=127)
    bank_lsb: int | None = Field(default=None, ge=0, le=127)
    intent: CommandIntent | None = None
    # True = the result does not depend on the device's prior state; False = toggle-like;
    # None = not known.
    deterministic: bool | None = None
    evidence: Evidence = Evidence.USER
    citation: CommandCitation | None = None
    verified_on_hardware: bool = False
    note: str | None = None

    @model_validator(mode="after")
    def _consistent(self) -> MidiCommand:
        if self.kind == "cc":
            if self.cc is None:
                raise ValueError("a CC command needs a controller number (0-127)")
            if self.pc is not None or self.bank_msb is not None or self.bank_lsb is not None:
                raise ValueError("a CC command cannot carry a program or bank number")
            if self.value_mode == "fixed" and self.value is None:
                raise ValueError(
                    "a fixed CC command needs its value (0-127); use value_mode 'any' if the value is chosen later"
                )
            if self.value_mode == "choice":
                if not self.choices:
                    raise ValueError("a CC command with selectable values needs at least one choice")
                vals = [c.value for c in self.choices]
                if len(set(vals)) != len(vals):
                    raise ValueError("choice values must be distinct")
        else:
            if self.pc is None:
                raise ValueError("a PC command needs the program number as sent on the wire (0-127)")
            if self.cc is not None or self.value is not None or self.choices:
                raise ValueError("a PC command cannot carry CC data")
        if self.intent == "toggle" and self.deterministic is True:
            raise ValueError("a toggle command cannot be deterministic: its result depends on the device's prior state")
        if self.intent == "toggle" and self.deterministic is None:
            self.deterministic = False
        return self

    def fingerprint(self) -> str:
        """The wire-relevant definition as a canonical string. Stored on a scene value when the
        command is applied and compared later: equal strings mean reapplying would send the same
        bytes; a difference is surfaced as a review warning, never as silently changed output.
        Names, descriptions, favorites, tags, evidence and citations are deliberately excluded."""
        if self.kind == "cc":
            if self.value_mode == "fixed":
                val = str(self.value)
            elif self.value_mode == "choice":
                val = (
                    "choice["
                    + ",".join(f"{c.value}={c.label}" for c in sorted(self.choices, key=lambda c: c.value))
                    + "]"
                )
            else:
                val = "any"
            core = f"cc {self.cc} {val}"
        else:
            core = f"pc {self.pc} bank {self.bank_msb if self.bank_msb is not None else '-'}/{self.bank_lsb if self.bank_lsb is not None else '-'}"
        det = "yes" if self.deterministic is True else "no" if self.deterministic is False else "unknown"
        return f"{core} intent={self.intent or '-'} deterministic={det}"

    def wire_summary(self) -> str:
        if self.kind == "cc":
            if self.value_mode == "fixed":
                return f"CC {self.cc} = {self.value}"
            if self.value_mode == "choice":
                return f"CC {self.cc} = " + " | ".join(f"{c.value} ({c.label})" for c in self.choices)
            return f"CC {self.cc} = <value>"
        bank = ""
        if self.bank_msb is not None or self.bank_lsb is not None:
            bank = f" (bank MSB {self.bank_msb if self.bank_msb is not None else '-'} / LSB {self.bank_lsb if self.bank_lsb is not None else '-'})"
        return f"PC {self.pc}{bank}"


class MidiSpec(StrictModel):
    interfaces: list[str] = Field(default_factory=list)  # "din_in", "trs_in", "usb", ...
    default_channel: int | None = Field(default=None, ge=1, le=16)
    channel_configurable: bool | None = None
    program_change: ProgramChangeSpec = Field(default_factory=ProgramChangeSpec)
    cc_map: list[CcDef] = Field(default_factory=list)
    bypass: BypassSpec = Field(default_factory=BypassSpec)
    # The user's named command library (see ``MidiCommand``). Empty on every profile saved before it existed.
    commands: list[MidiCommand] = Field(default_factory=list)
    source_url: str | None = None
    evidence: Evidence = Evidence.UNKNOWN
    note: str | None = None

    @model_validator(mode="after")
    def _unique_command_ids(self) -> MidiSpec:
        ids = [c.id for c in self.commands]
        if len(set(ids)) != len(ids):
            raise ValueError("command ids must be unique within a profile")
        return self

    def command(self, command_id: str) -> MidiCommand | None:
        for c in self.commands:
            if c.id == command_id:
                return c
        return None


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
    # User-supplied PDF documents (manuals, quick-start guides, MIDI charts) by reference only.
    documents: list[DocumentRef] = Field(default_factory=list)
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

    def document(self, document_id: str) -> DocumentRef | None:
        for d in self.documents:
            if d.document_id == document_id:
                return d
        return None

    def document_ids(self) -> list[str]:
        """Every document this profile relies on: attached files and command citations (deduplicated)."""
        ids = [d.document_id for d in self.documents]
        ids += [c.citation.document_id for c in self.midi.commands if c.citation]
        seen: set[str] = set()
        out: list[str] = []
        for i in ids:
            if i not in seen:
                seen.add(i)
                out.append(i)
        return out

    @model_validator(mode="after")
    def _unique_documents(self) -> DeviceProfile:
        ids = [d.document_id for d in self.documents]
        if len(set(ids)) != len(ids):
            raise ValueError("a document can be attached to a profile only once")
        return self

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
