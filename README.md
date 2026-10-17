# Drone Fleet Reliability API

A small REST API that tells a drone delivery fleet **when to service drones before they fail in
the air**, from nothing more than each drone's flight hours and whether it has failed.

Built for the Cornell Six Sigma Hackathon, prompt 4: *Industrial Systems — Drone Delivery Fleet
Maintenance*. The prompt: a drone startup only investigates mid-air failures after a crash; build
a tool that helps technicians track wear-and-tear and improve reliability.

| | |
|---|---|
| **Team** | kskbl |
| **Prompt** | 4 · Industrial Systems — Drone Delivery Fleet Maintenance |
| **Track** | On-campus (24 hours) |
| **Repo** | https://github.com/yj657/sixsigmahackathon |
| **Live UI** | https://connect.systems-apps.com/content/a7bfcdd7-6564-45cb-b74e-09128cde8a93 |
| **User guide** | [`USER_GUIDE.md`](USER_GUIDE.md) — how to use the live UI, step by step |
| **Live API** | https://connect.systems-apps.com/content/61dce257-81d0-44e8-84c4-c10cfeae1bbe |
| **API docs** | https://connect.systems-apps.com/content/61dce257-81d0-44e8-84c4-c10cfeae1bbe/docs |
| **Technician UI** | React app in [`app/frontend/`](app/frontend/) — see [below](#technician-ui-react) |
| **Demo walkthrough** | [`demo/README.md`](demo/README.md) — every dataset, command and number |
| **Data codebook** | [`data/README.md`](data/README.md) — every file and column |
| **API details** | [`app/README.md`](app/README.md) — endpoints, validation, deploy |
| **Spec and task ledger** | [`SPEC.md`](SPEC.md), [`CONTRACT.yaml`](CONTRACT.yaml) |

The live API is open to anyone; no login or API key is needed.

---

## Who it is for, and the decision it supports

**User:** the fleet maintenance technician at a drone delivery startup.

**Decision:** after logging flight hours and failures, including drones that are still flying,
does model-estimated reliability for the next `plan_hours` of flying **meet the 90% threshold**,
or is a maintenance review recommended? The desk shows one of two sentences —
"Model-estimated reliability meets the 90% threshold." or "Model-estimated reliability is below
the 90% threshold; maintenance review is recommended." — together with the number of
observations, recorded failures, the drone's age and the planned additional hours, and a one-line
model assumption. Results are statistical estimates, **not a guarantee of flight safety**.

## The method, in plain words

The tool fits a **Weibull life model** to the fleet's flight hours ([SPEC §4](SPEC.md)).

- **Shape fixed at *m* = 2 (wear-out) — primary path.** The chance of failing in the next hour
  grows as a drone ages. This is an **assumption** for the maintain-now call; every response
  reports `m`. The [codebook](data/README.md) shows where it is conservative.
- **Secondary: free-*m* MLE** (`estimate_m=true`, needs *r* ≥ 2) jointly estimates shape and scale
  from the same right-censored likelihood.
- **Secondary: I-MR** on consecutive mission hours (`POST /imr`) for process monitoring.
- **Drones still flying count.** A drone that has not failed is *right-censored*: it lasted at
  least its current hours. Dropping those drones would make the fleet look much worse than it is.
- **Scale by maximum likelihood.** With *m* known, the characteristic life is
  \(\hat c = \big(\sum_{\text{all drones}} t_i^{\,m} \,/\, r\big)^{1/m}\), where *r* is the number
  of failed drones. Everything else follows from \(\hat c\):
  - MTTF \(= \hat c\,\Gamma(1 + 1/m)\)
  - reliability \(R(t) = \exp(-(t/\hat c)^m)\)
  - hazard \(z(t) = (m/\hat c)(t/\hat c)^{m-1}\)
  - B10 life \(= \hat c\,(-\ln 0.9)^{1/m}\), the age by which 10% of drones fail
- **Drones already in service (`current_age`).** For a drone that has already flown *a* hours and
  will fly *p* more (`plan_hours`), the chance to get through that next interval is the
  *conditional* reliability
  \(R_{\text{future}} = R(a+p)/R(a) = \exp\!\big(-[((a+p)/\hat c)^m - (a/\hat c)^m]\big)\).
  At `current_age` = 0 (the default) this is exactly the lifetime R(`plan_hours`).
  **Lifetime metrics** (ĉ, MTTF, B10) describe a new drone; **next-interval metrics**
  (`R_future`, the hazard at the end of the interval, the call) depend on the drone's age.
- **Model assumptions shown with every result:** the maintenance check fixes the shape at
  *m* = 2, i.e. it assumes an **increasing hazard rate** (wear-out); the wear-pattern check
  estimates the shape from the data, and the fitted shape sets the hazard pattern (> 1 rising,
  ≈ 1 constant, < 1 falling); the I-MR page monitors whether mission lengths stay steady.
- **One 90% rule, decided by the backend:** `R_future` ≥ 90% → `call` = `ok to fly` and
  `decision_message` = "Model-estimated reliability meets the 90% threshold."; below 90% →
  `maintain now` and "Model-estimated reliability is below the 90% threshold; maintenance review is
  recommended." A value mathematically equal to 90% passes (a 1e-12 tolerance absorbs rounding).
- **Numerically safe.** Every \(t^m\) term is computed in log space, so huge flight hours or
  shapes cannot overflow; data that still cannot be fitted return HTTP 422 with "These data
  cannot be calculated right now. Please check the data." instead of a crash.

**Known answer** (SPEC §4 B, checked by the tests): flight hours `[100, 120, 150, 200, 200]` with
failed `[1, 1, 1, 0, 0]` give Σt² = 126900, *r* = 3, so \(\hat c = \sqrt{42300} \approx 205.670\) h,
MTTF ≈ 182.270 h, B10 ≈ 66.759 h → below the 90% threshold for a 100 h plan (`call` =
`maintain now`).

**Limits:** primary path assumes *m* = 2; all drones in the data are assumed to come from one
wear-out population, and `current_age` must be the age of the drone you are checking; the test
datasets are small and invented, so the estimates are rough.

---

## Run it

From the repo root, once. Any Python 3 works (the deployed app runs on 3.12):

```bash
python3 -m venv .venv
```

```bash
source .venv/bin/activate
```

(On Windows: `.venv\Scripts\activate`.)

```bash
pip install -r app/requirements.txt
```

Check the statistics and input validation (expect `23 passed`):

```bash
pytest tests
```

**Start the tool with one command** (venv active), then open http://127.0.0.1:8000/docs:

```bash
./app/testme.sh
```

If `python3.11` is installed outside the venv and `testme.sh` stops with `No module named uvicorn`,
use `.venv/bin/python -m uvicorn app:app --app-dir app --host 0.0.0.0 --port 8000` instead
(details in [`app/README.md`](app/README.md)).

Try it on a dataset, in a second terminal:

```bash
curl "http://127.0.0.1:8000/analyze/file?name=wearout_baseline.csv"
```

Expected: `c_hat` ≈ 205.670, `call` `"maintain now"`.

## Technician UI (React)

A browser front end for the technician, in [`app/frontend/`](app/frontend/): three pages —
Weibull *m*=2, free-*m* fit, and I-MR. Load a demo sample or paste data; Weibull pages call
`POST /analyze`, I-MR calls `POST /imr`. Bad data shows the API's HTTP 400 message. Needs Node.js
and npm.

```bash
cd app/frontend
npm install
npm run dev
```

Then open the URL it prints (usually http://127.0.0.1:5173). It uses the **live Connect API** by
default; to use the local API from "Run it" instead:

```bash
VITE_API_URL=http://127.0.0.1:8000 npm run dev
```

Details: [`app/frontend/README.md`](app/frontend/README.md). The UI only displays results; all
statistics stay in `app/qc.py`.

---

## Inputs and parameters

| Name | Where | Type and units | Required | Meaning |
|---|---|---|---|---|
| `times` | `POST /analyze` body | list of numbers, flight hours, each > 0 | yes | Hours on each drone at failure, or its current hours if still flying |
| `failed` | `POST /analyze` body | list of 0/1, same length and order as `times` | yes | 1 = the drone failed; 0 = still flying or removed without failing (censored) |
| `plan_hours` | body or query | number, hours, finite and > 0 | no, default 100 | Additional flight hours planned before the next service |
| `current_age` | body or query | number, hours, finite and ≥ 0 | no, default 0 | Hours this drone has already flown (0 = a new drone) |
| `m` | body or query | number, > 0 | no, default 2 | Weibull shape when `estimate_m` is false |
| `estimate_m` | body or query | `true`/`false` | no, default false | If true, jointly MLE shape and scale (*r* ≥ 2) |
| `values` | `POST /imr` body | list of numbers | yes, for I-MR | Ordered mission-hour series |
| `name` | `/analyze/file` or `/imr/file` query | a CSV filename in `data/` | yes, for that route | Which test dataset to read (local only) |

As a CSV, the same data is one row per drone with columns `drone_id,time_hours,failed`; see the
[codebook](data/README.md) for units, collection and the rules for valid rows.

## Outputs

| Field | Units | Meaning |
|---|---|---|
| `c_hat` | hours | characteristic life: by this age about 63.2% of drones have failed |
| `mttf` | hours | mean time to failure |
| `B10` | hours | age by which 10% of new drones are expected to fail (lifetime) |
| `R_future` | probability | chance a drone at `current_age` gets through the next `plan_hours` (conditional reliability) |
| `R_plan` | probability | same value as `R_future`, kept for older clients |
| `z_plan` | failures per hour | hazard rate at the end of the interval (`end_age`) |
| `call` | text | `maintain now` or `ok to fly`, from the 90% rule (kept for API compatibility; the desk shows `decision_message` instead) |
| `decision_message` | text | the sentence to show users (see the rule above) |
| `meets_threshold`, `reliability_threshold` | bool, 0.90 | whether `R_future` ≥ 90%, and the threshold used |
| `n`, `r` | count | drones in the data, and how many failed |
| `current_age`, `plan_hours`, `end_age`, `m` | hours / — | the values used; `end_age` = `current_age` + `plan_hours` |
| `source` | text | the CSV used (`/analyze/file` only) |

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/` | API info and links |
| GET | `/docs` | Interactive docs: try every endpoint in the browser |
| POST | `/analyze` | Weibull analysis on JSON `times`, `failed`, optional `plan_hours`, `current_age`, `m`, `estimate_m`. **Use this on the live server** |
| GET | `/analyze/file?name=...` | Same analysis on a CSV in `data/`. **Local only**: `data/` is not deployed, so online it answers 404 |
| POST | `/imr` | I-MR chart on JSON `values` |
| GET | `/imr/file?name=...` | I-MR on a CSV in `data/` (**local only**) |

Bad input is refused, not guessed at: a missing, NaN, infinite or non-positive time, a `failed`
other than the numbers 0/1 (JSON `true`/`false` are rejected too), a negative or non-finite
`current_age`, a `plan_hours` that is not > 0, empty or mismatched lists, or no failures at all
return **HTTP 400** with a message naming the entry. Valid data that cannot be calculated return
**HTTP 422** ("These data cannot be calculated right now. Please check the data."). No stack
traces are shown. See [`app/README.md`](app/README.md#input-validation).

On the live server, send the data as JSON:

```bash
LIVE_URL="https://connect.systems-apps.com/content/61dce257-81d0-44e8-84c4-c10cfeae1bbe"
curl -X POST "$LIVE_URL/analyze" \
  -H "Content-Type: application/json" \
  -d '{"times":[100,120,150,200,200],"failed":[1,1,1,0,0],"plan_hours":100}'
```

Expected: `c_hat` ≈ 205.670, `call` `"maintain now"`. All four live commands are in
[`demo/README.md`](demo/README.md) section 5.

## How the code is organised

The statistics live in one plain module, [`app/qc.py`](app/qc.py); the API in
[`app/app.py`](app/app.py) only parses input and returns JSON.

| Function in `app/qc.py` | What it does |
|---|---|
| `analyze_fleet(times, failed, plan_hours=100, m=2, estimate_m=False, current_age=0, strict=False)` | Validates every input first, fits \(\hat c\) (and optionally \(\hat m\)), returns every output field above |
| `conditional_reliability(current_age, plan_hours, c, m)` | \(R(a+p)/R(a)\) in log space; equals `weibull_reliability(plan_hours)` at age 0 |
| `reliability_decision(reliability)` | The single 90% rule: `call`, `decision_message`, `meets_threshold` |
| `fit_weibull_scale(times, failed, m=2)` | Censored maximum-likelihood estimate of \(\hat c\) with known shape *m*; errors if *r* = 0 |
| `fit_weibull_mle(times, failed)` | Joint free-*m* MLE; needs *r* ≥ 2 |
| `imr_chart(values)` | Individuals–moving-range limits and out-of-control flags |
| `weibull_mttf(c, m)` | MTTF \(= c\,\Gamma(1 + 1/m)\) |
| `weibull_reliability(t, c, m)` | \(R(t) = \exp(-(t/c)^m)\) |
| `weibull_hazard(t, c, m)` | \(z(t) = (m/c)(t/c)^{m-1}\) |
| `b10_life(c, m)` | \(c\,(-\ln 0.9)^{1/m}\) |
| `maintenance_call(c, plan_hours, m)` | `maintain now` or `ok to fly` (rule above) |
| `validate_lifetime_sample(times, failed)` | Checks the lists are non-empty and the same length, checks every value, and counts the failures *r* |
| `load_lifetime_csv(path)` | Reads a `time_hours,failed` CSV, rejecting bad cells by line number |
| `coerce_time_hours(raw)`, `coerce_failed_flag(raw)` | Turn one cell into a valid time or 0/1 flag, or raise an error |

Tests: [`tests/test_qc.py`](tests/test_qc.py) (known answers, every dataset, edge cases) and
[`tests/test_api_validation.py`](tests/test_api_validation.py) (CSV validation).

## Test datasets

| File | Drones | Failed | Shows | Call at 100 h |
|---|---|---|---|---|
| [`wearout_baseline.csv`](data/wearout_baseline.csv) | 5 | 3 | normal mix of failed and still-flying drones; the known answer | below the 90% threshold (meets it at 50 h) |
| [`early_wearout.csv`](data/early_wearout.csv) | 6 | 4 | parts that wear out fast | below the 90% threshold |
| [`edge_all_censored.csv`](data/edge_all_censored.csv) | 3 | 0 | no failures yet | HTTP 400: cannot estimate |
| [`imr_mission_hours.csv`](data/imr_mission_hours.csv) | 9 missions | — | planted late jump for I-MR (SPEC §4 D) | I OOC at points 7–9 |

Every number, command and "how to read this" line is in [`demo/README.md`](demo/README.md).

---

## Repository map

```
app/        the FastAPI app: qc.py (statistics), app.py (API), testme.sh, manifestme.sh, deployme.sh
app/frontend/  the React technician UI (Vite); calls POST /analyze
data/       lifetime CSVs + I-MR series and the codebook
demo/       the demonstration on every dataset
tests/      pytest tests
SPEC.md     what the tool is; CONTRACT.yaml the task ledger
docs/       the hackathon's event pages (schedule, criteria, prompts) and our team notes
```

## Out of scope

No login or database, no Western Electric run rules beyond point-beyond-limits on I-MR, no live
drone telemetry.

## Credits

Built from the [Cornell Six Sigma Hackathon starter repo](https://github.com/timothyfraser/sixsigmahackathon)
by Timothy Fraser (MIT License, see [`LICENSE`](LICENSE)); the API started from its
`demos/fastapi/` template. Weibull formulas follow the SYSEN 5300 course text.
