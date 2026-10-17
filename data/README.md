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

The tool fits a **Weibull life model** ([SPEC §4](../SPEC.md), [`app/qc.py`](../app/qc.py)).

- **Primary (*m* = 2 fixed):** wear-out shape. The chance of failing in the next
  hour grows as a drone ages. This is the maintain-now path used in demos.
- **Secondary (free-*m*):** jointly MLE shape and scale from the same right-censored
  likelihood (`estimate_m=true`, needs *r* ≥ 2). Use it to check whether wear-out
  is sharper than *m* = 2.
- **Secondary (I-MR):** `imr_mission_hours.csv` is a univariate series of consecutive
  mission hours for process monitoring (not lifetime censoring).
- **Failures and censoring (Weibull CSVs):** each row is one airframe. A drone with
  `failed = 1` adds a failure at its `time_hours`. A drone with `failed = 0` is
  right-censored: it is known to have lasted *at least* `time_hours`. Both kinds
  of row enter the estimate,

  \(\hat c^{\,m} = \dfrac{1}{r}\sum_{\text{all rows}} t_i^{\,m}\), where *r* = number of rows with `failed = 1`.
- **Where the data live:** the API reads these files only when run locally
  (`GET /analyze/file?name=...`, `GET /imr/file?name=...`). `data/` is not deployed,
  so on the live server send the same numbers with `POST /analyze` or `POST /imr`.
  See [`demo/README.md`](../demo/README.md) for the exact commands.

## Files

| File | What it shows | Rows | Failed | Censored |
|---|---|---|---|---|
| `wearout_baseline.csv` | Normal case: mixed failures and still-flying (right-censored) drones. Matches SPEC §4 known-answer B. | 5 | 3 | 2 |
| `early_wearout.csv` | Short-life wear-out: parts that wear out fast, so B10 and R(100) push **maintain now**. ("Early" here means short lives, not infant mortality.) | 6 | 4 | 2 |
| `edge_all_censored.csv` | No failures (*r* = 0). The tool must return a clear error, not a fit. | 3 | 0 | 3 |
| `imr_mission_hours.csv` | Consecutive mission hours with a planted late jump (SPEC §4 D). I-MR, not Weibull. | 9 missions | — | — |

## Columns (Weibull lifetime CSVs)

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

When the same numbers are sent as JSON to `POST /analyze`, `NaN`, `null`, a
`failed` of `2`, `0.5` or `true`/`false`, a negative `current_age`, or empty or
mismatched lists also give HTTP 400, with a message naming the entry. Valid data
that the model cannot calculate give HTTP 422 ("These data cannot be calculated
right now. Please check the data.").

## How you would collect this for real

1. Read the hour meter (or cycle counter treated as hours) when a drone fails in flight or is grounded for a hard fault → `time_hours`, `failed=1`.
2. At the inspection cutoff (end of week / end of test window), log the current hours of every drone still flying → `time_hours`, `failed=0`. Drones enter service on different days, so each survivor has its own hours at the same cutoff (as in `edge_all_censored.csv`, at 80, 90 and 100 h). Do **not** drop survivors; they enter the censored term of the likelihood.
3. One row per airframe in the analysis window. Do not reuse the same drone twice without resetting the clock after overhaul (out of scope for v1).

## Expected behavior (for demos)

All values with *m* = 2, `current_age` = 0 and `plan_hours` = 100, rounded.
Checked against `app/qc.py`. The rule: **ok to fly** if the next-interval reliability `R_future` = R(`current_age` + `plan_hours`) / R(`current_age`) is at least 90% (with `current_age` = 0 this is R(`plan_hours`)); otherwise **maintain now** (one rule, decided in `qc.py`; exactly 90% passes).

| File | Σ *t*² | *r* | \(\hat c\) (h) | MTTF (h) | B10 (h) | R(100) | z(100) (per h) | Call |
|---|---|---|---|---|---|---|---|---|
| `wearout_baseline.csv` | 126900 | 3 | 205.670 | 182.270 | 66.759 | 0.789460 | 0.004728 | maintain now |
| `early_wearout.csv` | 16350 | 4 | 63.934 | 56.660 | 20.752 | 0.086598 | 0.048930 | maintain now |
| `edge_all_censored.csv` | — | 0 | — | — | — | — | — | error (HTTP 400): need at least one failure (*r* ≥ 1) |

`wearout_baseline.csv` with `plan_hours=50` gives R(50) = 0.942611 and
**ok to fly**: the only "ok to fly" case in the demo.

### Free-*m* on `early_wearout.csv` (SPEC §4 C)

The four failures are tightly clustered (40–55 h). Free-*m* MLE gives
\(\hat m\approx 5.709\), \(\hat c\approx 57.869\) h, B10 ≈ 39.019 h — sharper
wear-out than *m* = 2. With *m* fixed at 2 the tool reports B10 ≈ 20.8 h
(conservative: service sooner). Call either path with
`GET /analyze/file?name=early_wearout.csv&estimate_m=true`.

### I-MR columns (`imr_mission_hours.csv`)

| Column | Type | Units | Meaning |
|---|---|---|---|
| `mission_id` | string | label | Mission order label; not used in the chart |
| `hours` | number | flight hours for that mission | The individuals series \(x_i\) |

Expected (checked against `app/qc.py`): \(\bar x=16\), \(\overline{\mathrm{MR}}=3\);
individuals UCL/LCL ≈ 23.979 / 8.021; MR UCL ≈ 9.801; points 7–9 and the MR at
step 7 out of control (planted shift). Degenerate constant series → \(\overline{\mathrm{MR}}=0\), no OOC flags.
