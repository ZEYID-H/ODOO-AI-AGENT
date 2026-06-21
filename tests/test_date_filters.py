"""Date-range parser tests. Fixed today = 2026-06-20 for determinism.

    python tests/test_date_filters.py
"""

import sys
from pathlib import Path
from datetime import date

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.utils.date_filters import parse_date_range, filter_by_date

TODAY = date(2026, 6, 20)

CASES = {
    "today": ("2026-06-20", "2026-06-20"),
    "yesterday": ("2026-06-19", "2026-06-19"),
    "sales this week": ("2026-06-15", "2026-06-21"),       # Mon-Sun containing the 20th
    "last week": ("2026-06-08", "2026-06-14"),
    "sales this month": ("2026-06-01", "2026-06-30"),
    "last month": ("2026-05-01", "2026-05-31"),
    "this quarter": ("2026-04-01", "2026-06-30"),
    "last quarter": ("2026-01-01", "2026-03-31"),
    "this year": ("2026-01-01", "2026-12-31"),
    "last year": ("2025-01-01", "2025-12-31"),
    "between 2026-01-01 and 2026-03-31": ("2026-01-01", "2026-03-31"),
    "from 2026-02-01 to 2026-02-15": ("2026-02-01", "2026-02-15"),
    "from January to March": ("2026-01-01", "2026-03-31"),
    "sales in March": ("2026-03-01", "2026-03-31"),
    "show top selling products": (None, None),
    "who owes us the most money": (None, None),
}


def test_parse_phrases():
    for text, expected in CASES.items():
        got = parse_date_range(text, today=TODAY)
        assert got == expected, f"{text!r}: expected {expected}, got {got}"


def test_filter_by_date_passthrough_when_no_period():
    items = [{"date": "2026-06-10"}, {"date": "2026-01-05"}]
    assert filter_by_date(items, None, "date", today=TODAY) is items


def test_filter_by_date_applies_range():
    items = [{"d": "2026-06-10"}, {"d": "2026-01-05"}, {"d": "2026-06-30"}]
    got = filter_by_date(items, "this month", "d", today=TODAY)
    assert [x["d"] for x in got] == ["2026-06-10", "2026-06-30"]


def _run_all():
    tests = [test_parse_phrases, test_filter_by_date_passthrough_when_no_period,
             test_filter_by_date_applies_range]
    failures = 0
    print("=" * 60)
    print("DATE FILTER PARSER — today fixed at 2026-06-20")
    print("=" * 60)
    for t in tests:
        try:
            t()
            print(f"PASS  {t.__name__}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL  {t.__name__}: {e}")
    print("=" * 60)
    if failures:
        print(f"{failures} test(s) FAILED.")
        return 1
    print("All date-filter tests passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(_run_all())
