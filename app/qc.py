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
  Conditional reliability for a drone already at age a, over the next p hours:
    R_future = R(a + p) / R(a) = exp(-[((a+p)/c)^m - (a/c)^m])
  I-MR (span 2): d2=1.128, E2=3/d2, D3=0, D4=3.267.

Every t^m term is computed in log space (log-sum-exp) so large flight hours or shapes
cannot overflow. Input problems raise ValueError (API -> HTTP 400); valid inputs that
still cannot be computed raise CalculationError (API -> HTTP 422).
"""

from __future__ import annotations

import csv
import math
import sys
from pathlib import Path
from typing import Dict, List, Sequence, Tuple, Union

Number = Union[int, float]

# I-MR constants for moving-range span 2 (SYSEN 5300 / standard tables)
IMR_D2 = 1.128
IMR_E2 = 3.0 / IMR_D2  # ≈ 2.659574…; charts often print 2.66
IMR_D3 = 0.0
IMR_D4 = 3.267

# One maintenance rule, used everywhere: next-interval reliability must be >= 90%.
RELIABILITY_THRESHOLD = 0.90
# A value mathematically equal to 90% can land a few ulps below it in floating point
# (e.g. plan_hours exactly at the B10 life); treat that as meeting the threshold.
THRESHOLD_TOLERANCE = 1e-12
MSG_MEETS = "Model-estimated reliability meets the 90% threshold."
MSG_BELOW = (
    "Model-estimated reliability is below the 90% threshold; "
    "maintenance review is recommended."
)
CALC_ERROR_MESSAGE = "These data cannot be calculated right now. Please check the data."

# Free-m search never goes beyond this shape (wear-out sharper than this is not credible
# from fleet data, and larger shapes only invite numerical trouble).
FREE_M_MAX = 100.0
_LOG_MAX = math.log(sys.float_info.max)  # ~709.78: exp() above this overflows


class CalculationError(Exception):
    """Inputs were valid, but the model could not produce a finite, trustworthy result."""

    def __init__(self, detail: str = CALC_ERROR_MESSAGE):
        super().__init__(detail)
        self.detail = detail


def _safe_exp(x: float) -> float:
    """exp() that raises CalculationError instead of overflowing."""
    if not math.isfinite(x) or x > _LOG_MAX:
        raise CalculationError()
    return math.exp(x)


def _logsumexp(values: Sequence[float]) -> float:
    top = max(values)
    return top + math.log(sum(math.exp(v - top) for v in values))


def _check_finite(**named: float) -> None:
    for value in named.values():
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            raise CalculationError()


def _strict_number(name: str, value: object) -> float:
    """A JSON number (int or float). Rejects booleans, strings and None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number")
    return float(value)


def _require_finite_positive(name: str, value: float) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a finite number")
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
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a finite number")
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


def _strict_failed_flag(raw: object) -> int:
    """JSON failure flag: the integer 0 or 1 only (no booleans, strings or 0.5)."""
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise ValueError("must be the number 0 or 1")
    if not math.isfinite(raw) or raw not in (0, 1):
        raise ValueError("must be the number 0 or 1")
    return int(raw)


def validate_lifetime_sample(
    times: Sequence[object],
    failed: Sequence[object],
    strict: bool = False,
) -> Tuple[List[float], List[int], int]:
    """
    Coerce and validate parallel lifetime samples.

    Returns (times, failed_flags, r) where each failed flag is exactly 0 or 1
    and r = number of failures (sum of flags, never inflated by invalid codes).

    strict=True is for JSON input: values must already be numbers (no strings), and
    failure flags must be the numbers 0 or 1 (JSON true/false are rejected). Errors name
    the position of the bad entry (1-based).
    """
    if times is None or failed is None:
        raise ValueError("times and failed are required")
    if isinstance(times, (str, bytes, dict)) or isinstance(failed, (str, bytes, dict)):
        raise ValueError("times and failed must be lists")
    t_list = list(times)
    f_list = list(failed)
    if len(t_list) == 0 or len(f_list) == 0:
        raise ValueError("times and failed must be non-empty")
    if len(t_list) != len(f_list):
        raise ValueError(
            f"times and failed must be the same length (got {len(t_list)} and {len(f_list)})"
        )

    if not strict:
        times_out = [coerce_time_hours(x) for x in t_list]
        failed_out = [coerce_failed_flag(x) for x in f_list]
        return times_out, failed_out, sum(failed_out)

    times_out = []
    for i, x in enumerate(t_list, start=1):
        try:
            t = _strict_number("time_hours", x)
        except ValueError:
            raise ValueError(f"times entry {i} must be a number") from None
        if not math.isfinite(t):
            raise ValueError(f"times entry {i} must be finite (NaN/inf not allowed)")
        if t <= 0:
            raise ValueError(f"times entry {i} must be positive")
        times_out.append(t)
    failed_out = []
    for i, x in enumerate(f_list, start=1):
        try:
            failed_out.append(_strict_failed_flag(x))
        except ValueError:
            raise ValueError(f"failed entry {i} must be the number 0 or 1") from None
    return times_out, failed_out, sum(failed_out)


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
    return _scale_from_logs([math.log(ti) for ti in t], r, m)


def _scale_from_logs(log_t: Sequence[float], r: int, m: float) -> float:
    """c = (sum t^m / r)^(1/m), via ln c = (logsumexp(m ln t) - ln r) / m."""
    try:
        log_c = (_logsumexp([m * lt for lt in log_t]) - math.log(r)) / m
    except (OverflowError, ValueError, ZeroDivisionError):
        raise CalculationError() from None
    c_hat = _safe_exp(log_c)
    if not (math.isfinite(c_hat) and c_hat > 0):
        raise CalculationError()
    return c_hat


def _weibull_shape_score(m: float, times: Sequence[float], failed: Sequence[int], r: int) -> float:
    """
    Score for shape m at the profile MLE for c (right-censored Weibull).

    1/m + (1/r)*sum_{failed} ln(t_i) - sum(t_i^m ln t_i) / sum(t_i^m) = 0 at MLE.
    The weighted mean of ln t uses weights t_i^m / sum t^m, computed in log space.
    """
    log_t = [math.log(ti) for ti in times]
    a = [m * lt for lt in log_t]
    top = max(a)
    w = [math.exp(ai - top) for ai in a]
    weighted_ln = sum(wi * lt for wi, lt in zip(w, log_t)) / sum(w)
    sum_ln_fail = sum(lt for lt, fi in zip(log_t, failed) if fi == 1)
    return (1.0 / m) + (sum_ln_fail / r) - weighted_ln


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

    try:
        s_lo = _weibull_shape_score(lo, t, f, r)
        s_hi = _weibull_shape_score(hi, t, f, r)
        # Score decreases through the root for typical wear-out samples; widen the bracket,
        # but never beyond FREE_M_MAX (e.g. identical failure times have no finite MLE).
        expand = 0
        while s_lo * s_hi > 0 and expand < 8:
            if s_lo > 0:
                if hi >= FREE_M_MAX:
                    break
                hi = min(hi * 2.0, FREE_M_MAX)
                s_hi = _weibull_shape_score(hi, t, f, r)
            else:
                lo *= 0.5
                if lo <= 1e-6:
                    break
                s_lo = _weibull_shape_score(lo, t, f, r)
            expand += 1
        if not (math.isfinite(s_lo) and math.isfinite(s_hi)) or s_lo * s_hi > 0:
            raise CalculationError()

        for _ in range(80):
            mid = 0.5 * (lo + hi)
            s_mid = _weibull_shape_score(mid, t, f, r)
            if not math.isfinite(s_mid):
                raise CalculationError()
            if s_lo * s_mid <= 0:
                hi = mid
                s_hi = s_mid
            else:
                lo = mid
                s_lo = s_mid
    except (OverflowError, ValueError, ZeroDivisionError):
        raise CalculationError() from None
    m_hat = 0.5 * (lo + hi)
    c_hat = _scale_from_logs([math.log(ti) for ti in t], r, m_hat)
    _check_finite(m_hat=m_hat, c_hat=c_hat)
    return m_hat, c_hat


def weibull_mttf(c: float, m: float = 2.0) -> float:
    """Mean time to failure: c * Gamma(1 + 1/m), via lgamma so small m cannot overflow."""
    c = _require_finite_positive("c", c)
    m = _require_finite_positive("m", m)
    return _safe_exp(math.log(c) + math.lgamma(1.0 + 1.0 / m))


def _log_cum_hazard(t: float, c: float, m: float) -> float:
    """ln H(t) = m (ln t - ln c), where H(t) = (t/c)^m. Requires t > 0."""
    return m * (math.log(t) - math.log(c))


def weibull_reliability(t: float, c: float, m: float = 2.0) -> float:
    """R(t) = exp(-(t/c)^m), computed in log space (underflows to 0, never overflows)."""
    t = _require_finite_nonnegative("t", t)
    c = _require_finite_positive("c", c)
    m = _require_finite_positive("m", m)
    if t == 0:
        return 1.0
    log_h = _log_cum_hazard(t, c, m)
    if log_h > _LOG_MAX:
        return 0.0  # cumulative hazard is astronomically large: no survivors
    return math.exp(-math.exp(log_h))


def conditional_reliability(
    current_age: float, plan_hours: float, c: float, m: float = 2.0
) -> float:
    """
    Chance that a drone already at current_age survives the next plan_hours:
      R_future = R(a + p) / R(a) = exp(-[H(a + p) - H(a)]),  H(t) = (t/c)^m.

    At current_age = 0 this is exactly weibull_reliability(plan_hours). The difference
    H(a+p) - H(a) is formed as H(a+p) * (1 - exp(ln H(a) - ln H(a+p))) with expm1, so it
    stays accurate when the two hazards are huge and nearly equal.
    """
    a = _require_finite_nonnegative("current_age", current_age)
    p = _require_finite_positive("plan_hours", plan_hours)
    c = _require_finite_positive("c", c)
    m = _require_finite_positive("m", m)
    if a == 0:
        return weibull_reliability(p, c, m)
    end = a + p
    if not math.isfinite(end):
        raise CalculationError()
    log_h_end = _log_cum_hazard(end, c, m)
    log_h_now = _log_cum_hazard(a, c, m)
    # ln of the hazard accumulated during the interval
    log_delta = log_h_end + math.log(-math.expm1(log_h_now - log_h_end))
    if log_delta > _LOG_MAX:
        return 0.0
    r_future = math.exp(-math.exp(log_delta))
    _check_finite(r_future=r_future)
    return r_future


def weibull_hazard(t: float, c: float, m: float = 2.0) -> float:
    """Instantaneous hazard z(t) = (m/c) * (t/c)^(m-1), computed in log space."""
    t = _require_finite_nonnegative("t", t)
    c = _require_finite_positive("c", c)
    m = _require_finite_positive("m", m)
    if t == 0:
        if m < 1:
            raise ValueError("hazard undefined at t=0 when m < 1")
        return m / c if m == 1 else 0.0
    return _safe_exp(math.log(m) - math.log(c) + (m - 1.0) * (math.log(t) - math.log(c)))


def b10_life(c: float, m: float = 2.0) -> float:
    """Time at which F(t)=0.10: c * (-ln(0.9))^(1/m), computed in log space."""
    c = _require_finite_positive("c", c)
    m = _require_finite_positive("m", m)
    return _safe_exp(math.log(c) + math.log(-math.log(0.9)) / m)


def reliability_decision(reliability: float) -> Dict[str, object]:
    """
    The one maintenance rule: reliability >= 90% passes; below 90% needs review.

    Values within THRESHOLD_TOLERANCE below 0.90 count as 0.90 (floating-point noise), so a
    result that is mathematically exactly 90% passes. Non-finite input never passes.
    """
    if isinstance(reliability, bool) or not isinstance(reliability, (int, float)):
        raise CalculationError()
    if not math.isfinite(reliability) or not (0.0 <= reliability <= 1.0):
        raise CalculationError()
    meets = reliability >= RELIABILITY_THRESHOLD - THRESHOLD_TOLERANCE
    return {
        "meets_threshold": meets,
        "call": "ok to fly" if meets else "maintain now",
        "decision_message": MSG_MEETS if meets else MSG_BELOW,
        "reliability_threshold": RELIABILITY_THRESHOLD,
    }


def maintenance_call(
    c: float, plan_hours: float = 100.0, m: float = 2.0, current_age: float = 0.0
) -> str:
    """'ok to fly' if next-interval reliability >= 90%, else 'maintain now'."""
    r_future = conditional_reliability(current_age, plan_hours, c, m)
    return reliability_decision(r_future)["call"]


def analyze_fleet(
    times: Sequence[object],
    failed: Sequence[object],
    plan_hours: float = 100.0,
    m: float = 2.0,
    estimate_m: bool = False,
    current_age: float = 0.0,
    strict: bool = False,
) -> dict:
    """
    Fit scale (and optionally shape) and return all outputs for the API layer.

    Lifetime metrics (c_hat, mttf, B10) describe a new drone. Next-interval metrics
    (R_future, z_plan, call, decision_message) are for a drone already at current_age that
    will fly plan_hours more. R_plan is kept as an alias of R_future for older clients.
    All input checks run before any statistics.
    """
    if not isinstance(estimate_m, bool):
        raise ValueError("estimate_m must be true or false")
    if strict:
        # JSON scalars must already be numbers: no booleans or numeric strings.
        plan_hours = _strict_number("plan_hours", plan_hours)
        current_age = _strict_number("current_age", current_age)
        if not estimate_m:
            m = _strict_number("m", m)
    plan_hours = _require_finite_positive("plan_hours", plan_hours)
    current_age = _require_finite_nonnegative("current_age", current_age)
    m_in = None if estimate_m else _require_finite_positive("m", m)
    t, f, r = validate_lifetime_sample(times, failed, strict=strict)

    if estimate_m:
        m_used, c_hat = fit_weibull_mle(t, f)
        shape_mode = "free"
    else:
        m_used = m_in
        if r < 1:
            raise ValueError(
                "need at least one failure to estimate scale (r=0: all observations censored)"
            )
        c_hat = _scale_from_logs([math.log(ti) for ti in t], r, m_used)
        shape_mode = "fixed"

    end_age = current_age + plan_hours
    if not math.isfinite(end_age):
        raise CalculationError()
    r_future = conditional_reliability(current_age, plan_hours, c_hat, m_used)
    decision = reliability_decision(r_future)
    out = {
        "m": m_used,
        "c_hat": c_hat,
        "mttf": weibull_mttf(c_hat, m=m_used),
        "B10": b10_life(c_hat, m=m_used),
        "current_age": current_age,
        "plan_hours": plan_hours,
        "end_age": end_age,
        "R_future": r_future,
        "R_plan": r_future,
        "z_plan": weibull_hazard(end_age, c_hat, m=m_used),
        "n": len(t),
        "r": r,
        "shape_mode": shape_mode,
        "estimate_m": estimate_m,
        **decision,
    }
    _check_finite(
        **{k: v for k, v in out.items() if isinstance(v, float)}
    )
    return out


def _coerce_series_value(raw: object, name: str = "value") -> float:
    if raw is None:
        raise ValueError(f"{name} is missing")
    if isinstance(raw, bool):
        raise ValueError(f"{name} must be a finite number")
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

    try:
        mrs = [abs(xs[i] - xs[i - 1]) for i in range(1, n)]
        x_bar = math.fsum(xs) / n
        mr_bar = math.fsum(mrs) / len(mrs)
    except (OverflowError, ValueError):
        raise CalculationError() from None
    # Valid but extreme values (e.g. near 1e308) can overflow the sums or limits.
    if not all(math.isfinite(v) for v in [x_bar, mr_bar, *mrs]):
        raise CalculationError()

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

    if not all(math.isfinite(v) for v in (i_ucl, i_lcl, mr_ucl, mr_lcl)):
        raise CalculationError()

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
