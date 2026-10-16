# Data codebook — kskbl drone fleet lifetime logs

Invented field-shaped data for the Drone Delivery Fleet Maintenance tool.
Not real customer flights. Units and collection notes are what a technician
would need to gather the same shape of data for real.

## Files

| File | What it shows | Rows |
|---|---|---|
| `wearout_baseline.csv` | Mixed failures + still-flying (right-censored). Matches SPEC §4 known-answer B. | 5 |
| `early_wearout.csv` | Shorter lives; B10 and R(100) should push **maintain now**. | 6 |
| `edge_all_censored.csv` | No failures (*r* = 0). Tool must return a clear error, not a fit. | 3 |

## Columns (every CSV)

| Column | Type | Units / coding | Meaning |
|---|---|---|---|
| `drone_id` | string | fleet ID | Which airframe the row belongs to |
| `time_hours` | number | flight hours | Hours on the airframe at failure, or last known hours if still operating |
| `failed` | 0 or 1 | 1 = failed / grounded as failed; 0 = still operating (Type I / right-censored) | Event indicator for Weibull MLE |

## How you would collect this for real

1. Read the hour meter (or cycle counter treated as hours) when a drone fails in flight or is grounded for a hard fault → `time_hours`, `failed=1`.
2. At a fixed inspection cutoff (end of week / end of test window), log hours for drones still flying → `time_hours`, `failed=0`. Do **not** drop survivors; they enter the censored term of the likelihood.
3. One row per airframe in the analysis window. Do not reuse the same drone twice without resetting the clock after overhaul (out of scope for v1).

## Expected behavior (for demos)

- **wearout_baseline.csv** — with shape *m* = 2 fixed: \(\hat c \approx 205.670\) h, MTTF ≈ 182.270 h, R(100) ≈ 0.789.
- **early_wearout.csv** — smaller scale; for `plan_hours=100`, expect **maintain now**.
- **edge_all_censored.csv** — fit refused: need at least one failure (*r* ≥ 1).
