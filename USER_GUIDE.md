# User Guide — kskbl Fleet Reliability Desk

## 1. What it does, and for whom

The Fleet Reliability Desk is for a **drone fleet maintenance technician**. You give it each
drone's flight hours and whether it has failed — including drones that are **still flying** — and
it tells you whether the fleet should be **serviced before the next block of flying** (`maintain
now`) or can keep flying (`ok to fly`), with the numbers behind that call.

It also has a secondary page for checking whether **mission hours** are stable over time (an I-MR
control chart).

## 2. Open it

Open the live UI in any browser. No login or key is needed:

**https://connect.systems-apps.com/content/a7bfcdd7-6564-45cb-b74e-09128cde8a93**

In the page header, the API status should say **connected**. If it says **unreachable**, the
analysis buttons are disabled; try again later.

## 3. Run an analysis

1. **Choose a page** from the tabs:
   - **Weibull m=2**: the main maintenance decision. Start here.
   - **Free-m fit**: the same analysis, but the shape *m* is estimated from your data (see §6).
   - **I-MR chart**: stability of mission hours (see §7).
2. **Optional: load a sample.** Click a sample button to fill in the form:
   `wearout_baseline`, `baseline · plan 50 h`, `early_wearout` or `edge_all_censored`.
3. **Enter your fleet**, one value per drone, in the same order in both boxes. Separate values
   with commas or spaces.
   - **time_hours**: each drone's flight hours: at failure, or its hours today if still flying.
     Every value must be a number above 0.
   - **failed**: `1` if that drone failed, `0` if it is still flying or was removed without
     failing. Enter only `0` or `1`.
4. **Set plan_hours**: how many flight hours you want the fleet to cover before its next
   service (default 100).
5. Click **Run Weibull fit (m=2)** (or **Run free-m MLE** on the Free-m page).

The result shows a coloured banner with the call, a row of numbers, and a reliability curve. If
something is wrong with the input, a red message explains what to fix.

## 4. Reading the results

| On screen | Plain meaning |
|---|---|
| **maintain now** | Ground and service before the next mission: too many drones are expected to fail within `plan_hours` |
| **ok to fly** | At least 90% of drones are expected to get through `plan_hours` without failing |
| **m** | The Weibull *shape*. 2 means "wear-out": the older a drone, the likelier it fails |
| **ĉ (hours)** | Characteristic life: by this age about 63% of drones have failed |
| **MTTF** | Mean time to failure, in flight hours: the average life of a drone |
| **B10** | The age by which **10%** of drones are expected to fail. A safe service interval is below it |
| **R(plan)** | Reliability: the chance a drone survives to `plan_hours` without failing (0 to 1), counted from 0 h |
| **z(plan)** | Hazard: the failure rate per flight hour at `plan_hours`. Higher means riskier right now |
| **n / r** | Number of drones you entered / how many of them failed |
| **Reliability curve** | R(t), the share of drones still working at each age. The horizontal line is 0.9, the vertical mark is your `plan_hours`, and the dot is B10 |

**The rule:** the tool says `maintain now` when B10 ≤ `plan_hours` (equivalently, R(plan) is
below 0.90). Otherwise it says `ok to fly`.

## 5. Worked examples (Weibull m=2 page)

Load each sample and run it. These results were checked against the live API.

| Sample | Fleet | plan_hours | ĉ | MTTF | B10 | R(plan) | Call |
|---|---|---|---|---|---|---|---|
| `wearout_baseline` | 5 drones: failed at 100, 120, 150 h; 2 still flying at 200 h | 100 | 205.670 | 182.270 | 66.759 | 0.7895 | **maintain now** |
| `baseline · plan 50 h` | same fleet | 50 | 205.670 | 182.270 | 66.759 | 0.9426 | **ok to fly** |
| `early_wearout` | 6 drones: failed at 40–55 h; 2 still flying at 60 h | 100 | 63.934 | 56.660 | 20.752 | 0.0866 | **maintain now** |

How to read them:

- **Baseline, 100 h:** 10% of drones are expected to fail by about 67 h, so flying 100 h before
  service is too long.
- **Baseline, 50 h:** 50 h is inside the B10 life, and about 94% of drones get there, so the fleet
  can fly 50 more hours.
- **Early wear-out:** only about 9% of drones would survive to 100 h. This fleet needs service far
  sooner.

## 6. When there are no failures yet

If every drone is still flying (all `failed` values are `0`, like the `edge_all_censored`
sample), the tool **refuses to give numbers** and shows:

> need at least one failure to estimate scale (r=0: all observations censored)

With no failures there is no evidence about *when* drones fail, so the tool will not invent an
answer. Keep logging until the first failure. The **Free-m fit** page needs at least **two**
failures.

## 7. The other two pages

- **Free-m fit** estimates the shape *m* from your data instead of assuming 2. Use it as a check
  on the m = 2 assumption, not as the main decision. For example, on `early_wearout` it gives
  m̂ ≈ 5.709 and B10 ≈ 39.019 h. With only a handful of failures, m̂ is uncertain.
- **I-MR chart** takes an ordered list of **mission hours** (one value per mission) and plots the
  individual values and their moving ranges with control limits. Red points are outside the
  limits. The `imr_mission_hours` sample flags missions 7–9; `steady missions` flags none. Only
  points beyond the limits are flagged; no other run rules are applied.

## 8. Assumptions and limits

- **The shape is fixed at m = 2 on the main page.** This assumes wear-out; it is not estimated
  from your data. If your parts fail at random or early in life, the call can be wrong.
- **R(plan) is counted from 0 hours**, not from a drone's current age.
- **Every drone is assumed to fail independently**, with one failure mode in the data.
- **Drones still flying must be included** (as `failed = 0`). Leaving them out makes the fleet look
  much worse than it is.
- **Small samples give rough answers.** The examples have only 3–4 failures.
- **The samples are invented demo data**, not real fleet records.
- **This is a decision aid, not a flight-safety certification system.** It does not replace
  inspections, manufacturer limits, airworthiness rules or an engineer's judgement.

## 9. Links

| | |
|---|---|
| Live UI | https://connect.systems-apps.com/content/a7bfcdd7-6564-45cb-b74e-09128cde8a93 |
| Interactive API docs | https://connect.systems-apps.com/content/61dce257-81d0-44e8-84c4-c10cfeae1bbe/docs |
| GitHub repository | https://github.com/yj657/sixsigmahackathon/tree/kskbl |
| Demo walkthrough | [`demo/README.md`](demo/README.md) |
| Data codebook | [`data/README.md`](data/README.md) |
| Developer README | [`README.md`](README.md) |
