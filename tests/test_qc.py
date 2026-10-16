"""Known-answer, CSV, and validation tests for Weibull fleet reliability (SPEC §4)."""

import math
from pathlib import Path

import pytest

from app.qc import (
    IMR_D4,
    IMR_E2,
    analyze_fleet,
    b10_life,
    coerce_time_hours,
    fit_weibull_mle,
    fit_weibull_scale,
    imr_chart,
    load_imr_csv,
    maintenance_call,
    validate_lifetime_sample,
    weibull_hazard,
    weibull_mttf,
    weibull_reliability,
)

DATA = Path(__file__).resolve().parents[1] / "data"


def _load_csv(name: str):
    rows = (DATA / name).read_text().strip().splitlines()[1:]
    times, failed = [], []
    for row in rows:
        _, t, f = row.split(",")
        times.append(float(t))
        failed.append(int(f))
    return times, failed


def test_known_answer_a_closed_form():
    """SPEC §4 A: m=2, c=200 → MTTF, R(100), z(100), B10."""
    m, c, t = 2.0, 200.0, 100.0
    assert weibull_mttf(c, m=m) == pytest.approx(177.245, abs=1e-3)
    assert weibull_reliability(t, c, m=m) == pytest.approx(0.778801, abs=1e-5)
    assert weibull_hazard(t, c, m=m) == pytest.approx(0.005, abs=1e-9)
    assert b10_life(c, m=m) == pytest.approx(64.919, abs=1e-3)


def test_known_answer_b_mle_right_censored():
    """SPEC §4 B: times/failed → c_hat ≈ 205.670, MTTF ≈ 182.270, R(100) ≈ 0.789460."""
    times = [100.0, 120.0, 150.0, 200.0, 200.0]
    failed = [1, 1, 1, 0, 0]
    c_hat = fit_weibull_scale(times, failed, m=2.0)
    assert c_hat == pytest.approx(205.670, abs=1e-3)
    assert weibull_mttf(c_hat, m=2.0) == pytest.approx(182.270, abs=1e-3)
    assert weibull_reliability(100.0, c_hat, m=2.0) == pytest.approx(0.789460, abs=1e-5)


def test_csv_wearout_baseline_known_b():
    times, failed = _load_csv("wearout_baseline.csv")
    out = analyze_fleet(times, failed, plan_hours=100.0, m=2.0)
    assert out["c_hat"] == pytest.approx(math.sqrt(42300.0), abs=1e-6)
    assert out["r"] == 3
    assert out["n"] == 5
    assert out["call"] == "maintain now"


def test_csv_early_wearout_maintain_now():
    """Shorter lives: B10 and R(100) force maintain now (data/README)."""
    times, failed = _load_csv("early_wearout.csv")
    # Hand check: sum t^2 = 16350, r=4 → c = sqrt(4087.5)
    c_hat = fit_weibull_scale(times, failed, m=2.0)
    assert c_hat == pytest.approx(math.sqrt(16350.0 / 4.0), abs=1e-9)
    out = analyze_fleet(times, failed, plan_hours=100.0, m=2.0)
    assert out["r"] == 4
    assert out["n"] == 6
    assert out["call"] == "maintain now"
    assert out["B10"] < 100.0
    assert out["R_plan"] < 0.90


def test_csv_edge_all_censored_errors():
    times, failed = _load_csv("edge_all_censored.csv")
    with pytest.raises(ValueError, match="at least one failure"):
        fit_weibull_scale(times, failed, m=2.0)


def test_n_equals_one_single_failure():
    """n=1 with one failure: MLE is defined, c_hat = t."""
    assert fit_weibull_scale([100.0], [1], m=2.0) == pytest.approx(100.0)
    out = analyze_fleet([100.0], [1], plan_hours=100.0, m=2.0)
    assert out["n"] == 1
    assert out["r"] == 1
    assert math.isfinite(out["c_hat"])
    assert out["call"] in ("maintain now", "ok to fly")


def test_n_equals_one_censored_only_errors():
    with pytest.raises(ValueError, match="at least one failure"):
        fit_weibull_scale([100.0], [0], m=2.0)


def test_constant_failure_times_finite():
    """Constant data with failures: finite scale, never inf."""
    times = [50.0, 50.0, 50.0]
    failed = [1, 1, 1]
    c_hat = fit_weibull_scale(times, failed, m=2.0)
    assert c_hat == pytest.approx(50.0)
    assert math.isfinite(c_hat)
    assert not math.isinf(c_hat)


def test_missing_values_rejected():
    with pytest.raises(ValueError, match="missing|must be"):
        fit_weibull_scale([100.0, None], [1, 0], m=2.0)
    with pytest.raises(ValueError, match="missing|must be"):
        fit_weibull_scale([100.0, ""], [1, 0], m=2.0)
    with pytest.raises(ValueError, match="missing|must be"):
        validate_lifetime_sample([100.0], [None])


def test_nan_time_rejected():
    with pytest.raises(ValueError, match="finite"):
        fit_weibull_scale([100.0, float("nan")], [1, 0], m=2.0)
    with pytest.raises(ValueError, match="finite"):
        coerce_time_hours(float("nan"))


def test_nan_scale_does_not_say_ok_to_fly():
    """Regression: NaN c used to fall through comparisons → 'ok to fly'."""
    with pytest.raises(ValueError, match="finite"):
        maintenance_call(float("nan"), plan_hours=100.0, m=2.0)


def test_failed_must_be_zero_or_one():
    """Regression: failed=2 must not count as r=2."""
    with pytest.raises(ValueError, match="failed must be 0 or 1"):
        fit_weibull_scale([100.0], [2], m=2.0)
    with pytest.raises(ValueError, match="failed must be 0 or 1"):
        validate_lifetime_sample([100.0, 120.0], [1, 2])


def test_blank_cell_coerce_errors():
    with pytest.raises(ValueError, match="missing"):
        coerce_time_hours("")
    with pytest.raises(ValueError, match="missing"):
        coerce_time_hours("   ")


def test_maintenance_call_threshold():
    assert maintenance_call(200.0, plan_hours=100.0, m=2.0) == "maintain now"
    assert maintenance_call(1000.0, plan_hours=100.0, m=2.0) == "ok to fly"


def test_known_answer_c_free_m_early_wearout():
    """SPEC §4 C: free-m MLE on early_wearout → m≈5.709, c≈57.869, B10≈39.019."""
    times, failed = _load_csv("early_wearout.csv")
    m_hat, c_hat = fit_weibull_mle(times, failed)
    assert m_hat == pytest.approx(5.709, abs=1e-2)
    assert c_hat == pytest.approx(57.869, abs=1e-2)
    assert b10_life(c_hat, m=m_hat) == pytest.approx(39.019, abs=1e-2)
    out = analyze_fleet(times, failed, plan_hours=100.0, estimate_m=True)
    assert out["shape_mode"] == "free"
    assert out["m"] == pytest.approx(m_hat, abs=1e-9)
    assert out["call"] == "maintain now"


def test_free_m_needs_two_failures():
    with pytest.raises(ValueError, match="at least two failures"):
        fit_weibull_mle([100.0], [1])
    with pytest.raises(ValueError, match="at least two failures"):
        analyze_fleet([100.0, 120.0], [1, 0], estimate_m=True)


def test_known_answer_d_imr_planted_shift():
    """SPEC §4 D: I-MR on planted late shift; x̄=16, mR̄=3; points 7–9 OOC."""
    values = [10.0, 12.0, 11.0, 13.0, 12.0, 11.0, 25.0, 26.0, 24.0]
    out = imr_chart(values)
    assert out["x_bar"] == pytest.approx(16.0)
    assert out["mr_bar"] == pytest.approx(3.0)
    assert out["individuals"]["ucl"] == pytest.approx(16.0 + IMR_E2 * 3.0, abs=1e-9)
    assert out["individuals"]["lcl"] == pytest.approx(16.0 - IMR_E2 * 3.0, abs=1e-9)
    assert out["moving_range"]["ucl"] == pytest.approx(IMR_D4 * 3.0, abs=1e-9)
    assert out["moving_range"]["lcl"] == pytest.approx(0.0)
    ooc_i = [p["index"] for p in out["individuals"]["points"] if p["out_of_control"]]
    ooc_mr = [p["index"] for p in out["moving_range"]["points"] if p["out_of_control"]]
    assert ooc_i == [7, 8, 9]
    assert ooc_mr == [7]


def test_imr_degenerate_constant_no_ooc():
    """Constant series → mR̄=0, limits collapse to the constant, no OOC flags."""
    out = imr_chart([5.0, 5.0, 5.0, 5.0])
    assert out["mr_bar"] == pytest.approx(0.0)
    assert out["individuals"]["ucl"] == pytest.approx(5.0)
    assert out["individuals"]["n_out_of_control"] == 0
    assert out["moving_range"]["n_out_of_control"] == 0


def test_imr_n_equals_one_errors():
    with pytest.raises(ValueError, match="at least two"):
        imr_chart([10.0])


def test_csv_imr_mission_hours_known_d():
    values = load_imr_csv(DATA / "imr_mission_hours.csv")
    assert values == [10.0, 12.0, 11.0, 13.0, 12.0, 11.0, 25.0, 26.0, 24.0]
    out = imr_chart(values)
    assert out["individuals"]["n_out_of_control"] == 3
