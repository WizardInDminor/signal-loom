"""Shared enums and small value objects for the Signal Loom domain model.

Everything here is hardware-independent. Vendor-specific knowledge lives in
``app.morningstar`` and in catalog profiles, never in these types.
"""

from __future__ import annotations

import uuid
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def new_id(prefix: str) -> str:
    """Create a short, stable, URL-safe identifier with a readable prefix."""
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class StrictModel(BaseModel):
    """Base model: forbid unknown keys so that typos surface instead of being dropped."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class Evidence(str, Enum):
    """How much a value can be trusted. Never present a weaker level as a stronger one."""

    DOCUMENTED = "documented"  # described in official/current vendor material
    THIRD_PARTY = "third_party"  # community dataset / forum / unofficial source
    APPROXIMATE = "approximate"  # measured or inferred, may be off by a few mm
    USER = "user"  # entered by the user of this app
    UNKNOWN = "unknown"  # value is absent or a placeholder; must not be trusted


class SignalKind(str, Enum):
    AUDIO = "audio"
    MIDI = "midi"
    EXPRESSION = "expression"  # expression pedals, external footswitches, CV-ish control
    POWER = "power"
    USB = "usb"


class PortDirection(str, Enum):
    IN = "in"
    OUT = "out"
    BIDIRECTIONAL = "bidirectional"


class Connector(str, Enum):
    TS_1_4 = "ts_1_4"  # 1/4" mono (tip-sleeve)
    TRS_1_4 = "trs_1_4"  # 1/4" tip-ring-sleeve
    TRS_1_8 = "trs_1_8"  # 3.5 mm TRS (common for TRS MIDI)
    DIN5 = "din5"  # 5-pin DIN MIDI
    USB_C = "usb_c"
    USB_B = "usb_b"
    USB_MINI = "usb_mini"
    USB_MICRO = "usb_micro"
    DC_BARREL_2_1 = "dc_barrel_2_1mm"  # 5.5 x 2.1 mm barrel
    DC_BARREL_2_5 = "dc_barrel_2_5mm"
    XLR = "xlr"
    OTHER = "other"
    UNKNOWN = "unknown"


class AudioChannel(str, Enum):
    """What a single physical audio jack carries."""

    MONO = "mono"
    LEFT = "left"  # left of an L/R pair (often also 'mono' when used alone)
    RIGHT = "right"
    STEREO_TRS = "stereo_trs"  # one TRS jack carrying L on tip and R on ring
    UNKNOWN = "unknown"


class TrsRole(str, Enum):
    """What a TRS jack means; a TRS jack does NOT automatically mean stereo audio."""

    STEREO = "stereo"  # tip = L, ring = R
    MONO = "mono"  # TRS socket used as TS
    BALANCED = "balanced"
    INSERT = "insert"  # send on tip, return on ring (or vice versa)
    MIDI = "midi"  # TRS MIDI (see MidiTrsType)
    EXPRESSION = "expression"
    UNKNOWN = "unknown"


class MidiTrsType(str, Enum):
    TYPE_A = "type_a"  # MMA standard: tip = pin 5 (current sink), ring = pin 4
    TYPE_B = "type_b"  # tip = pin 4, ring = pin 5
    DIN = "din"  # 5-pin DIN, no TRS ambiguity
    PROPRIETARY = "proprietary"
    UNKNOWN = "unknown"


class Edge(str, Enum):
    """Edge of a device, looking straight down at it in its unrotated orientation.

    ``top`` is the edge furthest from the player (where most jacks live).
    """

    TOP = "top"
    BOTTOM = "bottom"
    LEFT = "left"
    RIGHT = "right"
    TOP_FACE = "top_face"  # e.g. an expression jack on the top panel


class DeviceCategory(str, Enum):
    INSTRUMENT = "instrument"
    CONTROLLER = "controller"
    SWITCHER = "switcher"
    EFFECT = "effect"
    AMP = "amp"
    POWER_SUPPLY = "power_supply"
    UTILITY = "utility"
    OTHER = "other"


class Polarity(str, Enum):
    CENTER_NEGATIVE = "center_negative"
    CENTER_POSITIVE = "center_positive"
    UNKNOWN = "unknown"


class Severity(str, Enum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


class Diagnostic(StrictModel):
    """A single validation/compilation finding with enough context to explain itself."""

    code: str
    severity: Severity
    message: str
    subject_type: Literal["rig", "instance", "port", "connection", "scene", "switch", "preset", "message"] = "rig"
    subject_id: str | None = None
    related_ids: list[str] = Field(default_factory=list)


Rotation = Literal[0, 90, 180, 270]
