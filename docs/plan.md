# Plan — kskbl · Drone Delivery Fleet Maintenance

**User:** fleet tech. **Question:** maintain now or ok to fly before the next mission?
**Primary stats (shape m = 2 fixed, wear-out):**  
- Scale MLE: \(c^m=(1/r)\sum_i t_i^m\) (sum includes right-censored)  
- MTTF \(=c\,\Gamma(1+1/m)\); \(R(t)=\mathrm{e}^{-(t/c)^m}\); \(z(t)=(m/c)(t/c)^{m-1}\); B10 at F=0.10  
**Call:** maintain if B10 ≤ plan_hours or R(plan_hours) < 0.90.

## Tasks (CONTRACT order)

1. **H-01** SPEC filled — owns `SPEC.md`. DoD: `grep -c "FILL IN[.,]" SPEC.md` → 0. (~done pending check-in)
2. **H-02** Data — owns `data/`. CSVs: `wearout_baseline.csv` (= known-answer B), `early_wearout.csv`, `edge_all_censored.csv` + codebook. Degenerate: all censored.
3. **H-03** Core QC — owns `app/qc.py`, `tests/`. Functions: `weibull_mttf`, `weibull_reliability`, `weibull_hazard`, `fit_weibull_scale` (m=2), `maintenance_call`. **Known A:** m=2,c=200 → MTTF≈177.245, R(100)≈0.778801, z(100)=0.005. **Known B:** times/failed as SPEC → ĉ≈205.670. **Degenerate:** r=0 → error.
4. **H-04** Tool — owns `app/` from `demos/fastapi/`, wire to `qc.py`. `testme` + curl on `wearout_baseline.csv` matches H-03. Then add `demos/reactfront/` → `app/frontend/`.
5. **H-08 early** Public repo already [yj657/sixsigmahackathon](https://github.com/yj657/sixsigmahackathon) — confirm remote; needed for H-06.
6. **H-06** Deploy Posit Connect — workflow + secrets + `manifest.json`. Live URL returns H-03 numbers.
7. **H-05** Demo walkthrough — owns `demo/`, `app/frontend/`. One page per CSV with numbers + how to read.
8. **H-07** README — root + `app/README.md`. Fresh-clone path.

## Decisions
- Track: on-campus 24h · Team: kskbl · Prompt 4 Industrial Systems  
- Method: Weibull + MTTF (+ censoring); I-MR only if time · Stack: FastAPI + React  
- Input: flight hours + failed flag · Repo: github.com/yj657/sixsigmahackathon

## Risks
1. **Wrong censoring formula** → unit test known-answer B before any UI.  
2. **Deploy late** → H-06 as soon as H-04 curls green.  
3. **Scope creep (I-MR, free m)** → ship Weibull first; extras only after review PASS.
