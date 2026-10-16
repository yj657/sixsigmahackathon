"""
Weibull life model for drone fleet maintenance (shape m fixed at 2 = wear-out).

Course formulas (SYSEN 5300):
  F(t) = 1 - exp(-(t/c)^m)
  R(t) = exp(-(t/c)^m)
  z(t) = (m/c) * (t/c)^(m-1)
  MTTF = c * Gamma(1 + 1/m)
  MLE for scale with right censoring (m known):
    c^m = (1/r) * sum_i t_i^m   (sum over failures AND censored; r = # failures)
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence, Union

Number = Union[int, float]


def _as_float_list(values: Iterable[Number]) -> list[float]:
    return [float(v) for v in values]


def fit_weibull_scale(
    times: Sequence[Number],
    failed: Sequence[Number],
    m: float = 2.0,
) -> float:
    """
    MLE of Weibull characteristic life c with known shape m (right-censored).

    failed[i] = 1 if unit i failed, 0 if still operating (Type I / right-censored).
    """
    if m <= 0:
        raise ValueError("shape m must be positive")
    t = _as_float_list(times)
    f = [int(x) for x in failed]
    if len(t) != len(f) or len(t) == 0:
        raise ValueError("times and failed must be non-empty and the same length")
    if any(x <= 0 for x in t):
        raise ValueError("time_hours must be positive")
    r = sum(f)
    if r < 1:
        raise ValueError(
            "need at least one failure to estimate scale (r=0: all observations censored)"
        )
    sum_tm = sum(ti**m for ti in t)
    return (sum_tm / r) ** (1.0 / m)


def weibull_mttf(c: float, m: float = 2.0) -> float:
    """Mean time to failure: c * Gamma(1 + 1/m)."""
    if c <= 0 or m <= 0:
        raise ValueError("c and m must be positive")
    return c * math.gamma(1.0 + 1.0 / m)


def weibull_reliability(t: float, c: float, m: float = 2.0) -> float:
    """R(t) = exp(-(t/c)^m)."""
    if t < 0 or c <= 0 or m <= 0:
        raise ValueError("t must be >= 0; c and m must be positive")
    return math.exp(-((t / c) ** m))


def weibull_hazard(t: float, c: float, m: float = 2.0) -> float:
    """Instantaneous hazard z(t) = (m/c) * (t/c)^(m-1)."""
    if t < 0 or c <= 0 or m <= 0:
        raise ValueError("t must be >= 0; c and m must be positive")
    if t == 0 and m < 1:
        raise ValueError("hazard undefined at t=0 when m < 1")
    return (m / c) * ((t / c) ** (m - 1.0))


def b10_life(c: float, m: float = 2.0) -> float:
    """Time at which F(t)=0.10: c * (-ln(0.9))^(1/m)."""
    if c <= 0 or m <= 0:
        raise ValueError("c and m must be positive")
    return c * ((-math.log(0.9)) ** (1.0 / m))


def maintenance_call(c: float, plan_hours: float = 100.0, m: float = 2.0) -> str:
    """
    maintain now if B10 <= plan_hours or R(plan_hours) < 0.90; else ok to fly.
    """
    if plan_hours <= 0:
        raise ValueError("plan_hours must be positive")
    if b10_life(c, m=m) <= plan_hours:
        return "maintain now"
    if weibull_reliability(plan_hours, c, m=m) < 0.90:
        return "maintain now"
    return "ok to fly"


def analyze_fleet(
    times: Sequence[Number],
    failed: Sequence[Number],
    plan_hours: float = 100.0,
    m: float = 2.0,
) -> dict:
    """Fit scale and return all SPEC outputs for the API layer."""
    c_hat = fit_weibull_scale(times, failed, m=m)
    return {
        "m": m,
        "c_hat": c_hat,
        "mttf": weibull_mttf(c_hat, m=m),
        "R_plan": weibull_reliability(plan_hours, c_hat, m=m),
        "z_plan": weibull_hazard(plan_hours, c_hat, m=m),
        "B10": b10_life(c_hat, m=m),
        "plan_hours": plan_hours,
        "call": maintenance_call(c_hat, plan_hours=plan_hours, m=m),
        "n": len(times),
        "r": int(sum(int(x) for x in failed)),
    }
