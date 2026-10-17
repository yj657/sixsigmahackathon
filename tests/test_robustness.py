"""current_age (conditional reliability), the single 90% rule, strict input validation,
and numerical robustness (no overflow, NaN or inf ever reaches the user)."""

import math

import pytest

from app.qc import (
    CALC_ERROR_MESSAGE,
    MSG_BELOW,
    MSG_MEETS,
    CalculationError,
    analyze_fleet,
    b10_life,
    conditional_reliability,
    fit_weibull_mle,
    fit_weibull_scale,
    imr_chart,
    maintenance_call,
    reliability_decision,
    validate_lifetime_sample,
    weibull_reliability,
)

BASE_T = [100.0, 120.0, 150.0, 200.0, 200.0]
BASE_F = [1, 1, 1, 0, 0]


def _all_finite(out: dict) -> bool:
    return all(math.isfinite(v) for v in out.values() if isinstance(v, float))


# --- 1. current_age: conditional reliability over the next interval -------------------


def test_age_zero_matches_lifetime_reliability_exactly():
    c, m = 205.669638, 2.0
    for p in (1.0, 50.0, 100.0, 1000.0):
        assert conditional_reliability(0.0, p, c, m) == weibull_reliability(p, c, m)
    out = analyze_fleet(BASE_T, BASE_F, plan_hours=100.0)
    assert out["R_future"] == weibull_reliability(100.0, out["c_hat"], 2.0)
    assert out["R_future"] == out["R_plan"] == pytest.approx(0.789460, abs=1e-6)
    assert out["current_age"] == 0.0 and out["end_age"] == 100.0


def test_conditional_reliability_known_answer():
    """c=200, m=2, age 100, next 50 h: H(150)-H(100) = 0.5625-0.25 = 0.3125."""
    r = conditional_reliability(100.0, 50.0, 200.0, 2.0)
    assert r == pytest.approx(math.exp(-0.3125), abs=1e-12)  # 0.731616
    ratio = weibull_reliability(150.0, 200.0, 2.0) / weibull_reliability(100.0, 200.0, 2.0)
    assert r == pytest.approx(ratio, rel=1e-12)


def test_older_drone_is_riskier_under_wear_out():
    young = analyze_fleet(BASE_T, BASE_F, plan_hours=50.0, current_age=0.0)
    old = analyze_fleet(BASE_T, BASE_F, plan_hours=50.0, current_age=150.0)
    assert young["R_future"] > old["R_future"]
    assert young["call"] == "ok to fly" and old["call"] == "maintain now"
    # lifetime metrics do not depend on the drone's age
    for key in ("c_hat", "mttf", "B10"):
        assert young[key] == old[key]


def test_current_age_with_free_m():
    t = [40.0, 45.0, 50.0, 55.0, 60.0, 60.0]
    f = [1, 1, 1, 1, 0, 0]
    out = analyze_fleet(t, f, plan_hours=10.0, current_age=30.0, estimate_m=True)
    expected = conditional_reliability(30.0, 10.0, out["c_hat"], out["m"])
    assert out["R_future"] == expected
    assert out["shape_mode"] == "free" and _all_finite(out)


def test_conditional_reliability_stable_for_huge_nearly_equal_hazards():
    """H(a+p) and H(a) both ~1e6 but differ by ~0.04: naive subtraction would be noisy."""
    c, m, a, p = 1.0, 2.0, 1000.0, 2e-5
    expected = math.exp(-(2 * a * p + p * p))  # (a+p)^2 - a^2, exactly
    assert conditional_reliability(a, p, c, m) == pytest.approx(expected, rel=1e-9)


# --- 4. one 90% rule, computed in the backend -----------------------------------------


def test_decision_messages_and_call():
    ok = reliability_decision(0.95)
    assert ok["call"] == "ok to fly" and ok["meets_threshold"] is True
    assert ok["decision_message"] == MSG_MEETS
    bad = reliability_decision(0.85)
    assert bad["call"] == "maintain now" and bad["meets_threshold"] is False
    assert bad["decision_message"] == MSG_BELOW
    assert MSG_BELOW.endswith("maintenance review is recommended.")


def test_exactly_ninety_percent_passes():
    assert reliability_decision(0.90)["meets_threshold"] is True
    assert reliability_decision(0.9 - 1e-15)["meets_threshold"] is True  # float noise
    assert reliability_decision(0.9 - 1e-9)["meets_threshold"] is False


def test_plan_at_b10_life_passes():
    """plan_hours = B10 means R = 0.90 mathematically; it must pass."""
    c = math.sqrt(42300.0)
    plan = b10_life(c, 2.0)
    assert maintenance_call(c, plan_hours=plan, m=2.0) == "ok to fly"
    assert maintenance_call(c, plan_hours=plan * 1.001, m=2.0) == "maintain now"


def test_decision_never_passes_non_finite():
    for bad in (float("nan"), float("inf"), -0.1, 1.5):
        with pytest.raises(CalculationError):
            reliability_decision(bad)


# --- 3. strict validation (JSON path) -------------------------------------------------


@pytest.mark.parametrize(
    "times,failed,match",
    [
        (BASE_T, [True, True, True, False, False], "failed entry 1 must be the number 0 or 1"),
        (BASE_T, [1, 1, 1, 0, 0.5], "failed entry 5"),
        (BASE_T, [1, 1, 1, 0, 2], "failed entry 5"),
        (BASE_T, [1, 1, 1, 0, "0"], "failed entry 5"),
        (BASE_T, [1, 1, 1, 0, None], "failed entry 5"),
        ([100, "120", 150, 200, 200], BASE_F, "times entry 2 must be a number"),
        ([100, True, 150, 200, 200], BASE_F, "times entry 2 must be a number"),
        ([100, float("nan"), 150, 200, 200], BASE_F, "times entry 2 must be finite"),
        ([100, float("inf"), 150, 200, 200], BASE_F, "times entry 2 must be finite"),
        ([100, -5, 150, 200, 200], BASE_F, "times entry 2 must be positive"),
        ([100, 0, 150, 200, 200], BASE_F, "times entry 2 must be positive"),
        ([100, 120], [1], "same length"),
        ([], [], "non-empty"),
        ("100,120", "1,0", "must be lists"),
    ],
)
def test_strict_lifetime_validation(times, failed, match):
    with pytest.raises(ValueError, match=match):
        validate_lifetime_sample(times, failed, strict=True)
    with pytest.raises(ValueError, match=match):
        analyze_fleet(times, failed, strict=True)


@pytest.mark.parametrize(
    "kwargs,match",
    [
        ({"current_age": -1}, "current_age must be >= 0"),
        ({"current_age": float("nan")}, "current_age must be finite"),
        ({"current_age": float("inf")}, "current_age must be finite"),
        ({"current_age": True}, "current_age must be a number"),
        ({"plan_hours": 0}, "plan_hours must be positive"),
        ({"plan_hours": -10}, "plan_hours must be positive"),
        ({"plan_hours": float("nan")}, "plan_hours must be finite"),
        ({"plan_hours": "100"}, "plan_hours must be a number"),
        ({"current_age": "5"}, "current_age must be a number"),
        ({"estimate_m": "yes"}, "estimate_m must be true or false"),
        ({"estimate_m": 1}, "estimate_m must be true or false"),
        ({"m": 0}, "m must be positive"),
    ],
)
def test_strict_parameter_validation(kwargs, match):
    with pytest.raises(ValueError, match=match):
        analyze_fleet(BASE_T, BASE_F, strict=True, **kwargs)


def test_validation_runs_before_any_statistics():
    """Bad current_age is reported even though the data would also fail (r=0)."""
    with pytest.raises(ValueError, match="current_age"):
        analyze_fleet([1.0, 2.0], [0, 0], current_age=-1, strict=True)


def test_csv_path_still_accepts_text_cells():
    t, f, r = validate_lifetime_sample(["100", "120"], ["1", "0"])
    assert t == [100.0, 120.0] and f == [1, 0] and r == 1


# --- 2. numerical robustness ----------------------------------------------------------


def test_huge_times_fixed_m_is_finite_not_a_crash():
    out = analyze_fleet([1e200, 2e200, 3e200], [1, 1, 0], strict=True)
    assert _all_finite(out)
    assert out["c_hat"] == pytest.approx(math.sqrt((1 + 4 + 9) / 2) * 1e200, rel=1e-12)


@pytest.mark.parametrize(
    "times,failed",
    [
        ([100.0, 100.0, 100.0], [1, 1, 1]),  # identical failures: no finite shape MLE
        ([1e300, 2e300, 3e300], [1, 1, 0]),
        ([1e-300, 1e300, 5.0], [1, 1, 1]),
    ],
)
def test_free_m_extremes_give_clean_error_or_finite_result(times, failed):
    try:
        out = analyze_fleet(times, failed, estimate_m=True, strict=True)
    except CalculationError as exc:
        assert str(exc) == CALC_ERROR_MESSAGE
    else:
        assert _all_finite(out)


def test_identical_failures_free_m_is_calculation_error():
    with pytest.raises(CalculationError):
        fit_weibull_mle([100.0, 100.0, 100.0], [1, 1, 1])


def test_scale_overflow_is_calculation_error():
    """m=0.5, n=3, r=1: c = (3 * t^0.5)^2 = 9t; with t=1e308 that overflows a float."""
    with pytest.raises(CalculationError):
        fit_weibull_scale([1e308, 1e308, 1e308], [1, 0, 0], m=0.5)


def test_imr_overflow_is_calculation_error():
    with pytest.raises(CalculationError):
        imr_chart([1e308, -1e308, 1e308])
    with pytest.raises(ValueError, match="finite number"):
        imr_chart([10.0, True, 12.0])
