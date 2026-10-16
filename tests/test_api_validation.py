"""CSV/API parsing helpers: blank cells → clear ValueError (HTTP 400 in app.py)."""

from pathlib import Path

import pytest

from app.qc import load_lifetime_csv


def test_load_lifetime_csv_blank_time_raises(tmp_path: Path):
    bad = tmp_path / "blank_time.csv"
    bad.write_text("drone_id,time_hours,failed\nX01,,1\n", encoding="utf-8")
    with pytest.raises(ValueError, match="row 2|missing"):
        load_lifetime_csv(bad)


def test_load_lifetime_csv_bad_failed_raises(tmp_path: Path):
    bad = tmp_path / "bad_failed.csv"
    bad.write_text("drone_id,time_hours,failed\nX01,100,2\n", encoding="utf-8")
    with pytest.raises(ValueError, match="0 or 1"):
        load_lifetime_csv(bad)


def test_load_lifetime_csv_reads_baseline():
    root = Path(__file__).resolve().parents[1]
    times, failed = load_lifetime_csv(root / "data" / "wearout_baseline.csv")
    assert len(times) == 5
    assert failed == [1, 1, 1, 0, 0]
