# PRODUCT — kskbl drone fleet reliability UI

**Assumptions (user asked to build UI with tools ready; no interview):**
- Mode: **Operate** — technician completes a maintain / fly decision.
- User: fleet maintenance technician.
- Job: paste or load flight-hour samples → see Weibull fit + maintain-now call.
- Stack: Vite React in `app/frontend/`, talking to FastAPI `POST /analyze`.
- Live API default: Posit Connect content URL already deployed.
- Visual world: night hangar / instrument panel — deep slate, amber signal lights,
  tabular numerals; not purple SaaS, not cream editorial.
