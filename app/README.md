# kskbl — Drone Fleet Reliability API

FastAPI wrapper around `qc.py` (Weibull m=2, right-censored MLE).

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/` | API info |
| GET | `/docs` | Interactive OpenAPI docs |
| POST | `/analyze` | JSON body: `times`, `failed`, optional `plan_hours`, `m` |
| GET | `/analyze/file?name=wearout_baseline.csv` | Same analysis on a `data/` CSV |

## Response fields

`c_hat`, `mttf`, `R_plan`, `z_plan`, `B10`, `call` (`maintain now` \| `ok to fly`), `n`, `r`, `plan_hours`, `m`.

## Run locally

```bash
cd app
python3.11 -m pip install -r requirements.txt
./testme.sh
# then: http://localhost:8000/docs
curl "http://127.0.0.1:8000/analyze/file?name=wearout_baseline.csv"
```

Expected for `wearout_baseline.csv`: `c_hat` ≈ 205.670 (SPEC §4 known-answer B).

## Four-script contract

| File | Job |
|---|---|
| `testme.sh` | local server on port 8000 |
| `manifestme.sh` | write `manifest.json` for Posit Connect |
| `deployme.sh` | publish to Posit Connect |
