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

import csv
import math
from pathlib import Path
from typing import List, Sequence, Tuple, Union

Number = Union[int, float]


def _require_finite_positive(name: str, value: float) -> float:
    try:
        x = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not math.isfinite(x):
        raise ValueError(f"{name} must be finite (got {value!r})")
    if x <= 0:
        raise ValueError(f"{name} must be positive")
    return x


def _require_finite_nonnegative(name: str, value: float) -> float:
    try:
        x = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not math.isfinite(x):
        raise ValueError(f"{name} must be finite (got {value!r})")
    if x < 0:
        raise ValueError(f"{name} must be >= 0")
    return x


def coerce_failed_flag(raw: object) -> int:
    """Accept only 0/1 (ints or whole floats). Reject 2, NaN, blanks, bools-as-unexpected."""
    if raw is None:
        raise ValueError("failed is missing")
    if isinstance(raw, bool):
        # bool is a subclass of int; require explicit 0/1 numerics from CSV/JSON
        raise ValueError("failed must be 0 or 1")
    if isinstance(raw, str):
        s = raw.strip()
        if s == "":
            raise ValueError("failed is missing")
        try:
            x = float(s)
        except ValueError as exc:
            raise ValueError("failed must be 0 or 1") from exc
    else:
        try:
            x = float(raw)  # type: ignore[arg-type]
        except (TypeError, ValueError) as exc:
            raise ValueError("failed must be 0 or 1") from exc
    if not math.isfinite(x) or x not in (0.0, 1.0):
        raise ValueError("failed must be 0 or 1")
    return int(x)


def coerce_time_hours(raw: object) -> float:
    """Parse one time_hours cell; reject blank, NaN, non-positive."""
    if raw is None:
        raise ValueError("time_hours is missing")
    if isinstance(raw, str) and raw.strip() == "":
        raise ValueError("time_hours is missing")
    try:
        t = float(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise ValueError("time_hours must be a finite positive number") from exc
    if not math.isfinite(t):
        raise ValueError("time_hours must be finite (NaN/inf not allowed)")
    if t <= 0:
        raise ValueError("time_hours must be positive")
    return t


def load_lifetime_csv(path: Union[str, Path]) -> Tuple[List[float], List[int]]:
    """
    Read a lifetime CSV with columns time_hours, failed.
    Blank / invalid cells raise ValueError (for API → HTTP 400).
    """
    path = Path(path)
    times: List[float] = []
    failed: List[int] = []
    with path.open(newline="") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None or not {
            "time_hours",
            "failed",
        }.issubset(set(reader.fieldnames)):
            raise ValueError("CSV must have columns time_hours and failed")
        for i, row in enumerate(reader, start=2):
            try:
                times.append(coerce_time_hours(row.get("time_hours")))
                failed.append(coerce_failed_flag(row.get("failed")))
            except ValueError as cell_exc:
                raise ValueError(f"row {i}: {cell_exc}") from cell_exc
    if not times:
        raise ValueError("CSV has no data rows")
    return times, failed


def validate_lifetime_sample(
    times: Sequence[object],
    failed: Sequence[object],
) -> Tuple[List[float], List[int], int]:
    """
    Coerce and validate parallel lifetime samples.

    Returns (times, failed_flags, r) where each failed flag is exactly 0 or 1
    and r = number of failures (sum of flags, never inflated by invalid codes).
    """
    if times is None or failed is None:
        raise ValueError("times and failed are required")
    t_list = list(times)
    f_list = list(failed)
    if len(t_list) == 0 or len(f_list) == 0:
        raise ValueError("times and failed must be non-empty")
    if len(t_list) != len(f_list):
        raise ValueError("times and failed must be the same length")

    times_out = [coerce_time_hours(x) for x in t_list]
    failed_out = [coerce_failed_flag(x) for x in f_list]
    r = sum(failed_out)
    return times_out, failed_out, r


def fit_weibull_scale(
    times: Sequence[object],
    failed: Sequence[object],
    m: float = 2.0,
) -> float:
    """
    MLE of Weibull characteristic life c with known shape m (right-censored).

    failed[i] = 1 if unit i failed, 0 if still operating (Type I / right-censored).
    """
    m = _require_finite_positive("shape m", m)
    t, f, r = validate_lifetime_sample(times, failed)
    if r < 1:
        raise ValueError(
            "need at least one failure to estimate scale (r=0: all observations censored)"
        )
    sum_tm = sum(ti**m for ti in t)
    c_hat = (sum_tm / r) ** (1.0 / m)
    if not math.isfinite(c_hat):
        raise ValueError("scale estimate is not finite")
    return c_hat


def weibull_mttf(c: float, m: float = 2.0) -> float:
    """Mean time to failure: c * Gamma(1 + 1/m)."""
    c = _require_finite_positive("c", c)
    m = _require_finite_positive("m", m)
    return c * math.gamma(1.0 + 1.0 / m)


def weibull_reliability(t: float, c: float, m: float = 2.0) -> float:
    """R(t) = exp(-(t/c)^m)."""
    t = _require_finite_nonnegative("t", t)
    c = _require_finite_positive("c", c)
    m = _require_finite_positive("m", m)
    return math.exp(-((t / c) ** m))


def weibull_hazard(t: float, c: float, m: float = 2.0) -> float:
    """Instantaneous hazard z(t) = (m/c) * (t/c)^(m-1)."""
    t = _require_finite_nonnegative("t", t)
    c = _require_finite_positive("c", c)
    m = _require_finite_positive("m", m)
    if t == 0 and m < 1:
        raise ValueError("hazard undefined at t=0 when m < 1")
    return (m / c) * ((t / c) ** (m - 1.0))


def b10_life(c: float, m: float = 2.0) -> float:
    """Time at which F(t)=0.10: c * (-ln(0.9))^(1/m)."""
    c = _require_finite_positive("c", c)
    m = _require_finite_positive("m", m)
    return c * ((-math.log(0.9)) ** (1.0 / m))


def maintenance_call(c: float, plan_hours: float = 100.0, m: float = 2.0) -> str:
    """
    maintain now if B10 <= plan_hours or R(plan_hours) < 0.90; else ok to fly.
    """
    c = _require_finite_positive("c", c)
    plan_hours = _require_finite_positive("plan_hours", plan_hours)
    m = _require_finite_positive("m", m)
    if b10_life(c, m=m) <= plan_hours:
        return "maintain now"
    if weibull_reliability(plan_hours, c, m=m) < 0.90:
        return "maintain now"
    return "ok to fly"


def analyze_fleet(
    times: Sequence[object],
    failed: Sequence[object],
    plan_hours: float = 100.0,
    m: float = 2.0,
) -> dict:
    """Fit scale and return all SPEC outputs for the API layer."""
    plan_hours = _require_finite_positive("plan_hours", plan_hours)
    m = _require_finite_positive("m", m)
    t, f, r = validate_lifetime_sample(times, failed)
    c_hat = fit_weibull_scale(t, f, m=m)
    return {
        "m": m,
        "c_hat": c_hat,
        "mttf": weibull_mttf(c_hat, m=m),
        "R_plan": weibull_reliability(plan_hours, c_hat, m=m),
        "z_plan": weibull_hazard(plan_hours, c_hat, m=m),
        "B10": b10_life(c_hat, m=m),
        "plan_hours": plan_hours,
        "call": maintenance_call(c_hat, plan_hours=plan_hours, m=m),
        "n": len(t),
        "r": r,
    }
