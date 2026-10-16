# Data codebook — DroneGuard Team drone fleet lifetime logs

Invented field-shaped data for the Drone Delivery Fleet Maintenance tool.
Not real customer flights. Units and collection notes are what a technician
would need to gather the same shape of data for real.

## How the data were made

The numbers were **chosen by hand**, not simulated or measured. They are kept
small and round so every result can be checked with a calculator:
`wearout_baseline.csv` is exactly SPEC §4 known-answer B. Each file shows one
behavior of the tool (see the table below). Real fleet logs would be longer, and
their hours would not be round.

## How the tool uses the data

The tool fits a **Weibull life model with the shape fixed at *m* = 2**
([SPEC §4](../SPEC.md), [`app/qc.py`](../app/qc.py)).

- **Why *m* = 2:** it is a wear-out shape. The chance of failing in the next hour
  grows as a drone ages, which is what we expect from motors, bearings and
  batteries. It is an **assumption, not estimated from the data**.
- **Failures and censoring:** each row is one airframe. A drone with
  `failed = 1` adds a failure at its `time_hours`. A drone with `failed = 0` is
  right-censored: it is known to have lasted *at least* `time_hours`. Both kinds
  of row enter the estimate,

  \(\hat c^{\,m} = \dfrac{1}{r}\sum_{\text{all rows}} t_i^{\,m}\), where *r* = number of rows with `failed = 1`.
- **Where the data live:** the API reads these files only when run locally
  (`GET /analyze/file?name=...`). `data/` is not deployed, so on the live server
  send the same numbers with `POST /analyze`. See [`demo/README.md`](../demo/README.md)
  for the exact commands.

## Files

| File | What it shows | Rows | Failed | Censored |
|---|---|---|---|---|
| `wearout_baseline.csv` | Normal case: mixed failures and still-flying (right-censored) drones. Matches SPEC §4 known-answer B. | 5 | 3 | 2 |
| `early_wearout.csv` | Short-life wear-out: parts that wear out fast, so B10 and R(100) push **maintain now**. ("Early" here means short lives, not infant mortality.) | 6 | 4 | 2 |
| `edge_all_censored.csv` | No failures (*r* = 0). The tool must return a clear error, not a fit. | 3 | 0 | 3 |

## Columns (every CSV)

| Column | Type | Units / coding | Meaning | How it is collected |
|---|---|---|---|---|
| `drone_id` | string | fleet ID, unique within a file | Which airframe the row belongs to. A label only; not used in any calculation. | The ID painted on the airframe or in the fleet register |
| `time_hours` | number, > 0 | flight hours since the drone entered service (or since its last overhaul, if overhauls restore it to as-new) | Hours on the airframe at failure, or last known hours if still operating | The flight controller's hour meter, read at the failure or at the inspection cutoff. A cycle counter can stand in, treated as hours |
| `failed` | 0 or 1 | 1 = failed (see *What counts as a failure*); 0 = still operating, or removed for any other reason (right-censored, Type I) | Event indicator for the Weibull fit | The maintenance ticket for that airframe; no ticket means 0 |

### What counts as a failure

`failed = 1` means a **hard fault that ends the flight or grounds the drone**:
an in-flight failure (motor, battery, propeller, ESC) or a fault found on the
ground that makes the drone unsafe to fly. Every failure mode goes into one
fit, as in v1. A drone that is retired, sold, lost to an unrelated accident,
or removed for preventive maintenance **before** failing is recorded as
`failed = 0` at its hours on that day: it survived at least that long.

### Rules for valid data

Every row must follow these rules. The tool **checks the first three** and
refuses the whole file with an error instead of returning numbers. The
file endpoint (`/analyze/file`) answers HTTP 400 and names the line, counting
the header as line 1 (for example `row 4: time_hours is missing`). It **does
not check the last two**, so check those yourself before sending a file:

- Every cell is filled in. No blanks, `NA` or `NaN`. A blank cell gives
  `time_hours is missing` or `failed is missing`; `NaN` or `inf` gives
  `time_hours must be finite (NaN/inf not allowed)`. *(checked)*
- `time_hours` is a number greater than 0. Zero or a negative value gives
  `time_hours must be positive`. *(checked)*
- `failed` is exactly `0` or `1` (`1.0` is read as 1). Anything else, such as
  `2`, `0.5` or `yes`, gives `failed must be 0 or 1`. *(checked)*
- `drone_id` is unique; one row per airframe. *(not checked: a duplicated
  airframe would be counted twice)*
- The header row is exactly `drone_id,time_hours,failed`. *(partly checked: the
  tool requires the `time_hours` and `failed` columns and ignores
  `drone_id`)*

When the same numbers are sent as JSON to `POST /analyze`, `NaN`, a `failed`
of `2`, or empty or mismatched lists also give HTTP 400. A `null` or a
non-whole `failed` such as `0.5` is refused earlier by the API's input schema,
with HTTP 422.

## How you would collect this for real

1. Read the hour meter (or cycle counter treated as hours) when a drone fails in flight or is grounded for a hard fault → `time_hours`, `failed=1`.
2. At the inspection cutoff (end of week / end of test window), log the current hours of every drone still flying → `time_hours`, `failed=0`. Drones enter service on different days, so each survivor has its own hours at the same cutoff (as in `edge_all_censored.csv`, at 80, 90 and 100 h). Do **not** drop survivors; they enter the censored term of the likelihood.
3. One row per airframe in the analysis window. Do not reuse the same drone twice without resetting the clock after overhaul (out of scope for v1).

## Expected behavior (for demos)

All values with *m* = 2 and `plan_hours` = 100, rounded. Checked against
`app/qc.py`. The rule: **maintain now** if B10 ≤ `plan_hours` or
R(`plan_hours`) < 0.90, else **ok to fly**.

| File | Σ *t*² | *r* | \(\hat c\) (h) | MTTF (h) | B10 (h) | R(100) | z(100) (per h) | Call |
|---|---|---|---|---|---|---|---|---|
| `wearout_baseline.csv` | 126900 | 3 | 205.670 | 182.270 | 66.759 | 0.789460 | 0.004728 | maintain now |
| `early_wearout.csv` | 16350 | 4 | 63.934 | 56.660 | 20.752 | 0.086598 | 0.048930 | maintain now |
| `edge_all_censored.csv` | — | 0 | — | — | — | — | — | error (HTTP 400): need at least one failure (*r* ≥ 1) |

`wearout_baseline.csv` with `plan_hours=50` gives R(50) = 0.942611 and
**ok to fly**: the only "ok to fly" case in the demo.

### Note: `early_wearout.csv` and the *m* = 2 assumption

The four failures in this file are tightly clustered (40–55 h). Estimating the
shape from the data instead of fixing it gives *m* ≈ 5.7 and *c* ≈ 57.9 h, so
these parts wear out more sharply than *m* = 2 assumes. With *m* fixed at 2 the
tool reports B10 ≈ 20.8 h, earlier than the first observed failure (40 h). The
free-shape fit would put B10 near 39 h.

So for this file *m* = 2 is **conservative**: it calls for service sooner than
the data alone would. With only four failures neither shape can be pinned down;
this is why *m* is stated as an assumption. The free-shape values above are a
reference check only; the tool does not compute them (out of scope for v1).
