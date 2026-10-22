"""Charter §5 numeric contract: triangle phase points, period from BPM/division, effective macro,
half-up rounding, forward and reversed ranges at macro 0 / ½ / 1, depth 0, and invalid inputs."""

from __future__ import annotations

import math

import pytest

from app.instrument.evaluator import (
    EvaluationError,
    effective_macro,
    evaluate_macro,
    evaluate_texture,
    mapping_endpoints,
    period_s,
    phase_at,
    round_half_up,
    scale_to_cc,
    triangle,
)
from app.models.texture import Lfo, Macro, Mapping, Texture


def test_triangle_phase_points_are_exactly_as_specified():
    assert triangle(0.0) == 0.0
    assert triangle(0.25) == 1.0
    assert triangle(0.5) == 0.0
    assert triangle(0.75) == -1.0
    assert triangle(1.0) == 0.0  # wraps to phase 0
    assert triangle(0.125) == pytest.approx(0.5)
    assert triangle(0.625) == pytest.approx(-0.5)
    assert all(-1.0 <= triangle(i / 1000) <= 1.0 for i in range(1000))


def test_period_from_bpm_and_division_and_phase_wraps():
    assert period_s(120, 4) == 2.0  # one bar of 4/4 at 120 BPM
    assert period_s(72, 8) == pytest.approx(8 * 60 / 72)
    assert period_s(60, 0.25) == 0.25
    assert phase_at(0.0, 2.0) == 0.0
    assert phase_at(0.5, 2.0) == 0.25
    assert phase_at(1.0, 2.0) == 0.5
    assert phase_at(2.0, 2.0) == 0.0  # full cycle
    assert phase_at(0.5, 2.0, phase0=0.5) == 0.75  # continues from a frozen phase
    assert 0.0 <= phase_at(1e9 + 0.3, 2.0) < 1.0


def test_effective_macro_clamps_and_disabled_lfo_uses_base():
    assert effective_macro(0.5, 0.25, 1.0) == 0.75
    assert effective_macro(0.5, 0.25, -1.0) == 0.25
    assert effective_macro(0.9, 0.5, 1.0) == 1.0  # clamped
    assert effective_macro(0.1, 0.5, -1.0) == 0.0  # clamped
    assert effective_macro(0.42, 0.0, 1.0) == 0.42  # depth 0 → base
    m = Macro(name="x", base=0.42, lfo=Lfo(enabled=False, depth=1.0))
    assert evaluate_macro(m, 120, 0.37).effective == 0.42
    assert evaluate_macro(m, 120, 0.37).period_s is None


def test_half_up_rounding_is_language_independent():
    assert round_half_up(2.5) == 3 and round(2.5) == 2  # banker's rounding would give 2
    assert round_half_up(3.5) == 4
    assert round_half_up(2.4999) == 2
    assert round_half_up(0.5) == 1
    assert round_half_up(126.5) == 127


@pytest.mark.parametrize(
    "lo,hi,at0,athalf,at1",
    [
        (0, 127, 0, 64, 127),  # 63.5 rounds up to 64
        (100, 30, 100, 65, 30),  # reversed: inverse gesture
        (15, 110, 15, 63, 110),  # 62.5 → 63
        (40, 40, 40, 40, 40),  # flat range: constant
        (127, 0, 127, 64, 0),
    ],
)
def test_forward_and_reverse_ranges_at_macro_0_half_1(lo, hi, at0, athalf, at1):
    assert scale_to_cc(0.0, lo, hi) == at0
    assert scale_to_cc(0.5, lo, hi) == athalf
    assert scale_to_cc(1.0, lo, hi) == at1
    m = Mapping(instance_id="i", cc=21, output_min=lo, output_max=hi)
    assert mapping_endpoints(m) == {"at_0": at0, "at_half": athalf, "at_1": at1}
    assert m.inverted == (lo > hi)


def test_undertow_fixture_values_quarter_half_full_cycle():
    tex = Texture(
        name="Undertow",
        tempo_bpm=72,
        macros=[
            Macro(
                id="macro_bloom",
                name="Bloom",
                base=0.35,
                mappings=[
                    Mapping(id="a", instance_id="pa", cc=21, output_min=100, output_max=30),
                    Mapping(id="b", instance_id="pb", cc=22, output_min=15, output_max=110),
                ],
                lfo=Lfo(enabled=True, beats_per_cycle=8, depth=0.25),
            )
        ],
    )
    per = 8 * 60 / 72
    at = {t: evaluate_texture(tex, t)[0] for t in (0.0, per / 4, per / 2, 3 * per / 4, per)}
    assert at[0.0].effective == pytest.approx(0.35) and at[per].effective == pytest.approx(0.35)
    assert at[per / 4].effective == pytest.approx(0.60)  # +depth at the crest
    assert at[per / 2].effective == pytest.approx(0.35)
    assert at[3 * per / 4].effective == pytest.approx(0.10)  # −depth in the trough
    # Pedal A falls while Pedal B rises: the two destinations move in opposite directions.
    a0, b0 = (m.value for m in at[0.0].mappings)
    a1, b1 = (m.value for m in at[per / 4].mappings)
    assert a0 == 76 and b0 == 48  # 100 − 70×0.35 = 75.5 → 76 ; 15 + 95×0.35 = 48.25 → 48
    assert a1 == 58 and b1 == 72  # at e = 0.60
    assert a1 < a0 and b1 > b0


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -float("inf")])
def test_nan_and_infinity_are_refused_everywhere(bad):
    with pytest.raises(EvaluationError):
        triangle(bad)
    with pytest.raises(EvaluationError):
        effective_macro(bad, 0.1, 0.0)
    with pytest.raises(EvaluationError):
        effective_macro(0.5, bad, 0.0)
    with pytest.raises(EvaluationError):
        effective_macro(0.5, 0.5, bad)
    with pytest.raises(EvaluationError):
        scale_to_cc(bad, 0, 127)
    with pytest.raises(EvaluationError):
        period_s(bad, 4)
    with pytest.raises(EvaluationError):
        phase_at(bad, 2.0)


def test_out_of_range_inputs_are_refused_not_clamped():
    with pytest.raises(EvaluationError):
        period_s(10, 4)  # below 20 BPM
    with pytest.raises(EvaluationError):
        period_s(301, 4)
    with pytest.raises(EvaluationError):
        period_s(120, 0.1)  # below the smallest division
    with pytest.raises(EvaluationError):
        period_s(120, 65)
    with pytest.raises(EvaluationError):
        effective_macro(1.2, 0.0, 0.0)
    with pytest.raises(EvaluationError):
        effective_macro(0.5, 1.5, 0.0)
    with pytest.raises(EvaluationError):
        scale_to_cc(0.5, -1, 127)
    with pytest.raises(EvaluationError):
        scale_to_cc(0.5, 0, 128)
    with pytest.raises(EvaluationError):
        scale_to_cc(0.5, 0.5, 127)  # type: ignore[arg-type]
    with pytest.raises(EvaluationError):
        scale_to_cc(1.5, 0, 127)
    # The models refuse the same bounds before the evaluator ever sees them.
    with pytest.raises(ValueError):
        Texture(name="t", tempo_bpm=5)
    with pytest.raises(ValueError):
        Lfo(depth=1.5)
    with pytest.raises(ValueError):
        Mapping(instance_id="i", cc=128)
    with pytest.raises(ValueError):
        Macro(name="m", base=-0.1)


def test_evaluation_is_deterministic_and_never_outside_seven_bits():
    m = Macro(
        name="m",
        base=0.5,
        mappings=[Mapping(instance_id="i", cc=1, output_min=127, output_max=0)],
        lfo=Lfo(enabled=True, beats_per_cycle=1, depth=1.0),
    )
    values = [evaluate_macro(m, 240, t / 100).mappings[0].value for t in range(400)]
    assert values == [evaluate_macro(m, 240, t / 100).mappings[0].value for t in range(400)]
    assert min(values) == 0 and max(values) == 127
    assert all(isinstance(v, int) and not math.isnan(v) for v in values)
