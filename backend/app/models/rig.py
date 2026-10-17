"""The rig document: one persistent model viewed as board, wiring, scenes and controller plan."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import Field, model_validator

from .common import Rotation, SignalKind, StrictModel, new_id
from .profile import DeviceImage, PortDef

# Where a device is mounted. "top": on the board's upper surface; "underside": under the board,
# in the same x/y coordinate system seen through the board from above (not mirrored);
# "off_board": not on the board at all (guitar, amp, a supply on the floor).
Surface = Literal["top", "underside", "off_board"]

PROJECT_FORMAT = "signal-loom-project"
PROJECT_FORMAT_VERSION = 1  # plain project files
PROJECT_FORMAT_VERSION_WITH_ASSETS = 2  # opt-in: image assets bundled (base64) inside the file
PROJECT_FORMAT_VERSION_WITH_DOCUMENTS = 3  # opt-in: PDF documents bundled (base64) as well


def utcnow_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


class Board(StrictModel):
    name: str = "Board"
    width_mm: float = Field(default=600.0, gt=0)
    depth_mm: float = Field(default=300.0, gt=0)
    grid_mm: float = Field(default=5.0, gt=0)
    # Manufacturer pedalboard this board is (catalog id, see ``catalog/boards.py``); None = custom.
    model_id: str | None = None
    # Usable height under the board as the user measured or found it. Takes precedence over the
    # catalog's figure; None = not stated (the catalog's value is used when it has one).
    underside_clearance_mm: float | None = Field(default=None, gt=0)
    underside_clearance_note: str | None = None
    notes: str | None = None


class DeviceInstance(StrictModel):
    """A placed device. Placement, addressing and port overrides belong here, not on profiles."""

    id: str = Field(default_factory=lambda: new_id("inst"))
    profile_id: str
    label: str
    x_mm: float = 0.0  # top-left of the *rotated* bounding box, board coordinates
    y_mm: float = 0.0
    rotation: Rotation = 0
    intentional_overlap: bool = False  # user accepts overlapping/stacking this device
    # Legacy flag kept for every rig saved before mounting surfaces existed: True meant "guitar, amp,
    # or a supply drawn beside the board". It is never rewritten by loading; ``surface`` refines it.
    off_board: bool = False
    # Mounting surface. None = not stated (older rig): derived from ``off_board`` by ``mount``.
    surface: Surface | None = None
    midi_channel: int | None = Field(default=None, ge=1, le=16)
    # Overrides/additions of ports by id. A port with an id that exists on the profile
    # replaces it; a new id adds a user-defined jack. Removed ids hide profile ports.
    port_overrides: list[PortDef] = Field(default_factory=list)
    removed_port_ids: list[str] = Field(default_factory=list)
    # For a power supply with selectable outlets: the voltage chosen per outlet (port id -> V).
    # Must be one of the outlet's ``supply_options``; the outlet's current capacity follows it.
    supply_settings: dict[str, float] = Field(default_factory=dict)
    # Optional picture for this particular unit (a repainted or customised pedal). When unset the
    # profile's image is used. Never affects geometry.
    image: DeviceImage | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _surface_and_flag_agree(self) -> DeviceInstance:
        # An explicit surface is the user's statement; the legacy flag follows it so code that still
        # reads ``off_board`` sees the same fact. A missing surface leaves the flag exactly as saved.
        if self.surface is not None:
            want = self.surface == "off_board"
            if self.off_board != want:  # assignment re-validates; only touch it when it changes
                self.off_board = want
        return self

    @property
    def mount(self) -> Surface:
        """Effective mounting surface, honouring rigs saved before ``surface`` existed."""
        if self.surface is not None:
            return self.surface
        return "off_board" if self.off_board else "top"


class PortRef(StrictModel):
    instance_id: str
    port_id: str

    def key(self) -> str:
        return f"{self.instance_id}:{self.port_id}"


class Connection(StrictModel):
    """A physical cable between two ports. Virtual paths inside a switcher are NOT connections."""

    id: str = Field(default_factory=lambda: new_id("conn"))
    kind: SignalKind
    source: PortRef
    target: PortRef
    label: str | None = None
    cable_length_cm: float | None = None  # user-entered planning metadata only
    connector_style: str | None = None  # "straight", "pancake", "right_angle", ...
    intentional: bool = False  # user marks an unusual connection as deliberate
    notes: str | None = None


class AppliedCommand(StrictModel):
    """Snapshot of the profile command a scene value was applied from.

    The numeric fields beside it (``cc``/``value`` or ``pc``/bank) are what the compiler sends and
    stay authoritative; this record only says *where they came from*. ``definition`` is the
    command's ``fingerprint()`` at apply time: when it no longer matches the live command the
    compiler raises a review warning instead of changing the bytes. Renaming a command, editing its
    description or un-favoriting it changes nothing here. ``name`` and ``value_label`` are kept so a
    deleted command still reads sensibly in reports."""

    command_id: str
    name: str
    definition: str
    value_label: str | None = None  # the chosen meaning for a "choice" command ("engage")
    deterministic: bool | None = None
    applied_at: str | None = None


class ProgramSelection(StrictModel):
    pc: int = Field(ge=0, le=127)  # value on the wire (0-127)
    bank_msb: int | None = Field(default=None, ge=0, le=127)
    bank_lsb: int | None = Field(default=None, ge=0, le=127)
    command: AppliedCommand | None = None


class CcValue(StrictModel):
    cc: int = Field(ge=0, le=127)
    value: int = Field(ge=0, le=127)
    label: str | None = None
    command: AppliedCommand | None = None


class DeviceSceneState(StrictModel):
    """Desired state of one device instance within a scene (hardware-independent intent)."""

    instance_id: str
    program: ProgramSelection | None = None
    enabled: bool | None = None  # True = engaged, False = bypassed, None = don't care
    cc_values: list[CcValue] = Field(default_factory=list)
    manual_note: str | None = None  # for non-MIDI devices: "stomp on by hand"


class Ml10xSceneState(StrictModel):
    preset_number: int | None = Field(default=None, ge=0)  # ML10X preset index (0-based)
    # Per-loop desired engaged state, keyed by loop number as string ("1".."10").
    loop_states: dict[str, bool] = Field(default_factory=dict)


class Scene(StrictModel):
    id: str = Field(default_factory=lambda: new_id("scene"))
    name: str
    song: str | None = None
    section: str | None = None
    order: int = 0
    color: str | None = None
    ml10x: Ml10xSceneState = Field(default_factory=Ml10xSceneState)
    device_states: list[DeviceSceneState] = Field(default_factory=list)
    manual_steps: list[str] = Field(default_factory=list)
    notes: str | None = None


class Mc8Message(StrictModel):
    """An extra, user-authored message on an MC8 preset (beyond scene compilation)."""

    type: str  # "pc" | "cc" | "note_on" | "note_off" | "bank_up" | "bank_down" | "delay" ...
    channel: int | None = Field(default=None, ge=1, le=16)
    number: int | None = Field(default=None, ge=0, le=127)
    value: int | None = Field(default=None, ge=0, le=127)
    action: str = "press"
    toggle_position: str = "both"
    label: str | None = None


class Mc8Preset(StrictModel):
    """One footswitch preset in a bank (position A..P on the MC8)."""

    position: str  # "A".."P"
    short_name: str = ""
    long_name: str | None = None
    toggle_name: str | None = None
    toggle_mode: bool = False
    scene_id: str | None = None
    action: str = "press"
    extra_messages: list[Mc8Message] = Field(default_factory=list)


class Mc8Bank(StrictModel):
    number: int = Field(ge=1)
    name: str = ""
    presets: list[Mc8Preset] = Field(default_factory=list)


class Mc8Config(StrictModel):
    instance_id: str | None = None
    banks: list[Mc8Bank] = Field(default_factory=list)
    firmware_version: str | None = None


class Ml10xLoopAssignment(StrictModel):
    """Which rig device sits in a given ML10X loop. Derived from cables, but a user label helps."""

    loop: int = Field(ge=1, le=10)
    label: str | None = None
    stereo_pair_with: int | None = Field(default=None, ge=1, le=10)


class Ml10xPreset(StrictModel):
    """A routing preset. ``chain`` is the ordered list of loop numbers for a series path.

    ``advanced_edges`` (optional) expresses an arbitrary routing graph for Advanced Mode:
    each edge is [from_node, to_node] with nodes "IN", "OUT", "L1".."L10", "MIX". Only
    used when ``mode == "advanced"``. Feature-gated by firmware assumptions, see specs.
    """

    number: int = Field(ge=0)
    name: str = ""
    mode: str = "simple"  # "simple" | "advanced"
    chain: list[int] = Field(default_factory=list)
    bypassed_loops: list[int] = Field(default_factory=list)  # loops in the chain saved as bypassed
    advanced_edges: list[list[str]] = Field(default_factory=list)
    notes: str | None = None


class Ml10xConfig(StrictModel):
    instance_id: str | None = None
    firmware_version: str | None = None
    advanced_mode: bool = False
    loop_assignments: list[Ml10xLoopAssignment] = Field(default_factory=list)
    presets: list[Ml10xPreset] = Field(default_factory=list)


class Controllers(StrictModel):
    mc8: Mc8Config = Field(default_factory=Mc8Config)
    ml10x: Ml10xConfig = Field(default_factory=Ml10xConfig)


class Rig(StrictModel):
    id: str = Field(default_factory=lambda: new_id("rig"))
    name: str
    description: str | None = None
    created_at: str = Field(default_factory=utcnow_iso)
    updated_at: str = Field(default_factory=utcnow_iso)
    # Monotonic per-rig revision. Every client edit increments it; the server refuses a PUT
    # whose revision is lower than the stored one, so a late, out-of-order save can never
    # overwrite newer state and a second browser tab is told the rig changed elsewhere.
    revision: int = Field(default=0, ge=0)
    board: Board = Field(default_factory=Board)
    instances: list[DeviceInstance] = Field(default_factory=list)
    connections: list[Connection] = Field(default_factory=list)
    scenes: list[Scene] = Field(default_factory=list)
    controllers: Controllers = Field(default_factory=Controllers)
    notes: str | None = None

    def instance(self, instance_id: str) -> DeviceInstance | None:
        for i in self.instances:
            if i.id == instance_id:
                return i
        return None

    def scene(self, scene_id: str) -> Scene | None:
        for s in self.scenes:
            if s.id == scene_id:
                return s
        return None


class PreviewDevice(StrictModel):
    """One enclosure in a rig's miniature: true-scale rectangle plus category and, if the device
    has a picture on this computer, the facts needed to draw it."""

    x_mm: float
    y_mm: float
    width_mm: float
    height_mm: float
    category: str
    off_board: bool = False
    surface: str = "top"
    placeholder: bool = False
    rotation: int = 0
    image: dict | None = None


class RigPreview(StrictModel):
    width_mm: float
    depth_mm: float
    devices: list[PreviewDevice] = Field(default_factory=list)
    cable_count: int = 0


class RigSummary(StrictModel):
    id: str
    name: str
    description: str | None = None
    created_at: str
    updated_at: str
    revision: int = 0
    instance_count: int
    scene_count: int
    # Response-only miniature of the board (derived from the stored rig; never part of a project file).
    preview: RigPreview | None = None


class ProjectFile(StrictModel):
    """Portable, versioned export of a rig plus every profile it references."""

    format: str = PROJECT_FORMAT
    format_version: int = PROJECT_FORMAT_VERSION
    exported_at: str = Field(default_factory=utcnow_iso)
    app_version: str = "0.1.0"
    rig: Rig
    profiles: list[dict] = Field(default_factory=list)  # DeviceProfile dumps (kept loose for forward-compat)
    # Only present (format_version 2) when the user explicitly asked for an image-inclusive backup:
    # {id, content_type, original_name, data_base64}. Bytes are re-validated on import like an upload.
    assets: list[dict] = Field(default_factory=list)
    # Only present (format_version 3) when the user explicitly asked for a documents-inclusive
    # backup: {id, content_type, original_name, data_base64}. Validated on import like an upload.
    documents: list[dict] = Field(default_factory=list)
