"""Pure, deterministic evaluation of a texture: macro → LFO → effective value → seven-bit outputs.

Numeric contract (charter §5), each line proven by a test:

- LFO period in seconds = ``beats_per_cycle × 60 / bpm``; phase ``φ = ((t − t0) / period + φ0) mod 1``.
- Triangle ``l(φ)``: ``l(0) = 0`` rising, ``l(0.25) = 1``, ``l(0.5) = 0``, ``l(0.75) = −1``, ``l(1) = 0``.
  Starting at zero means switching the LFO on never jumps away from the macro's base value.
- Effective macro ``e = clamp(b + d·l, 0, 1)``; a disabled LFO gives ``e = b``.
- Destination value ``clamp(round_half_up(min + (max − min)·e), 0, 127)``; ``min > max`` is the
  inverse gesture. ``round_half_up(x) = floor(x + 0.5)`` is the one rounding rule (never Python's
  banker's rounding).
- NaN/∞ anywhere, BPM/division/depth outside their bounds and CCs outside 0–127 raise
  ``EvaluationError``. Nothing is clamped silently where the input itself is invalid.

The browser mirrors these functions in ``frontend/src/lib/instrument.ts`` for animation; the
backend values are the authoritative ones (the readiness endpoint returns them).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from ..models.texture import (
    BEATS_PER_CYCLE_MAX,
    BEATS_PER_CYCLE_MIN,
    TEMPO_MAX_BPM,
    TEMPO_MIN_BPM,
    Lfo,
    Macro,
    Mapping,
    Texture,
)


class EvaluationError(ValueError):
    """An input the evaluator refuses (NaN, infinity, out-of-bounds tempo/division/depth/CC)."""


def _finite(name: str, x: float) -> float:
    if isinstance(x, bool) or not isinstance(x, int | float) or not math.isfinite(x):
        raise EvaluationError(f"{name} must be a finite number, got {x!r}")
    return float(x)


def clamp01(x: float) -> float:
    x = _finite("value", x)
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


def round_half_up(x: float) -> int:
    """Half-step rounding towards +∞ (2.5 → 3, 3.5 → 4), independent of the language's default."""
    x = _finite("value", x)
    return int(math.floor(x + 0.5))


def period_s(bpm: float, beats_per_cycle: float) -> float:
    bpm = _finite("bpm", bpm)
    beats = _finite("beats_per_cycle", beats_per_cycle)
    if not TEMPO_MIN_BPM <= bpm <= TEMPO_MAX_BPM:
        raise EvaluationError(f"bpm {bpm} is outside {TEMPO_MIN_BPM:g}–{TEMPO_MAX_BPM:g}")
    if not BEATS_PER_CYCLE_MIN <= beats <= BEATS_PER_CYCLE_MAX:
        raise EvaluationError(f"beats_per_cycle {beats} is outside {BEATS_PER_CYCLE_MIN:g}–{BEATS_PER_CYCLE_MAX:g}")
    return beats * 60.0 / bpm


def phase_at(elapsed_s: float, period: float, phase0: float = 0.0) -> float:
    """Phase in [0, 1) after ``elapsed_s`` seconds, starting from ``phase0``."""
    elapsed = _finite("elapsed_s", elapsed_s)
    p = _finite("period", period)
    if p <= 0:
        raise EvaluationError("period must be positive")
    ph = (elapsed / p + _finite("phase0", phase0)) % 1.0
    return 0.0 if ph >= 1.0 else ph  # guard the floating edge case where % returns 1.0


def triangle(phase: float) -> float:
    """Triangle wave in [−1, 1] of a phase in [0, 1): 0 → 0 rising, 0.25 → 1, 0.5 → 0, 0.75 → −1."""
    ph = _finite("phase", phase) % 1.0
    if ph < 0.25:
        return 4.0 * ph
    if ph < 0.75:
        return 2.0 - 4.0 * ph
    return 4.0 * ph - 4.0


def lfo_value(lfo: Lfo, phase: float) -> float:
    if not lfo.enabled:
        return 0.0
    if lfo.shape != "triangle":  # pragma: no cover - the literal admits one shape today
        raise EvaluationError(f"unsupported LFO shape {lfo.shape!r}")
    return triangle(phase)


def effective_macro(base: float, depth: float, lfo: float) -> float:
    b = _finite("base", base)
    d = _finite("depth", depth)
    if not 0.0 <= b <= 1.0:
        raise EvaluationError(f"macro base {b} is outside 0–1")
    if not 0.0 <= d <= 1.0:
        raise EvaluationError(f"depth {d} is outside 0–1")
    return clamp01(b + d * _finite("lfo", lfo))


def scale_to_cc(effective: float, output_min: int, output_max: int) -> int:
    e = _finite("effective", effective)
    if not 0.0 <= e <= 1.0:
        raise EvaluationError(f"effective value {e} is outside 0–1")
    for name, v in (("output_min", output_min), ("output_max", output_max)):
        if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= 127:
            raise EvaluationError(f"{name} must be an integer 0–127, got {v!r}")
    value = round_half_up(output_min + (output_max - output_min) * e)
    return 0 if value < 0 else 127 if value > 127 else value


@dataclass
class MappingValue:
    mapping_id: str
    instance_id: str
    cc: int
    value: int
    enabled: bool

    def as_dict(self) -> dict:
        return {
            "mapping_id": self.mapping_id,
            "instance_id": self.instance_id,
            "cc": self.cc,
            "value": self.value,
            "enabled": self.enabled,
        }


@dataclass
class MacroValue:
    macro_id: str
    base: float
    phase: float
    lfo: float
    effective: float
    period_s: float | None
    mappings: list[MappingValue] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "macro_id": self.macro_id,
            "base": self.base,
            "phase": self.phase,
            "lfo": self.lfo,
            "effective": self.effective,
            "period_s": self.period_s,
            "mappings": [m.as_dict() for m in self.mappings],
        }


def evaluate_macro(
    macro: Macro, bpm: float, elapsed_s: float, phase0: float = 0.0, base: float | None = None
) -> MacroValue:
    """Evaluate one macro at ``elapsed_s`` seconds after its phase reference. ``base`` overrides the
    stored base (the engine passes its live runtime copy)."""
    b = macro.base if base is None else base
    per = period_s(bpm, macro.lfo.beats_per_cycle) if macro.lfo.enabled else None
    ph = phase_at(elapsed_s, per, phase0) if per is not None else 0.0
    lv = lfo_value(macro.lfo, ph)
    e = effective_macro(b, macro.lfo.depth if macro.lfo.enabled else 0.0, lv)
    out = MacroValue(macro.id, b, ph, lv, e, per)
    for m in macro.mappings:
        out.mappings.append(
            MappingValue(m.id, m.instance_id, m.cc, scale_to_cc(e, m.output_min, m.output_max), m.enabled)
        )
    return out


def evaluate_texture(texture: Texture, elapsed_s: float, phase0: dict[str, float] | None = None) -> list[MacroValue]:
    """Evaluate every macro of a texture (pure; no clock, no transport)."""
    return [evaluate_macro(m, texture.tempo_bpm, elapsed_s, (phase0 or {}).get(m.id, 0.0)) for m in texture.macros]


def mapping_endpoints(mapping: Mapping) -> dict[str, int]:
    """The destination's values at macro 0, ½ and 1 — the numbers the UI prints beside a mapping."""
    return {
        k: scale_to_cc(e, mapping.output_min, mapping.output_max)
        for k, e in (("at_0", 0.0), ("at_half", 0.5), ("at_1", 1.0))
    }
