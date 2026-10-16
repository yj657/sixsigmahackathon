"""
Weibull life model + I-MR for drone fleet maintenance.

Course formulas (SYSEN 5300):
  F(t) = 1 - exp(-(t/c)^m)
  R(t) = exp(-(t/c)^m)
  z(t) = (m/c) * (t/c)^(m-1)
  MTTF = c * Gamma(1 + 1/m)
  MLE for scale with right censoring (m known):
    c^m = (1/r) * sum_i t_i^m   (sum over failures AND censored; r = # failures)
  Free-m MLE: solve the shape score, then plug into the scale formula.
  I-MR (span 2): d2=1.128, E2=3/d2, D3=0, D4=3.267.
"""

from __future__ import annotations

import csv
import math
from pathlib import Path
from typing import Dict, List, Sequence, Tuple, Union

Number = Union[int, float]

# I-MR constants for moving-range span 2 (SYSEN 5300 / standard tables)
IMR_D2 = 1.128
IMR_E2 = 3.0 / IMR_D2  # ≈ 2.659574…; charts often print 2.66
IMR_D3 = 0.0
IMR_D4 = 3.267


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


def _weibull_shape_score(m: float, times: Sequence[float], failed: Sequence[int], r: int) -> float:
    """
    Score for shape m at the profile MLE for c (right-censored Weibull).

    1/m + (1/r)*sum_{failed} ln(t_i) - sum(t_i^m ln t_i) / sum(t_i^m) = 0 at MLE.
    """
    sum_tm = 0.0
    sum_tm_ln = 0.0
    sum_ln_fail = 0.0
    for ti, fi in zip(times, failed):
        tm = ti**m
        ln_t = math.log(ti)
        sum_tm += tm
        sum_tm_ln += tm * ln_t
        if fi == 1:
            sum_ln_fail += ln_t
    return (1.0 / m) + (sum_ln_fail / r) - (sum_tm_ln / sum_tm)


def fit_weibull_mle(
    times: Sequence[object],
    failed: Sequence[object],
    m_lo: float = 0.05,
    m_hi: float = 20.0,
) -> Tuple[float, float]:
    """
    Joint MLE of Weibull shape m and scale c with right censoring.

    Requires r >= 2 (shape is not identified from a single failure).
    Returns (m_hat, c_hat).
    """
    t, f, r = validate_lifetime_sample(times, failed)
    if r < 2:
        raise ValueError(
            "need at least two failures to estimate shape (free-m MLE requires r >= 2)"
        )
    lo = _require_finite_positive("m_lo", m_lo)
    hi = _require_finite_positive("m_hi", m_hi)
    if lo >= hi:
        raise ValueError("m_lo must be < m_hi")

    s_lo = _weibull_shape_score(lo, t, f, r)
    s_hi = _weibull_shape_score(hi, t, f, r)
    # Score decreases through the root for typical wear-out samples; expand bracket if needed.
    expand = 0
    while s_lo * s_hi > 0 and expand < 8:
        if s_lo > 0:
            hi *= 2.0
            s_hi = _weibull_shape_score(hi, t, f, r)
        else:
            lo *= 0.5
            if lo <= 1e-6:
                break
            s_lo = _weibull_shape_score(lo, t, f, r)
        expand += 1
    if s_lo * s_hi > 0:
        raise ValueError("could not bracket a free-m MLE root in the search range")

    for _ in range(80):
        mid = 0.5 * (lo + hi)
        s_mid = _weibull_shape_score(mid, t, f, r)
        if s_lo * s_mid <= 0:
            hi = mid
            s_hi = s_mid
        else:
            lo = mid
            s_lo = s_mid
    m_hat = 0.5 * (lo + hi)
    c_hat = fit_weibull_scale(t, f, m=m_hat)
    if not math.isfinite(m_hat) or not math.isfinite(c_hat):
        raise ValueError("free-m MLE is not finite")
    return m_hat, c_hat


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
    estimate_m: bool = False,
) -> dict:
    """Fit scale (and optionally shape) and return all SPEC outputs for the API layer."""
    plan_hours = _require_finite_positive("plan_hours", plan_hours)
    t, f, r = validate_lifetime_sample(times, failed)
    if estimate_m:
        m_hat, c_hat = fit_weibull_mle(t, f)
        m_used = m_hat
        shape_mode = "free"
    else:
        m_used = _require_finite_positive("m", m)
        c_hat = fit_weibull_scale(t, f, m=m_used)
        shape_mode = "fixed"
    return {
        "m": m_used,
        "c_hat": c_hat,
        "mttf": weibull_mttf(c_hat, m=m_used),
        "R_plan": weibull_reliability(plan_hours, c_hat, m=m_used),
        "z_plan": weibull_hazard(plan_hours, c_hat, m=m_used),
        "B10": b10_life(c_hat, m=m_used),
        "plan_hours": plan_hours,
        "call": maintenance_call(c_hat, plan_hours=plan_hours, m=m_used),
        "n": len(t),
        "r": r,
        "shape_mode": shape_mode,
        "estimate_m": estimate_m,
    }


def _coerce_series_value(raw: object, name: str = "value") -> float:
    if raw is None:
        raise ValueError(f"{name} is missing")
    if isinstance(raw, str) and raw.strip() == "":
        raise ValueError(f"{name} is missing")
    try:
        x = float(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not math.isfinite(x):
        raise ValueError(f"{name} must be finite (NaN/inf not allowed)")
    return x


def load_imr_csv(path: Union[str, Path], value_col: str = "hours") -> List[float]:
    """Read a univariate I-MR series CSV (default column name: hours)."""
    path = Path(path)
    values: List[float] = []
    with path.open(newline="") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None or value_col not in reader.fieldnames:
            raise ValueError(f"CSV must have a '{value_col}' column")
        for i, row in enumerate(reader, start=2):
            try:
                values.append(_coerce_series_value(row.get(value_col), value_col))
            except ValueError as cell_exc:
                raise ValueError(f"row {i}: {cell_exc}") from cell_exc
    if not values:
        raise ValueError("CSV has no data rows")
    return values


def imr_chart(values: Sequence[object]) -> Dict[str, object]:
    """
    Individuals–moving-range chart for a univariate series (one obs per period).

    Limits use span-2 constants: d2=1.128, E2=3/d2, D3=0, D4=3.267.
    Flags only points beyond the 3-sigma limits (no Western Electric run rules).
    """
    if values is None or len(list(values)) == 0:
        raise ValueError("values must be non-empty")
    xs = [_coerce_series_value(v, "value") for v in values]
    n = len(xs)
    if n < 2:
        raise ValueError("need at least two values for an I-MR chart")

    mrs = [abs(xs[i] - xs[i - 1]) for i in range(1, n)]
    x_bar = sum(xs) / n
    mr_bar = sum(mrs) / len(mrs)
    if not math.isfinite(x_bar) or not math.isfinite(mr_bar):
        raise ValueError("I-MR summaries are not finite")

    i_ucl = x_bar + IMR_E2 * mr_bar
    i_lcl = x_bar - IMR_E2 * mr_bar
    mr_ucl = IMR_D4 * mr_bar
    mr_lcl = IMR_D3 * mr_bar  # 0 for span 2

    individuals = []
    for i, x in enumerate(xs, start=1):
        ooc = bool(x > i_ucl or x < i_lcl)
        individuals.append({"index": i, "value": x, "out_of_control": ooc})

    moving_ranges = []
    for i, mr in enumerate(mrs, start=2):
        ooc = bool(mr > mr_ucl or mr < mr_lcl)
        moving_ranges.append({"index": i, "mr": mr, "out_of_control": ooc})

    return {
        "n": n,
        "x_bar": x_bar,
        "mr_bar": mr_bar,
        "d2": IMR_D2,
        "E2": IMR_E2,
        "D3": IMR_D3,
        "D4": IMR_D4,
        "individuals": {
            "cl": x_bar,
            "ucl": i_ucl,
            "lcl": i_lcl,
            "points": individuals,
            "n_out_of_control": sum(1 for p in individuals if p["out_of_control"]),
        },
        "moving_range": {
            "cl": mr_bar,
            "ucl": mr_ucl,
            "lcl": mr_lcl,
            "points": moving_ranges,
            "n_out_of_control": sum(1 for p in moving_ranges if p["out_of_control"]),
        },
        "sigma_short": mr_bar / IMR_D2,
    }
