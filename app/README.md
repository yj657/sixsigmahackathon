# kskbl — Drone Fleet Reliability API

FastAPI wrapper around `qc.py` (Weibull m=2, right-censored MLE).

## Run locally

Run these from the **repo root** (the folder above `app/`), the same way as
[`demo/README.md`](../demo/README.md). Any Python 3 works; `python3.11` is not required. A virtual
environment keeps the packages separate. `.venv/` stays on your machine; do not commit it.

```bash
python3 -m venv .venv
```

If your `python3` is broken (this happens with some Homebrew installs on the hackathon machines),
create the venv with `python3.11 -m venv .venv` instead; the steps below are the same.

```bash
source .venv/bin/activate
```

```bash
pip install -r app/requirements.txt
```

Check the statistics and the input validation (expect `17 passed`):

```bash
pytest tests
```

Start the API with the venv still active. `testme.sh` runs `python3`, which is the venv's Python
once the venv is active:

```bash
./app/testme.sh
```

If `python3.11` is installed on your machine, `testme.sh` picks it first, outside the venv, and stops
with `No module named uvicorn`. In that case start the API with the venv's Python directly:

```bash
.venv/bin/python -m uvicorn app:app --app-dir app --host 0.0.0.0 --port 8000
```

Then open http://127.0.0.1:8000/docs, and in a second terminal:

```bash
curl "http://127.0.0.1:8000/analyze/file?name=wearout_baseline.csv"
```

Expected for `wearout_baseline.csv`: `c_hat` ≈ 205.670 (SPEC §4 known-answer B), `call`:
`"maintain now"`. The expected numbers for every dataset are in
[`demo/README.md`](../demo/README.md).

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/` | API info |
| GET | `/docs` | Interactive OpenAPI docs |
| POST | `/analyze` | JSON body: `times`, `failed`, optional `plan_hours`, `m`. Works locally **and** on the deployed server |
| GET | `/analyze/file?name=wearout_baseline.csv` | Same analysis on a `data/` CSV. **Local only** (see below) |

### Local vs deployed

`/analyze/file` reads the CSV from the repo's `data/` folder, one level above `app/`. That works on
your laptop. Only the `app/` folder is deployed to Posit Connect (the files listed in
`manifest.json`), so `data/` is not on the server. There, `/analyze/file` answers
`404 data file not found`. Use it for local demos and tests.

**For a deployed demo, use `POST /analyze`** and put the same numbers in the JSON body: `times` is
the `time_hours` column and `failed` is the `failed` column, in the same row order. On the live
server you can also open `/docs`, choose `POST /analyze`, click **Try it out**, and paste the JSON.

The examples below call the local server. After deploy, replace `http://127.0.0.1:8000` with the
Connect URL.

`wearout_baseline.csv` → `c_hat` ≈ 205.670, `maintain now`:

```bash
curl -X POST "http://127.0.0.1:8000/analyze" \
  -H "Content-Type: application/json" \
  -d '{"times":[100,120,150,200,200],"failed":[1,1,1,0,0],"plan_hours":100}'
```

`early_wearout.csv` → `maintain now`:

```bash
curl -X POST "http://127.0.0.1:8000/analyze" \
  -H "Content-Type: application/json" \
  -d '{"times":[40,45,50,55,60,60],"failed":[1,1,1,1,0,0],"plan_hours":100}'
```

`edge_all_censored.csv` → HTTP 400 (need at least one failure):

```bash
curl -X POST "http://127.0.0.1:8000/analyze" \
  -H "Content-Type: application/json" \
  -d '{"times":[80,90,100],"failed":[0,0,0],"plan_hours":100}'
```

The full walkthrough, with every number and a "how to read this" line, is in
[`demo/README.md`](../demo/README.md) (section 5 for the deployed server).

### Input validation

Both endpoints reject bad input with **HTTP 400** and a message naming the problem, instead of
returning a number:

- `time_hours` missing, not a number, NaN/inf, or not positive;
- `failed` missing or anything other than `0` or `1`;
- `times` and `failed` empty or of different lengths;
- no failures at all (`r = 0`), so the scale cannot be estimated.

For `/analyze/file`, a bad cell is reported with its line number in the file, counting the header
as line 1 (a blank `time_hours` in the second data row gives `row 3: time_hours is missing`).

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
