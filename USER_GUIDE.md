# User Guide — kskbl Fleet Reliability Desk

## 1. What it does, and for whom

The Fleet Reliability Desk is for a **drone fleet maintenance technician**. You give it each
drone's flight hours and whether it has failed — including drones that are **still flying** — and
it tells you whether **model-estimated reliability** for the next block of flying **meets the 90%
threshold**, or is below it and a **maintenance review is recommended**, with the numbers behind
that result. It is a statistical estimate, **not a guarantee of flight safety**.

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
   `wearout_baseline`, `baseline · plan 50 h`, `baseline · drone at 150 h`, `early_wearout` or
   `edge_all_censored`.
3. **Enter your fleet**, one value per drone, in the same order in both boxes. Separate values
   with commas or spaces.
   - **Flight hours per drone (time_hours)**: hours at failure, or hours so far if the drone is
     still flying. Every value must be a number above 0.
   - **Did it fail? (failed)**: `1` if that drone failed, `0` if it is still flying or was removed
     without failing. Enter only `0` or `1`.
4. **Set Drone age now, in flight hours (current_age)**: how many hours the drone you are
   checking has already flown. Leave it at `0` for a new drone.
5. **Set Planned flight hours before next service (plan_hours)**: the **additional** hours you
   plan to fly from now until the next service (default 100).
6. Click **Run maintenance check (Weibull m=2)** (or **Run wear-pattern check (free-m fit)** on
   the wear-pattern page).

The result shows a coloured banner with the call and the server's decision sentence, the
results for the **next interval** (from the drone's age now to age + planned hours), the **fleet
lifetime** numbers (counted from new), and a reliability curve.

If something is wrong with the input, a **“Please fix before running”** list under the form names
each problem (for example “Did it fail?, entry 5 ("0.5"): must be 0 (still flying) or 1
(failed)”), the field is outlined in red, and the Run button stays disabled until it is fixed.

## 4. Reading the results

Each result is shown with a plain name, the technical name in brackets, and its units. For a
short explanation, **hover over the small ⓘ icon** next to a result, chart title, input field,
sample or page title (explanations stay hidden until you ask for them). You can also
**Tab** to the icon with the keyboard, or **click/tap** it to keep the explanation open; press
**Escape** or click elsewhere to close it.

| On screen | Units | Plain meaning |
|---|---|---|
| Banner (green) | — | “Model-estimated reliability meets the 90% threshold.” |
| Banner (red) | — | “Model-estimated reliability is below the 90% threshold; maintenance review is recommended.” |
| **Observations (drones) · Recorded failures** | count | How many drones the result is based on, and how many of them failed. Shown under every result |
| **Drone age now · Planned additional flight hours** | flight hours | The two values the check used. Shown under every result |
| **Model:** line | — | The model's assumption in one line (hover the ⓘ for details): see *Model assumptions* below |
| *Next interval (conditional)* | | *For a drone that has already flown its current age, over the planned additional hours* |
| **Chance to get through the next interval (conditional reliability)** | % | For a drone that has already flown its current age, the chance it flies the next planned hours without failing. 90% or more meets the threshold. Very small values show as `< 0.01%` |
| **Failure rate at end of interval (hazard z)** | per flight hour | How fast a drone is failing once it reaches age + planned hours. Higher is riskier |
| *Lifetime (from a new drone)* | | *Describe a brand-new drone, counted from 0 hours; they do not change with age* |
| **10% failure age (B10 life)** | flight hours | Counted from new: by this age, 1 drone in 10 is expected to have failed |
| **Average life (MTTF, mean time to failure)** | flight hours | Counted from new: how long a drone lasts on average before it fails |
| **Characteristic life (ĉ)** | flight hours | Counted from new: by this age, about 63% of drones are expected to have failed |
| **Wear-out shape (m or m̂)** | — | Fixed at 2 on the maintenance check; estimated from your data on the wear-pattern check |
| **Lifetime reliability curve (from new)** | — | The share of new drones still working at each age. The horizontal line is 90% and the dot is the 10% failure age (B10). For an older drone, the shaded band is the next interval; its conditional chance is the number above, not a point on this curve |

**Conditional vs lifetime.** The *chance to get through the next interval* is **conditional**: it
assumes the drone has already flown its current age without failing. *Lifetime* numbers are for a
**new** drone. At age 0 the two coincide; for an older wear-out drone the conditional chance is
lower.

**The rule (one rule, applied by the server):** if the chance to get through the next interval is
**90% or more**, the banner says “Model-estimated reliability meets the 90% threshold.”;
otherwise it says “Model-estimated reliability is below the 90% threshold; maintenance review is
recommended.” A result exactly equal to 90% passes. For a new drone (age 0) the chance is the ordinary reliability R(planned hours), so
the 10% failure age (B10) and the planned hours give the same answer: planned hours at or below
B10 pass.

## 5. Worked examples (maintenance check page)

Load each sample and run it. These results were checked against the live API.

| Sample | Observations / failures | Age now | Planned additional hours | Characteristic life (ĉ) | Average life (MTTF) | 10% failure age (B10) | Chance to get through the next interval | Banner |
|---|---|---|---|---|---|---|---|---|
| `wearout_baseline` (failed at 100, 120, 150 h; 2 still flying at 200 h) | 5 / 3 | 0 | 100 | 205.670 h | 182.270 h | 66.759 h | 78.95% | **below the 90% threshold** |
| `baseline · plan 50 h` | 5 / 3 | 0 | 50 | 205.670 h | 182.270 h | 66.759 h | 94.26% | **meets the 90% threshold** |
| `baseline · drone at 150 h` | 5 / 3 | 150 | 50 | 205.670 h | 182.270 h | 66.759 h | 66.12% | **below the 90% threshold** |
| `early_wearout` (failed at 40–55 h; 2 still flying at 60 h) | 6 / 4 | 0 | 100 | 63.934 h | 56.660 h | 20.752 h | 8.66% | **below the 90% threshold** |

How to read them:

- **Baseline, 100 h:** 10% of drones are expected to fail by about 67 h, so flying 100 h before
  service is too long.
- **Baseline, 50 h:** 50 h is inside the B10 life, and about 94% of drones get there, so the fleet
  can fly 50 more hours.
- **Same fleet, drone already at 150 h, 50 h more:** the lifetime numbers do not change, but an
  old drone under wear-out is riskier: only about 66% get from 150 h to 200 h, so this drone needs
  a maintenance review first.
- **Early wear-out:** only about 9% of drones would survive to 100 h. This fleet needs service far
  sooner.

## 6. When there are no failures yet

If every drone is still flying (all `failed` values are `0`, like the `edge_all_censored`
sample), the tool **refuses to give numbers** and shows:

> need at least one failure to estimate scale (r=0: all observations censored)

With no failures there is no evidence about *when* drones fail, so the tool will not invent an
answer. Keep logging until the first failure. The **Wear-pattern check (Free-m fit)** page needs
at least **two** failures.

If the data are valid but the model still cannot produce a trustworthy number (for example, every
failure at exactly the same hour on the wear-pattern check, or extremely large values), the tool
shows: **“These data cannot be calculated right now. Please check the data.”** It never shows a
made-up number in that case.

## 7. The other two pages

- **Wear-pattern check (Free-m fit)** estimates the wear-out shape from your data instead of
  assuming 2, shown as **Wear-out shape, estimated (m̂)**: above 1 means parts wear out with age,
  about 1 means failures are random, below 1 means early failures. Use it as a check on the
  m = 2 assumption, not as the main decision. For example, on `early_wearout` it gives m̂ ≈ 5.709,
  a 10% failure age (B10) of 39.019 flight hours, and a chance to complete a 100-hour plan of
  `< 0.01%`. With only a handful of failures, m̂ is uncertain. Like the main check, every result
  shows the observations, recorded failures, age and planned additional hours.
- **Mission-hours stability (I-MR chart)** monitors whether mission lengths stay steady from one
  mission to the next. It takes **Hours flown per mission**, one value per mission in the order
  flown, and shows the number of **missions analysed** (failures, age and planned hours do not
  apply here) and:
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

Every result shows a one-line **Model:** assumption; hover its ⓘ for the details.

- **Maintenance check (Weibull m=2): the shape is fixed at 2**, so the model assumes an
  **increasing hazard rate**: the older a drone, the faster it fails (wear-out). The shape is
  assumed, not estimated. If your parts fail at random or early in life, the result can be wrong.
- **Wear-pattern check (Free-m fit): the shape is estimated from your data**, and the fitted
  shape sets the hazard pattern: above 1 the failure rate rises with age, about 1 it stays
  constant, below 1 it falls.
- **Mission-hours stability (I-MR chart)** only flags missions whose hours, or change from the
  previous mission, fall outside the limits; it does not predict failures.
- **Enter the right age.** The next-interval chance uses the `current_age` you enter; leaving it
  at 0 for an old drone makes it look safer than it is.
- **Every drone is assumed to fail independently**, with one failure mode in the data.
- **Drones still flying must be included** (as `failed = 0`). Leaving them out makes the fleet look
  much worse than it is.
- **Small samples give rough answers.** The examples have only 3–4 failures.
- **The samples are invented demo data**, not real fleet records.
- **These are model estimates, not a guarantee of flight safety.** The tool is a decision aid,
  not a flight-safety certification system. It does not replace inspections, manufacturer limits,
  airworthiness rules or an engineer's judgement.

## 9. Links

| | |
|---|---|
| Live UI | https://connect.systems-apps.com/content/a7bfcdd7-6564-45cb-b74e-09128cde8a93 |
| Interactive API docs | https://connect.systems-apps.com/content/61dce257-81d0-44e8-84c4-c10cfeae1bbe/docs |
| GitHub repository | https://github.com/yj657/sixsigmahackathon/tree/kskbl |
| Demo walkthrough | [`demo/README.md`](demo/README.md) |
| Data codebook | [`data/README.md`](data/README.md) |
| Developer README | [`README.md`](README.md) |
