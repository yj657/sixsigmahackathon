"""Known-answer and degenerate tests for Weibull fleet reliability (SPEC §4)."""

import math
from pathlib import Path

import pytest

from app.qc import (
    b10_life,
    fit_weibull_scale,
    maintenance_call,
    weibull_hazard,
    weibull_mttf,
    weibull_reliability,
)

DATA = Path(__file__).resolve().parents[1] / "data"


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


def test_known_answer_b_from_csv():
    """wearout_baseline.csv matches known-answer B."""
    rows = (DATA / "wearout_baseline.csv").read_text().strip().splitlines()[1:]
    times, failed = [], []
    for row in rows:
        _, t, f = row.split(",")
        times.append(float(t))
        failed.append(int(f))
    c_hat = fit_weibull_scale(times, failed, m=2.0)
    assert c_hat == pytest.approx(math.sqrt(42300.0), abs=1e-6)


def test_degenerate_all_censored_raises():
    """r=0 must error clearly — never return inf or a fake scale."""
    with pytest.raises(ValueError, match="at least one failure"):
        fit_weibull_scale([80.0, 90.0, 100.0], [0, 0, 0], m=2.0)


def test_maintenance_call_threshold():
    # c=200, B10≈64.9 → plan_hours=100 triggers maintain
    assert maintenance_call(200.0, plan_hours=100.0, m=2.0) == "maintain now"
    # large c: B10 and R(100) both comfortable
    assert maintenance_call(1000.0, plan_hours=100.0, m=2.0) == "ok to fly"
