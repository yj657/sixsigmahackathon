"""
FastAPI layer for kskbl drone fleet Weibull reliability + I-MR.
Statistics live in qc.py — this file only parses input and returns JSON.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field

from qc import (
    CALC_ERROR_MESSAGE,
    CalculationError,
    analyze_fleet,
    imr_chart,
    load_imr_csv,
    load_lifetime_csv,
)

log = logging.getLogger("kskbl.api")

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT / "data"

app = FastAPI(
    title="kskbl Drone Fleet Reliability API",
    description=(
        "Weibull life model with right-censored flight hours (m=2 primary or free-m MLE), "
        "plus I-MR on mission-hour series.\n\n"
        "**Lifetime metrics** (c_hat, mttf, B10) describe a new drone. **Next-interval "
        "metrics** describe a drone already at `current_age` hours that will fly `plan_hours` "
        "more: `R_future` = R(current_age + plan_hours) / R(current_age), the hazard `z_plan` "
        "at the end of that interval, and the decision. **One rule:** `R_future` >= 90% gives "
        "`call` = \"ok to fly\"; below 90% gives \"maintain now\". `decision_message` is the "
        "sentence to show users. `R_plan` is an alias of `R_future` kept for older clients.\n\n"
        "**Errors:** 400 = invalid input (message names the problem); 422 = valid input that "
        "cannot be calculated (\"" + CALC_ERROR_MESSAGE + "\"); 404 = unknown data file."
    ),
    version="1.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Fields are typed Any on purpose: Pydantic would silently turn JSON true/false into 1/0
# and strings into numbers. qc.py validates every value strictly instead (HTTP 400).
class AnalyzeRequest(BaseModel):
    times: Any = Field(
        ...,
        description="Flight hours per airframe: finite numbers > 0",
        json_schema_extra={"example": [100, 120, 150, 200, 200]},
    )
    failed: Any = Field(
        ...,
        description="Same length as times: the number 1 = failed, 0 = still operating "
        "(right-censored). JSON true/false are rejected.",
        json_schema_extra={"example": [1, 1, 1, 0, 0]},
    )
    plan_hours: Any = Field(
        100.0, description="Additional flight hours planned before the next service (> 0)"
    )
    current_age: Any = Field(
        0.0,
        description="Hours the drone has already flown (>= 0). 0 = a new drone; then "
        "R_future equals the lifetime reliability R(plan_hours).",
    )
    m: Any = Field(2.0, description="Weibull shape when estimate_m is false (> 0)")
    estimate_m: Any = Field(
        False, description="true = estimate shape and scale from the data (needs r >= 2)"
    )


class ImrRequest(BaseModel):
    values: Any = Field(
        ...,
        description="Ordered univariate series (e.g. consecutive mission hours)",
        json_schema_extra={"example": [10, 12, 11, 13, 12, 11, 25, 26, 24]},
    )


@app.exception_handler(CalculationError)
async def calculation_error_handler(request: Request, exc: CalculationError):
    return JSONResponse(status_code=422, content={"detail": exc.detail})


@app.exception_handler(ArithmeticError)
async def arithmetic_error_handler(request: Request, exc: ArithmeticError):
    # Overflow / division problems that slipped past qc.py: still a clean message.
    log.warning("arithmetic error on %s: %r", request.url.path, exc)
    return JSONResponse(status_code=422, content={"detail": CALC_ERROR_MESSAGE})


@app.exception_handler(RequestValidationError)
async def request_validation_handler(request: Request, exc: RequestValidationError):
    problems = []
    for err in exc.errors():
        where = ".".join(str(p) for p in err.get("loc", ()) if p != "body")
        problems.append(f"{where}: {err.get('msg')}" if where else str(err.get("msg")))
    detail = "Invalid request: " + "; ".join(problems) if problems else "Invalid request."
    return JSONResponse(status_code=400, content={"detail": detail})


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception):
    # Never send a stack trace to the user; keep it in the server log.
    log.exception("unexpected error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong on the server. Please try again."},
    )


@app.get("/")
async def root():
    return {
        "message": "kskbl drone fleet reliability API",
        "docs": "/docs",
        "analyze": "POST /analyze",
        "from_csv": "GET /analyze/file?name=wearout_baseline.csv",
        "imr": "POST /imr",
        "imr_file": "GET /imr/file?name=imr_mission_hours.csv",
    }


@app.post("/analyze")
async def analyze(body: AnalyzeRequest):
    try:
        return analyze_fleet(
            body.times,
            body.failed,
            plan_hours=body.plan_hours,
            m=body.m,
            estimate_m=body.estimate_m,
            current_age=body.current_age,
            strict=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/analyze/file")
async def analyze_file(
    name: str = Query("wearout_baseline.csv", description="CSV under data/"),
    plan_hours: float = Query(100.0, description="Additional hours before next service"),
    current_age: float = Query(0.0, description="Hours already flown (>= 0)"),
    m: float = Query(2.0),
    estimate_m: bool = Query(False),
):
    """Run analyze_fleet on a named file in the repo data/ folder."""
    safe = Path(name).name
    path = DATA_DIR / safe
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"data file not found: {safe}")

    try:
        times, failed = load_lifetime_csv(path)
        result = analyze_fleet(
            times,
            failed,
            plan_hours=plan_hours,
            m=m,
            estimate_m=estimate_m,
            current_age=current_age,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    result["source"] = safe
    return result


@app.post("/imr")
async def imr(body: ImrRequest):
    try:
        return imr_chart(body.values)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/imr/file")
async def imr_file(
    name: str = Query("imr_mission_hours.csv", description="CSV under data/"),
    value_col: str = Query("hours"),
):
    safe = Path(name).name
    path = DATA_DIR / safe
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"data file not found: {safe}")
    try:
        values = load_imr_csv(path, value_col=value_col)
        result = imr_chart(values)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    result["source"] = safe
    return result


@app.get("/__docs__/")
async def docs_redirect():
    return RedirectResponse(url="/docs")
