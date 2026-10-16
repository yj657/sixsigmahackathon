# kskbl frontend — Fleet reliability desk

Vite + React UI for the Weibull FastAPI. Default API URL is the live Connect
content; override with `VITE_API_URL` for local.

## Run

```bash
cd app/frontend
npm install
npm run dev
```

Open the printed localhost URL (usually http://127.0.0.1:5173).

Local API instead of Connect:

```bash
VITE_API_URL=http://127.0.0.1:8000 npm run dev
```

## Build (static, for Posit Connect later)

```bash
npm run build
# output: dist/  (base './' so it works under /content/<guid>/)
```

## What it does

- Load demo samples (baseline, plan 50 h, early wearout, all-censored)
- `POST /analyze` → show maintain-now / ok-to-fly, metrics, R(t) curve
- Errors from blank/invalid data surface as alerts (HTTP 400)
