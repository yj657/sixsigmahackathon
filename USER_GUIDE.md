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

In the page header, **Calculation service (API)** should say **connected**. If it says
**unreachable**, the run buttons are disabled; try again later.

## 3. Run an analysis

1. **Choose a page** from the tabs:
   - **Maintenance check (Weibull m=2)**: the main decision. Start here.
   - **Wear-pattern check (Free-m fit)**: the same check, but the wear-out shape is estimated
     from your data (see §7).
   - **Mission-hours stability (I-MR chart)**: are mission lengths steady? (see §7).
2. **Optional: load a sample.** Click a sample button to fill in the form:
   `wearout_baseline`, `baseline · plan 50 h`, `early_wearout` or `edge_all_censored`.
3. **Enter your fleet**, one value per drone, in the same order in both boxes. Separate values
   with commas or spaces.
   - **Flight hours per drone (time_hours)**: hours at failure, or hours so far if the drone is
     still flying. Every value must be a number above 0.
   - **Did it fail? (failed)**: `1` if that drone failed, `0` if it is still flying or was removed
     without failing. Enter only `0` or `1`.
4. **Set Planned flight hours before next service (plan_hours)**: how many hours the fleet should
   fly before it is serviced (default 100).
5. Click **Run maintenance check (Weibull m=2)** (or **Run wear-pattern check (free-m fit)** on
   the wear-pattern page).

The result shows a coloured banner with the call, a set of labelled results, and a reliability
curve. If something is wrong with the input, a red message explains what to fix.

## 4. Reading the results

Each result is shown with a plain name, the technical name in brackets, and its units. For a
short explanation, **hover over the small ⓘ icon** next to a result or chart title. You can also
**Tab** to the icon with the keyboard, or **click/tap** it to keep the explanation open; press
**Escape** or click elsewhere to close it.

| On screen | Units | Plain meaning |
|---|---|---|
| **maintain now** | — | Ground and service before the next mission: too many drones are expected to fail within your planned hours |
| **ok to fly** | — | At least 90% of drones are expected to get through your planned hours without failing |
| **Chance to complete the plan (reliability R)** | % | Share of drones expected to fly your planned hours without failing, counted from 0 h. Below 90% means service first. Very small values show as `< 0.01%` |
| **10% failure age (B10 life)** | flight hours | By this age, 1 drone in 10 is expected to have failed. Service before it |
| **Average life (MTTF, mean time to failure)** | flight hours | How long a drone lasts on average before it fails |
| **Characteristic life (ĉ)** | flight hours | By this age, about 63% of drones are expected to have failed |
| **Failure rate at planned hours (hazard z)** | per flight hour | How fast a drone that has reached your planned hours is failing. Higher is riskier |
| **Wear-out shape, fixed (m)** | — | Set to 2 on the maintenance check: older drones are more likely to fail. Assumed, not measured |
| **Drones / failures (n / r)** | count | Drones in your data, and how many of them failed |
| **Reliability curve** | — | The share of drones still working at each age. The horizontal line is 90%, the vertical mark is your planned hours, and the dot is the 10% failure age (B10) |

**The rule:** the tool says `maintain now` when the 10% failure age (B10) is at or below your
planned hours (equivalently, the chance to complete the plan is below 90%). Otherwise it says
`ok to fly`.

## 5. Worked examples (maintenance check page)

Load each sample and run it. These results were checked against the live API.

| Sample | Fleet | Planned hours | Characteristic life (ĉ) | Average life (MTTF) | 10% failure age (B10) | Chance to complete the plan (R) | Call |
|---|---|---|---|---|---|---|---|
| `wearout_baseline` | 5 drones: failed at 100, 120, 150 h; 2 still flying at 200 h | 100 | 205.670 h | 182.270 h | 66.759 h | 78.95% | **maintain now** |
| `baseline · plan 50 h` | same fleet | 50 | 205.670 h | 182.270 h | 66.759 h | 94.26% | **ok to fly** |
| `early_wearout` | 6 drones: failed at 40–55 h; 2 still flying at 60 h | 100 | 63.934 h | 56.660 h | 20.752 h | 8.66% | **maintain now** |

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
answer. Keep logging until the first failure. The **Wear-pattern check (Free-m fit)** page needs
at least **two** failures.

## 7. The other two pages

- **Wear-pattern check (Free-m fit)** estimates the wear-out shape from your data instead of
  assuming 2, shown as **Wear-out shape, estimated (m̂)**: above 1 means parts wear out with age,
  about 1 means failures are random, below 1 means early failures. Use it as a check on the
  m = 2 assumption, not as the main decision. For example, on `early_wearout` it gives m̂ ≈ 5.709,
  a 10% failure age (B10) of 39.019 flight hours, and a chance to complete a 100-hour plan of
  `< 0.01%`. With only a handful of failures, m̂ is uncertain.
- **Mission-hours stability (I-MR chart)** takes **Hours flown per mission**, one value per
  mission in the order flown. It shows:
  - **Unusual missions** and **Unusual jumps between missions**: how many points fall outside the
    normal limits;
  - **Average mission length (x̄)**, **Average change between missions (mR̄)** and **Normal spread
    (σ̂)**, all in hours;
  - two charts, **Hours per mission (Individuals chart)** and **Change from the previous mission
    (Moving-range chart)**, with upper and lower limits. Red points are outside the limits and
    worth checking.

  The `imr_mission_hours` sample flags missions 7–9 (3 unusual missions, 1 unusual jump);
  `steady missions` flags none. Only points outside the limits are flagged; no other pattern
  rules are applied.

## 8. Assumptions and limits

- **The shape is fixed at m = 2 on the main page.** This assumes wear-out; it is not estimated
  from your data. If your parts fail at random or early in life, the call can be wrong.
- **The chance to complete the plan is counted from 0 hours**, not from a drone's current age.
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
