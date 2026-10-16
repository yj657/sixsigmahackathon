"""
FastAPI layer for kskbl drone fleet Weibull reliability.
Statistics live in qc.py — this file only parses input and returns JSON.
"""

from __future__ import annotations

from pathlib import Path
from typing import List

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from qc import analyze_fleet, load_lifetime_csv

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT / "data"

app = FastAPI(
    title="kskbl Drone Fleet Reliability API",
    description=(
        "Weibull (shape m=2) life model with right-censored flight hours. "
        "Returns MTTF, R(t), hazard, B10, and maintain-now / ok-to-fly."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    times: List[float] = Field(..., description="Flight hours per airframe")
    failed: List[int] = Field(
        ..., description="1 = failed, 0 = still operating (right-censored)"
    )
    plan_hours: float = Field(100.0, description="Next-mission planning horizon")
    m: float = Field(2.0, description="Weibull shape (v1 fixed at 2 = wear-out)")


@app.get("/")
async def root():
    return {
        "message": "kskbl drone fleet reliability API",
        "docs": "/docs",
        "analyze": "POST /analyze",
        "from_csv": "GET /analyze/file?name=wearout_baseline.csv",
    }


@app.post("/analyze")
async def analyze(body: AnalyzeRequest):
    try:
        return analyze_fleet(
            body.times, body.failed, plan_hours=body.plan_hours, m=body.m
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/analyze/file")
async def analyze_file(
    name: str = Query("wearout_baseline.csv", description="CSV under data/"),
    plan_hours: float = Query(100.0),
    m: float = Query(2.0),
):
    """Run analyze_fleet on a named file in the repo data/ folder."""
    # Prevent path traversal — only a bare filename inside data/
    safe = Path(name).name
    path = DATA_DIR / safe
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"data file not found: {safe}")

    try:
        times, failed = load_lifetime_csv(path)
        result = analyze_fleet(times, failed, plan_hours=plan_hours, m=m)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    result["source"] = safe
    return result


@app.get("/__docs__/")
async def docs_redirect():
    return RedirectResponse(url="/docs")
