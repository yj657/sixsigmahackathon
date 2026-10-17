# SPEC: Six Sigma Hackathon team project

What your tool IS. Your agent reads this before every task. Where the code and this file
disagree, the code is the bug: change this file first, then the code.

Most of this page is already decided by the event and the [rubric](docs/criteria.md).
**Only the `FILL IN` lines change, and you do not have to write them by hand:** describe your app and ask your agent to update them. They depend on the prompt your team picks at kickoff
(prompts are secret until then, see [`docs/prompts.md`](docs/prompts.md)) and on your team.
The examples after each `FILL IN` show the shape of an answer. They are not hints about the prompts.

## 1. Team and prompt
- **Team name:** kskbl
- **Track:** on-campus (24 hours). See [`docs/schedule.md`](docs/schedule.md).
- **Prompt we chose:** 4. Industrial Systems — Drone Delivery Fleet Maintenance
- **Our public repo:** github.com/yj657/sixsigmahackathon

## 2. User and use case (rubric: scope 5, user and use case 5)
- **User:** fleet maintenance technician at a drone delivery startup
- **Decision the tool helps them make, and when:** after logging flight hours and failures (including drones still flying), whether to schedule preventive maintenance before the next mission — instead of waiting for a mid-air crash
- **Why this matches the prompt:** the prompt asks for a tool that logs wear-and-tear and improves reliability before failures; Weibull + MTTF turns those logs into a maintain-now vs fly-again call

## 3. Inputs (rubric: minimal inputs 5)
Only what this user can actually measure or already knows. Fewer is better; every input a user
cannot measure costs points.

| Input | Type and units | Where the user gets it |
|---|---|---|
| `time_hours` | numeric, flight hours (or cycles treated as hours) | drone log / hour meter at failure or at inspection |
| `failed` | 0/1 (1 = failed in flight or grounded as failed; 0 = still operating = right-censored / Type I) | maintenance ticket or still-flying status |
| optional `plan_hours` | numeric, additional hours planned before the next service, > 0 (default 100) | dispatch schedule |
| optional `current_age` | numeric, hours the drone has already flown, ≥ 0 (default 0 = new drone) | the drone's hour meter |

## 4. The statistics, and why (rubric: valid QC analysis 25)
Say the method in words before any code exists. Load the `stats-first-steering` skill first.
- **Method (primary):** two-parameter Weibull life model with right-censored (Type I) observations. Shape *m* is fixed at 2 for the primary estimator (wear-out / Rayleigh, course case *m* > 1). Scale (characteristic life) *c* is estimated by MLE: \(c^m = (1/r)\sum_{i=1}^{n} t_i^m\), sum over failures and censored units, *r* = number of failures. From \((\hat m, \hat c)\) report MTTF \(= c\,\Gamma(1+1/m)\), reliability \(R(t)=\exp(-(t/c)^m)\), hazard \(z(t)=(m/c)(t/c)^{m-1}\), and B10 life (time at F=0.10).
- **Method (secondary, H-09):** (1) **Free-*m* MLE** — jointly estimate shape and scale from the right-censored likelihood (profile over *m*, then \(c^m=(1/r)\sum t_i^m\)); needs *r* ≥ 2. (2) **I-MR chart** on a univariate time series (e.g. consecutive mission hours): moving range \(\mathrm{MR}_i=|x_i-x_{i-1}|\), \(\overline{\mathrm{MR}}\), individuals limits \(\bar x\pm E_2\overline{\mathrm{MR}}\) with \(E_2=3/d_2\) and \(d_2=1.128\) (span 2), MR limits \(D_3=0\), \(D_4=3.267\).
- **Why it fits the use case:** drone wear increases with flight hours (*m* > 1); many units are still flying, so censoring must enter the likelihood; MTTF / R(t) / B10 tell the tech when to maintain before a crash. Free-*m* checks whether wear-out is sharper than *m*=2; I-MR flags a sudden jump in mission-hour process.
- **Assumptions and how the tool checks them:** independent lives; primary Weibull wear-out shape *m*=2 (stated on the UI); at least one failure (*r* ≥ 1) for fixed-*m*, *r* ≥ 2 for free-*m*, or the fit returns an error; censored times are last-seen hours, not failures. I-MR needs ≥ 2 points and finite values. Degenerate: *r*=0 or *n*<1 → clear error, never inf.
- **Known-answer check:**
  - **A (closed form, known params):** *m*=2, *c*=200 h. Then MTTF = \(200\cdot\Gamma(1.5)=200\cdot\sqrt{\pi}/2\approx 177.245\) h; \(R(100)=\mathrm{e}^{-(100/200)^2}=\mathrm{e}^{-0.25}\approx 0.778801\); \(z(100)=(2/200)\cdot(100/200)=0.005\) /h; B10 = \(200\cdot(-\ln 0.9)^{1/2}\approx 64.919\) h.
  - **B (MLE for *c*, *m*=2 fixed, right-censored):** times `[100, 120, 150, 200, 200]` with failed `[1,1,1,0,0]`. \(\sum t_i^2=126900\), *r*=3, \(\hat c=\sqrt{126900/3}=\sqrt{42300}\approx 205.670\) h; MTTF ≈ 182.270 h; \(R(100)\approx 0.789460\).
  - **C (free-*m* MLE on `early_wearout.csv`):** \(\hat m\approx 5.709\), \(\hat c\approx 57.869\) h, B10 ≈ 39.019 h (sharper wear-out than *m*=2).
  - **D (I-MR, planted shift):** values `[10,12,11,13,12,11,25,26,24]`. \(\bar x=16\), eight MRs with \(\overline{\mathrm{MR}}=3\); I UCL/LCL ≈ 23.98 / 8.02; MR UCL ≈ 9.801; points 7–9 and MR at step 7 out of control.

Fixed for every team:
- The statistic lives in **one plain, tested function** (`app/qc.py` or `app/qc.R`). The API, app or
  package only calls it and displays the result. No statistics inside UI code.
- Every statistic has a test against a known answer and a degenerate case (constant data, n = 1, missing values).
- You can explain every number the tool prints. If you cannot, it is not done.

## 5. Delivery (rubric: working tool 25)
- **Stack:** REST API (FastAPI) + React dashboard
- **Starting demo:** `demos/fastapi/` into `app/` (statistics in `app/qc.py`); `demos/reactfront/` into `app/frontend/` when the API works

Fixed for every team:
- Start from **one** demo in `demos/`, copied to `app/`. Keep its four-script contract
  (`testme`, `manifestme`, `deployme`, `README.md`); `testme` starts the tool with one command.
- Deployed on the course **Posit Connect** server with a public URL (publisher key handed out at the
  event). Deploy early: copy one workflow from
  [`.claude/skills/connect-publish/workflows/`](.claude/skills/connect-publish/workflows/).
- A small tool that runs beats a large tool that does not.

## 6. Outputs
- **What the user sees:** lifetime metrics for a new drone — fitted \(\hat c\) (hours), MTTF (hours), B10 life (hours); next-interval metrics for a drone at `current_age` flying `plan_hours` more — conditional reliability R_future = R(current_age + plan_hours) / R(current_age) and the hazard at current_age + plan_hours; and one backend decision: **ok to fly** if the next-interval reliability `R_future` = R(`current_age` + `plan_hours`) / R(`current_age`) is at least 90% (with `current_age` = 0 this is R(`plan_hours`)); otherwise **maintain now** (one rule, decided in `qc.py`; exactly 90% passes), with the `decision_message` sentence; plus a reliability curve R(t) vs hours. Optional: free-\(\hat m\) fit and an I-MR page for mission-hour process control. How to read: if R for the next mission is below 0.90, ground and service before dispatch.

## 7. Test datasets and codebook (rubric: demo 10, datasets 5, codebook 5)
2-3 small CSVs in `data/`, invented but shaped like real field data, each showing one behavior.
`data/README.md` is the codebook: every file, every column with units, and what it would take to
collect this data for real.
- **Datasets:** `wearout_baseline.csv` (mixed failures + censored, matches known-answer B), `early_wearout.csv` (shorter lives, B10 forces maintain; also free-*m* known-answer C), `edge_all_censored.csv` (*r*=0, tool must error clearly), `imr_mission_hours.csv` (consecutive mission hours with a planted late shift for I-MR known-answer D)

## 8. Documentation and reproducibility (rubric: docs 10, public repo 5)
- `README.md` says what the tool does, for whom, every input and parameter, how to run it in one
  command, and walks through the demo on each test dataset.
- Public GitHub repo; a fresh clone runs `testme` and the tests pass with no extra steps.
- Submit on Devpost: the repo link plus a demo.

## 9. Out of scope
What we will NOT build, so nobody (human or agent) builds it by accident.
- Default: logins, databases, real customer data, a second statistic before the first one is tested.
- No live drone telemetry stream; no crash reconstruction; no multi-fleet comparison; no Western Electric run rules beyond point-beyond-limits on I-MR; no attribute (p/np/c/u) charts.
