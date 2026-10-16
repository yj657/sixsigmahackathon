# kskbl — Drone Fleet Reliability API

FastAPI wrapper around `qc.py` (Weibull m=2, right-censored MLE).

## Python environment

Use a Python that has `pip` and can install this folder’s requirements (the
hackathon machines often need **Python 3.11** if Homebrew `python3` is broken):

```bash
cd app
python3.11 -m pip install -r requirements.txt
# or: python3 -m pip install -r requirements.txt
```

Then start the API (no arguments):

```bash
./testme.sh
# docs: http://127.0.0.1:8000/docs
```

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/` | API info |
| GET | `/docs` | Interactive OpenAPI docs |
| POST | `/analyze` | JSON body: `times`, `failed`, optional `plan_hours`, `m` |
| GET | `/analyze/file?name=wearout_baseline.csv` | **Local only** — reads repo `data/` next to `app/` |

### Local vs deployed

- **`GET /analyze/file`** works on your laptop because the repo’s `data/` folder
  sits beside `app/`. The Posit Connect bundle ships **only** `app/`, so that
  route will 404 (or fail) online. Prefer it for local demos and tests.
- **After deploy**, send the same numbers with **`POST /analyze`**.

Local file example:

```bash
curl "http://127.0.0.1:8000/analyze/file?name=wearout_baseline.csv"
```

Deployed (or local) JSON example — same airframes as `wearout_baseline.csv`:

```bash
curl -X POST "http://127.0.0.1:8000/analyze" \
  -H "Content-Type: application/json" \
  -d '{"times":[100,120,150,200,200],"failed":[1,1,1,0,0],"plan_hours":100}'
```

Replace the host with your Connect URL after deploy. Expected: `c_hat` ≈ 205.670
(SPEC §4 known-answer B), `call`: `"maintain now"`.

Other demo bodies (from `data/`):

```bash
# early_wearout.csv → maintain now
curl -X POST "http://127.0.0.1:8000/analyze" \
  -H "Content-Type: application/json" \
  -d '{"times":[40,45,50,55,60,60],"failed":[1,1,1,1,0,0],"plan_hours":100}'

# edge_all_censored.csv → HTTP 400 (need at least one failure)
curl -X POST "http://127.0.0.1:8000/analyze" \
  -H "Content-Type: application/json" \
  -d '{"times":[80,90,100],"failed":[0,0,0],"plan_hours":100}'
```

## Response fields

`c_hat`, `mttf`, `R_plan`, `z_plan`, `B10`, `call` (`maintain now` \| `ok to fly`),
`n`, `r`, `plan_hours`, `m` (and `source` when using `/analyze/file`).

## Deploy (Posit Connect)

Secrets stay in gitignored `app/.env` and/or GitHub Actions secrets — never in git.

```bash
cd app
cp .env.example .env   # once; fill CONNECT_SERVER and CONNECT_API_KEY
./manifestme.sh        # regenerate manifest.json after any app/ file change
./deployme.sh
```

Or push branch `kskbl` and use the **Deploy FastAPI to Posit Connect** workflow
(requires repo secrets `CONNECT_SERVER` and `CONNECT_API_KEY`).

## Four-script contract

| File | Job |
|---|---|
| `testme.sh` | local server on port 8000 |
| `manifestme.sh` | write `manifest.json` for Posit Connect |
| `deployme.sh` | publish to Posit Connect |
