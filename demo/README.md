# Demo — drone fleet reliability on every test dataset

This walks through the tool on each CSV in [`data/`](../data/README.md), with the exact command to
run, the numbers the API returns, and one line on how to read them. A teammate who did not write
this page should get the same numbers.

**The user:** a fleet maintenance technician at a drone delivery startup.
**The question:** given the flight hours logged so far (failed drones *and* drones still flying),
should the fleet be serviced before the next `plan_hours` of flying?

**The method** ([SPEC §4](../SPEC.md)): a Weibull life model with the shape fixed at *m* = 2
(wear-out). The scale *ĉ* is estimated from all drones, and the ones still flying count as
right-censored. The statistics live in [`app/qc.py`](../app/qc.py); the API only calls it.

---

## 1. Set up and start the tool (local)

Run these once from the repo root. This Mac has `python3` but no `python` or `python3.11`, so use a
virtual environment. `.venv/` stays on your machine; do not commit it.

```bash
python3 -m venv .venv
```

```bash
source .venv/bin/activate
```

```bash
pip install -r app/requirements.txt
```

Check the statistics and the input validation first (expect `17 passed`):

```bash
pytest tests
```

Start the API (with the venv active), then leave this terminal running:

```bash
./app/testme.sh
```

Open http://127.0.0.1:8000/docs for the interactive page. Run the commands below in a second
terminal.

---

## 2. Datasets at a glance

All numbers use the defaults *m* = 2 and `plan_hours` = 100, unless a row says otherwise. Values are
rounded; the API prints more digits.

| Dataset | n | r (failed) | ĉ (h) | MTTF (h) | B10 (h) | R(plan) | Call |
|---|---|---|---|---|---|---|---|
| `wearout_baseline.csv` | 5 | 3 | 205.670 | 182.270 | 66.759 | 0.789 | maintain now |
| `wearout_baseline.csv`, `plan_hours=50` | 5 | 3 | 205.670 | 182.270 | 66.759 | 0.943 | **ok to fly** |
| `early_wearout.csv` | 6 | 4 | 63.934 | 56.660 | 20.752 | 0.087 | maintain now |
| `edge_all_censored.csv` | 3 | 0 | — | — | — | — | HTTP 400 error |

**The decision rule** (in `qc.py`): **maintain now** if B10 ≤ `plan_hours` or R(`plan_hours`) < 0.90;
otherwise **ok to fly**.

---

## 3. Walkthrough

### 3.1 `wearout_baseline.csv` — the normal case

Five drones: three failed (100, 120 and 150 h), two still flying at 200 h (censored).

```bash
curl "http://127.0.0.1:8000/analyze/file?name=wearout_baseline.csv"
```

Returns (rounded):

```text
c_hat 205.670   mttf 182.270   B10 66.759   R_plan 0.789   z_plan 0.00473
plan_hours 100   call "maintain now"   n 5   r 3
```

**How to read this:** 10% of drones are expected to fail by about 67 flight hours, so planning
100 h before service is too long: service first.

Hand check: ĉ² = (100² + 120² + 150² + 200² + 200²) / 3 = 126900 / 3 = 42300, so ĉ = 205.670 h.
This is SPEC §4 known-answer B.

### 3.2 Same data, a shorter plan — `plan_hours=50`

```bash
curl "http://127.0.0.1:8000/analyze/file?name=wearout_baseline.csv&plan_hours=50"
```

Returns (rounded): `R_plan 0.943`, `z_plan 0.00236`, `B10 66.759`, `call "ok to fly"`.

**How to read this:** 50 h is inside the B10 life, and 94% of drones are expected to get there
without failing, so the fleet can fly 50 more hours before service.

### 3.3 `early_wearout.csv` — parts wearing out fast

Six drones: four failed between 40 and 55 h, two still flying at 60 h.

```bash
curl "http://127.0.0.1:8000/analyze/file?name=early_wearout.csv"
```

Returns (rounded):

```text
c_hat 63.934   mttf 56.660   B10 20.752   R_plan 0.0866   z_plan 0.0489
plan_hours 100   call "maintain now"   n 6   r 4
```

**How to read this:** only about 9% of drones would survive to 100 h, and 10% are expected to fail
by about 21 h, so this fleet needs service far sooner.

### 3.4 `edge_all_censored.csv` — no failures yet

Three drones, all still flying (80, 90 and 100 h), none failed.

```bash
curl -i "http://127.0.0.1:8000/analyze/file?name=edge_all_censored.csv"
```

Returns `HTTP 400` with:

```text
{"detail":"need at least one failure to estimate scale (r=0: all observations censored)"}
```

**How to read this:** with no failures there is no evidence about when drones fail, so the tool
refuses instead of inventing a number. Keep logging until the first failure.

### 3.5 Why the still-flying drones matter

Send only the three failures from `wearout_baseline.csv` and leave out the two drones still flying:

```bash
curl -X POST "http://127.0.0.1:8000/analyze" -H "Content-Type: application/json" -d '{"times":[100,120,150],"failed":[1,1,1]}'
```

Returns (rounded): `c_hat 125.033`, `B10 40.585`, `mttf 110.808`.

**How to read this:** dropping the survivors cuts the estimated life from 205.670 h to 125.033 h.
Counting survivors as censored is what keeps the tool from making the fleet look worse than it is.

---

## 4. What each output means

| Field | Units | Meaning |
|---|---|---|
| `m` | — | Weibull shape, fixed at 2 (assumed wear-out: failures get likelier as hours grow) |
| `c_hat` | hours | characteristic life: by this age about 63.2% of drones have failed |
| `mttf` | hours | mean time to failure, `c_hat × Γ(1 + 1/m)` |
| `B10` | hours | age by which 10% of drones are expected to fail |
| `R_plan` | probability | chance a drone survives to `plan_hours` flight hours, counted from 0 h |
| `z_plan` | failures per hour | hazard rate at `plan_hours` |
| `call` | text | `maintain now` or `ok to fly` (rule in section 2) |
| `n`, `r` | count | drones in the data, and how many failed |
| `source` | text | the CSV used (file endpoint only) |

---

## 5. On the live server

**Live URL:** https://connect.systems-apps.com/content/61dce257-81d0-44e8-84c4-c10cfeae1bbe  
**Docs:** https://connect.systems-apps.com/content/61dce257-81d0-44e8-84c4-c10cfeae1bbe/docs  

The live API is open to anyone; no login or API key is needed. `POST /analyze` returns the same
numbers as the local API (checked without a key on 2026-10-16).

Only `app/` is deployed, so the `data/` files are not on the server and `/analyze/file` works only
locally. On the live server, send the same numbers with `POST /analyze`. Set the address once:

```bash
LIVE_URL="https://connect.systems-apps.com/content/61dce257-81d0-44e8-84c4-c10cfeae1bbe"
```

`wearout_baseline.csv` (expect `c_hat` ≈ 205.670, `maintain now`):

```bash
curl -X POST "$LIVE_URL/analyze" -H "Content-Type: application/json" -d '{"times":[100,120,150,200,200],"failed":[1,1,1,0,0]}'
```

`wearout_baseline.csv` with a 50 h plan (expect `ok to fly`):

```bash
curl -X POST "$LIVE_URL/analyze" -H "Content-Type: application/json" -d '{"times":[100,120,150,200,200],"failed":[1,1,1,0,0],"plan_hours":50}'
```

`early_wearout.csv` (expect `c_hat` ≈ 63.934, `maintain now`):

```bash
curl -X POST "$LIVE_URL/analyze" -H "Content-Type: application/json" -d '{"times":[40,45,50,55,60,60],"failed":[1,1,1,1,0,0]}'
```

`edge_all_censored.csv` (expect HTTP 400):

```bash
curl -i -X POST "$LIVE_URL/analyze" -H "Content-Type: application/json" -d '{"times":[80,90,100],"failed":[0,0,0]}'
```

Judges can also open `$LIVE_URL/docs`, choose `POST /analyze`, click **Try it out**, and paste the
same JSON.

---

## 6. Limits to say out loud

- The shape *m* = 2 is assumed, not estimated from the data.
- `R_plan` is measured from 0 h, not from a drone's current age.
- The datasets are small and invented (see the [codebook](../data/README.md)); with 3–4 failures the
  estimates are rough.
- Bad input is refused, not guessed at: a blank or `NaN` time, a time ≤ 0, or a `failed` other
  than 0/1 returns HTTP 400 (HTTP 422 for a JSON `null` or `0.5`). Duplicate `drone_id`s are not
  checked; see the [codebook's rules for valid data](../data/README.md#rules-for-valid-data).

## 7. Check it yourself

- [ ] `pytest tests` prints `17 passed`.
- [ ] Each command in section 3 returns the numbers shown, to 3 decimals.
- [ ] `plan_hours=50` flips the baseline to `ok to fly`.
- [ ] The all-censored file returns HTTP 400, not a number.
- [ ] After H-06: each command in section 5 returns the same numbers from the live URL.
