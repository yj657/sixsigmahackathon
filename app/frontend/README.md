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

## Live on Posit Connect

https://connect.systems-apps.com/content/a7bfcdd7-6564-45cb-b74e-09128cde8a93  

(Points at the live API. If you see Unauthorized, set Access → Anyone on this
content item, same as the API.)

CI: `.github/workflows/deploy-react-static.yml` rebuilds and redeploys on push
to `kskbl` / `main` when `app/frontend/**` changes.

## Build (static)

```bash
VITE_API_URL=https://connect.systems-apps.com/content/61dce257-81d0-44e8-84c4-c10cfeae1bbe \
  npm run build -- --base=./
# output: dist/
```

## What it does

- Load demo samples (baseline, plan 50 h, early wearout, all-censored)
- `POST /analyze` → show maintain-now / ok-to-fly, metrics, R(t) curve
- Errors from blank/invalid data surface as alerts (HTTP 400)
