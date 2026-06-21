"""Natural-language date-range parsing for time-scoped business questions.

parse_date_range("this month") -> ("2026-06-01", "2026-06-30")   (relative to today)
parse_date_range("no dates here") -> (None, None)

Deterministic and testable via the `today` argument. Returns inclusive ISO
(YYYY-MM-DD) start/end strings, or (None, None) when no date phrase is found.
"""

import re
import calendar
from datetime import date, timedelta

_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}

_ISO_RANGE = re.compile(
    r"(\d{4}-\d{2}-\d{2})\s*(?:and|to|until|through|-)\s*(\d{4}-\d{2}-\d{2})"
)
_MONTH_RANGE = re.compile(r"from\s+([a-z]+)\s+to\s+([a-z]+)")


def _iso(d: date) -> str:
    return d.isoformat()


def _month_end(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def _month_span(year: int, month: int) -> tuple[str, str]:
    return _iso(date(year, month, 1)), _iso(date(year, month, _month_end(year, month)))


def parse_date_range(text: str, today: date | None = None) -> tuple[str | None, str | None]:
    if not text:
        return (None, None)
    today = today or date.today()
    t = text.lower()

    # Explicit ISO range: "between X and Y" / "from X to Y".
    m = _ISO_RANGE.search(t)
    if m:
        return (m.group(1), m.group(2))

    # "from <month> to <month>" (assume current year).
    m = _MONTH_RANGE.search(t)
    if m and m.group(1) in _MONTHS and m.group(2) in _MONTHS:
        y = today.year
        start, _ = _month_span(y, _MONTHS[m.group(1)])
        _, end = _month_span(y, _MONTHS[m.group(2)])
        return (start, end)

    if "today" in t:
        return (_iso(today), _iso(today))
    if "yesterday" in t:
        d = today - timedelta(days=1)
        return (_iso(d), _iso(d))

    if "this week" in t:
        start = today - timedelta(days=today.weekday())
        return (_iso(start), _iso(start + timedelta(days=6)))
    if "last week" in t:
        start = today - timedelta(days=today.weekday() + 7)
        return (_iso(start), _iso(start + timedelta(days=6)))

    if "this month" in t:
        return _month_span(today.year, today.month)
    if "last month" in t:
        y, mth = (today.year, today.month - 1) if today.month > 1 else (today.year - 1, 12)
        return _month_span(y, mth)

    if "this quarter" in t:
        sm = ((today.month - 1) // 3) * 3 + 1
        start, _ = _month_span(today.year, sm)
        _, end = _month_span(today.year, sm + 2)
        return (start, end)
    if "last quarter" in t:
        sm = ((today.month - 1) // 3) * 3 + 1 - 3
        y = today.year
        if sm <= 0:
            sm += 12
            y -= 1
        start, _ = _month_span(y, sm)
        _, end = _month_span(y, sm + 2)
        return (start, end)

    if "this year" in t:
        return (_iso(date(today.year, 1, 1)), _iso(date(today.year, 12, 31)))
    if "last year" in t:
        return (_iso(date(today.year - 1, 1, 1)), _iso(date(today.year - 1, 12, 31)))

    # Single month name, e.g. "sales in March".
    for name, mth in _MONTHS.items():
        if re.search(r"\b" + name + r"\b", t):
            return _month_span(today.year, mth)

    return (None, None)


def filter_by_date(items: list[dict], period: str | None, date_key: str,
                   today: date | None = None) -> list[dict]:
    """Filter records whose `date_key` (ISO date) falls in the parsed period.

    period=None or an unrecognized phrase -> items returned unchanged.
    """
    if not period:
        return items
    start, end = parse_date_range(period, today)
    if not (start and end):
        return items
    return [it for it in items if it.get(date_key) and start <= it[date_key][:10] <= end]
