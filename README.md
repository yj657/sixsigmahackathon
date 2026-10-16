# kskbl — Drone Delivery Fleet Reliability

Weibull (shape *m* = 2) life analysis with right-censored flight hours, for a
fleet maintenance technician deciding **maintain now** vs **ok to fly** before
the next mission.

| | |
|---|---|
| **Team** | kskbl |
| **Prompt** | 4 · Industrial Systems — Drone Delivery Fleet Maintenance |
| **Track** | On-campus (24 hours) |
| **Repo** | https://github.com/yj657/sixsigmahackathon |
| **Live UI** | https://connect.systems-apps.com/content/a7bfcdd7-6564-45cb-b74e-09128cde8a93 |
| **Live API** | https://connect.systems-apps.com/content/61dce257-81d0-44e8-84c4-c10cfeae1bbe |
| **API docs** | https://connect.systems-apps.com/content/61dce257-81d0-44e8-84c4-c10cfeae1bbe/docs |

If the live URL shows **Unauthorized**, the Connect content Access setting still
needs to be **Anyone** (Settings → Access on the content item).

---

## Who it is for

A **fleet maintenance technician** at a drone delivery startup. After logging
flight hours and failures (including drones still flying), they decide whether
to schedule preventive maintenance before the next mission instead of waiting
for a mid-air failure.

## What it computes

Statistics live in one plain module: [`app/qc.py`](app/qc.py) (no FastAPI inside).

| Output | Meaning |
|---|---|
| `c_hat` | Weibull characteristic life (hours), MLE with right censoring, *m* = 2 fixed |
| `mttf` | Mean time to failure |
| `R_plan` | Reliability at `plan_hours` |
| `z_plan` | Hazard at `plan_hours` |
| `B10` | Time when 10% have failed |
| `call` | `maintain now` if B10 ≤ plan_hours or R(plan) < 0.90; else `ok to fly` |

**Inputs (CSV columns):** `drone_id`, `time_hours`, `failed` (1 = failed, 0 = still
flying / censored). Optional `plan_hours` (default 100).

Known-answer and every test dataset: [`demo/README.md`](demo/README.md) ·
codebook: [`data/README.md`](data/README.md) · design: [`SPEC.md`](SPEC.md).

---

## Technician UI (React)

```bash
cd app/frontend
npm install
npm run dev
```

Defaults to the live Connect API. For a local API: `VITE_API_URL=http://127.0.0.1:8000 npm run dev`.
Details: [`app/frontend/README.md`](app/frontend/README.md).

## Run locally (API)

From the repo root:

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r app/requirements.txt
pytest tests                       # expect 17 passed
./app/testme.sh                    # http://127.0.0.1:8000/docs
```

If `testme.sh` picks a system `python3.11` without packages, use:

```bash
.venv/bin/python -m uvicorn app:app --app-dir app --host 0.0.0.0 --port 8000
```

Quick check (expect `c_hat` ≈ 205.670, `maintain now`):

```bash
curl "http://127.0.0.1:8000/analyze/file?name=wearout_baseline.csv"
```

Full walkthrough of all three CSVs: **[`demo/README.md`](demo/README.md)**.

---

## HTTP API

| Method | Path | Notes |
|---|---|---|
| GET | `/` | API info |
| GET | `/docs` | OpenAPI UI |
| POST | `/analyze` | JSON: `times`, `failed`, optional `plan_hours` — **use this on Connect** |
| GET | `/analyze/file?name=…` | Reads repo `data/` — **local only** |

Live example:

```bash
LIVE_URL="https://connect.systems-apps.com/content/61dce257-81d0-44e8-84c4-c10cfeae1bbe"
curl -X POST "$LIVE_URL/analyze" \
  -H "Content-Type: application/json" \
  -d '{"times":[100,120,150,200,200],"failed":[1,1,1,0,0],"plan_hours":100}'
```

More detail: [`app/README.md`](app/README.md).

---

## Project layout

```text
app/qc.py          statistics
app/app.py         FastAPI (thin)
tests/             known-answer + validation
data/              3 CSVs + codebook
demo/README.md     judge walkthrough
docs/              event docs, plan, team-split
```

Event pages (schedule, criteria, …) stay under [`docs/`](docs/).

---

## Out of scope (v1)

No login/DB, no free-*m* MLE, no I-MR charts, no live drone telemetry.
