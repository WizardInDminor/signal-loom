"""Morningstar hardware constants with evidence levels.

Every constant here carries a note on where it came from. See docs/research.md for the full
evidence trail. Levels: DOCUMENTED (official material, seen via search excerpts because the
vendor hosts were unreachable from the build sandbox), SAMPLE (computed from real editor
export files), THIRD_PARTY, UNVERIFIED.

Hardware targets are the ORIGINAL MC8 and the ML10X. MC8 Pro values are deliberately absent.
"""

from __future__ import annotations

from dataclasses import dataclass

# ---------------------------------------------------------------------------- MC8 (original)

MC8_BANKS = 30  # DOCUMENTED ("30 dual-page banks of 8 switches") + SAMPLE (30 bank objects)
MC8_SWITCH_PRESETS_PER_BANK = 22  # DOCUMENTED ("22 presets and 4 expression presets") + SAMPLE
MC8_EXP_PRESETS_PER_BANK = 4  # DOCUMENTED + SAMPLE
MC8_MESSAGES_PER_PRESET = 16  # DOCUMENTED ("each preset can send up to 16 messages") + SAMPLE
MC8_BANK_MESSAGES = 16  # DOCUMENTED (manual, v3.7.1 notes) + SAMPLE
MC8_FOOTSWITCHES = 8  # DOCUMENTED
MC8_PAGES = 2  # DOCUMENTED ("dual-page")
# Positions: page 1 = A-H (switches), page 2 = I-P (switches), Q-V only via external aux
# switches (manual via third-party mirror). Preset index 0..21 maps to A..V.
MC8_POSITIONS = [chr(ord("A") + i) for i in range(MC8_SWITCH_PRESETS_PER_BANK)]
MC8_FOOTSWITCH_POSITIONS = MC8_POSITIONS[: MC8_FOOTSWITCHES * MC8_PAGES]  # A..P
MC8_AUX_ONLY_POSITIONS = MC8_POSITIONS[MC8_FOOTSWITCHES * MC8_PAGES :]  # Q..V
# Name length limits: official figures NOT found. Values below are the maxima observed in real
# export files (SAMPLE) and a forum statement for the short name; treat as UNVERIFIED caps.
MC8_SHORT_NAME_MAX = 10  # THIRD_PARTY (forum) + SAMPLE max 10
MC8_TOGGLE_NAME_MAX = 9  # SAMPLE max 9 — UNVERIFIED
MC8_LONG_NAME_MAX = 23  # SAMPLE max 23 — UNVERIFIED
MC8_BANK_NAME_MAX = 24  # SAMPLE max 24 (looks truncated) — UNVERIFIED
MC8_PRESET_RENAME_MAX = 4  # DOCUMENTED ("limited to only 4 characters on MC3, MC6 MKII and MC8")
MC8_FIRMWARE_ASSUMED = "3.13.6"  # DOCUMENTED (fetched from GitHub releases, 2025-08-29)
MC8_EXPORT_DEVICE_MODEL = 4  # SAMPLE (deviceModel in all three real MC8 exports)
MC8_EXPORT_SCHEMA_VERSION = 1  # SAMPLE

# Message type codes in the editor export (`t`). 0/1/2 are SAMPLE-confirmed on the MC8; the
# rest are THIRD_PARTY (MC8 Pro SDK) and only used for *reading* foreign files, never emitted.
MC8_MSG_TYPE_EMPTY = 0
MC8_MSG_TYPE_PC = 1
MC8_MSG_TYPE_CC = 2
MC8_MSG_TYPE_NAMES_THIRD_PARTY = {
    0: "Empty",
    1: "Program Change",
    2: "Control Change",
    3: "Note On",
    4: "Note Off",
    5: "Real Time",
    6: "SysEx",
    10: "Bank Up",
    11: "Bank Down",
    13: "Bank Jump",
    14: "Toggle Page",
    15: "Set Toggle",
    22: "Toggle Preset",
    23: "Delay",
    27: "Engage Preset",
    39: "ML10X",
    42: "Trigger Messages",
    44: "Preset Rename",
}
# Action codes (`a`). 0-5, 9, 10 are DOCUMENTED via the MC8 CC implementation chart; 6-8 inferred.
MC8_ACTIONS = {
    "none": 0,
    "press": 1,
    "release": 2,
    "long_press": 3,
    "long_press_release": 4,
    "double_tap": 5,
    "double_tap_release": 6,
    "long_double_tap": 7,
    "long_double_tap_release": 8,
    "release_all": 9,
    "long_press_scroll": 10,
}
MC8_ACTION_LABELS = {
    "none": "No Action",
    "press": "Press",
    "release": "Release",
    "long_press": "Long Press",
    "long_press_release": "Long Press Release",
    "double_tap": "Double Tap",
    "double_tap_release": "Double Tap Release",
    "long_double_tap": "Long Double Tap",
    "long_double_tap_release": "Long Double Tap Release",
    "release_all": "Release All",
    "long_press_scroll": "Long Press Scroll",
}
# Toggle position codes (`tg`): SAMPLE shows {0,1,2}; names from Pro SDK (THIRD_PARTY).
MC8_TOGGLE_POSITIONS = {"pos1": 0, "pos2": 1, "both": 2}

# ---------------------------------------------------------------------------- ML10X

ML10X_BANKS = 4  # DOCUMENTED ("4 Banks with 128 Presets in each bank") + fixture
ML10X_PRESETS_PER_BANK = 128  # DOCUMENTED
ML10X_LOOP_PAIRS = ["A", "B", "C", "D", "E"]  # DOCUMENTED (5 TRS send/return pairs)
# 10 mono loops: index 1..10 = A Tip, A Ring, B Tip, B Ring, ... E Tip, E Ring.
ML10X_LOOPS = [(i + 1, f"{ML10X_LOOP_PAIRS[i // 2]} {'Tip' if i % 2 == 0 else 'Ring'}") for i in range(10)]
ML10X_LOOP_NAMES = dict(ML10X_LOOPS)
ML10X_CC_CHANGE_BANK = 0  # DOCUMENTED: CC#0 value 0-3 = Banks 1-4
ML10X_CC_ALL_LOOPS = 4  # DOCUMENTED: 0-63 bypass, 64-127 engage (Simple mode only)
ML10X_CC_SCROLL_UP = 5
ML10X_CC_SCROLL_DOWN = 6
ML10X_CC_MUTE = 7
ML10X_CC_UNMUTE = 8
ML10X_CC_TOGGLE_MUTE = 9
ML10X_CC_LOOP_ENGAGE_BASE = 10  # CC 10..19 = loop 1..10; DOCUMENTED for CC10, openmidi for 11-19
ML10X_CC_LOOP_TOGGLE_BASE = 20  # CC 20..29 = toggle loop 1..10; DOCUMENTED for CC20
ML10X_LOOP_BYPASS_VALUE = 0  # 0-63 = bypass (DOCUMENTED)
ML10X_LOOP_ENGAGE_VALUE = 127  # 64-127 = engage (DOCUMENTED)
ML10X_PC_MIN = 0  # DOCUMENTED: PC 0-127 recalls presets 0-127 of the current bank
ML10X_PC_MAX = 127
ML10X_PRESET_NAME_MAX = 16  # THIRD_PARTY (editor schema) — 12 bytes on the wire per one source; UNVERIFIED
ML10X_FIRMWARE_STABLE = "1.1.2"  # DOCUMENTED (GitHub releases "Latest")
ML10X_FIRMWARE_BETA = "1.2.0"  # DOCUMENTED (GitHub pre-release, BETA)
ML10X_DEFAULT_MIDI_CHANNEL = None  # UNVERIFIED — factory default not found in any source
ML10X_EXPORT_DEVICE_MODEL = 7  # THIRD_PARTY fixture (deviceModel in a real backup)


@dataclass(frozen=True)
class Ml10xFeatureGate:
    """What the ML10X can do, as a function of firmware and preset mode."""

    firmware_version: str | None
    advanced_mode_bypass: bool  # per-loop engage/bypass inside an Advanced preset (editor-saved)
    advanced_mode_cc_bypass: bool  # per-loop CC messages acting on an Advanced preset
    note: str


def ml10x_feature_gate(firmware_version: str | None) -> Ml10xFeatureGate:
    """Feature-gate uncertain capabilities instead of encoding blanket prohibitions.

    - On 1.1.x (stable): per-loop bypass only in Simple presets (DOCUMENTED).
    - On 1.2.x (beta): the editor can save per-loop engage/bypass state in Advanced presets
      (DOCUMENTED, help article h936bv). Whether CC 10-29 act on an Advanced preset is
      UNVERIFIED (official CC table still says "simple mode only"; forum reports fragility),
      so it stays disabled and the compiler warns.
    """
    v = (firmware_version or "").strip()
    major_minor = tuple(int(x) for x in v.split(".")[:2]) if v and v[0].isdigit() else None
    if major_minor is not None and major_minor >= (1, 2):
        return Ml10xFeatureGate(
            firmware_version=v,
            advanced_mode_bypass=True,
            advanced_mode_cc_bypass=False,
            note=(
                "Firmware 1.2 (beta) saves per-loop engage/bypass in Advanced presets. CC control of "
                "individual loops in Advanced presets is unverified and treated as unsupported."
            ),
        )
    return Ml10xFeatureGate(
        firmware_version=v or None,
        advanced_mode_bypass=False,
        advanced_mode_cc_bypass=False,
        note=(
            "Firmware 1.1.x: loops cannot be bypassed in Advanced presets; per-loop CC works only in Simple presets."
        ),
    )
