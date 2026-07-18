"""AG1 evaluation runner — Layer B (model-assisted, opt-in).

Loads tests/evals/agent_cases.json and, for each routing-eval case, calls the
real, unmodified `route_query()` and records which tool it chose and which
parameters it extracted. This measures CURRENT routing behavior; it never
changes it.

Safety model (read before modifying):
    - Business logic is never actually executed. Every registered tool's
      `function` and `formatter` are temporarily replaced with inert probes
      (see `probe_registry()`) for the duration of a run, then restored —
      whether the run succeeds or raises. The patch lives only in the
      in-process `TOOL_REGISTRY` dict; nothing is written to disk, and
      production code (`route_query`, `run_agent`, `execute_tool`) is never
      modified, only the dict values it looks up at call time.
    - DATA_BACKEND stays whatever the environment has configured (this repo
      defaults to "mock"); probe substitution means live Odoo is never
      reachable through this runner even if DATA_BACKEND=odoo, because the
      registered tool functions never run at all.
    - No secrets, tokens, or full business results are ever logged — only
      tool names, parameter dicts (already free of secrets by construction:
      they are OpenAI-extracted arguments like customer_name/period/limit),
      latency, and pass/fail booleans.

Run directly: `python -m tests.evals.evaluation_runner --help`
Or via the wrapper: `python scripts/run_agent_evaluation.py --help`
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.agent.router import route_query  # noqa: E402
from src.agent.tool_registry import TOOL_REGISTRY  # noqa: E402
from src.services.openai_service import is_available, _model  # noqa: E402

DATASET_PATH = Path(__file__).parent / "agent_cases.json"

# Non-routing categories this runner deliberately does not execute — their
# currentStatus in the dataset is authored evidence (a direct code/behavior
# check, or a cross-reference to already-passing tests), not a live measurement.
_NON_ROUTING_DATA_MODES = {"live_odoo", "api_contract"}

_ALLOWED_STATUSES = {"NOT_RUN", "PASS", "FAIL", "EXPECTED_FAIL", "BLOCKED"}


def _probe_function(**kwargs: Any) -> dict:
    return {"_probe": True}


def _probe_formatter(_raw: dict) -> str:
    return "[[PROBE OUTPUT — evaluation_runner.py, not real business logic]]"


@contextmanager
def probe_registry():
    """Temporarily replace every TOOL_REGISTRY entry's function/formatter.

    Guarantees the original registry is restored even if the wrapped code
    raises. `route_query()`'s returned {tool, parameters} already tells us
    everything Layer B needs (the model's chosen tool name and the arguments
    it extracted, taken directly from the OpenAI tool_call before any
    execution happens) — the probe's own return value is never inspected.
    """
    original = {name: dict(entry) for name, entry in TOOL_REGISTRY.items()}
    try:
        for name in TOOL_REGISTRY:
            TOOL_REGISTRY[name] = {"function": _probe_function, "formatter": _probe_formatter}
        yield
    finally:
        TOOL_REGISTRY.clear()
        TOOL_REGISTRY.update(original)


# ── Assertion vocabulary ─────────────────────────────────────────────────────
# Documented in docs/AI_AGENT_EVALUATION_BASELINE.md. Each assertion type
# receives (actual_value_or_sentinel, spec_dict, key, parameters_dict) and
# returns (passed: bool, detail: str).
_MISSING = object()


def _assert_exact(actual, spec, key, params):
    expected = spec["value"]
    return actual == expected, f"{key}: expected exact {expected!r}, got {actual!r}"


def _assert_case_insensitive_equals(actual, spec, key, params):
    expected = spec["value"]
    ok = isinstance(actual, str) and actual.strip().upper() == str(expected).strip().upper()
    return ok, f"{key}: expected (case-insensitive) {expected!r}, got {actual!r}"


def _assert_key_exists(actual, spec, key, params):
    return actual is not _MISSING, f"{key}: expected key to be present, params={params}"


def _assert_key_absent(actual, spec, key, params):
    return actual is _MISSING, f"{key}: expected key to be absent, got {actual!r}"


def _assert_allowed_values(actual, spec, key, params):
    allowed = spec["values"]
    return actual in allowed, f"{key}: expected one of {allowed!r}, got {actual!r}"


def _assert_numeric(actual, spec, key, params):
    ok = isinstance(actual, (int, float)) and not isinstance(actual, bool)
    return ok, f"{key}: expected a number, got {actual!r} ({type(actual).__name__})"


def _assert_non_empty(actual, spec, key, params):
    ok = actual is not _MISSING and bool(actual)
    return ok, f"{key}: expected a non-empty value, got {actual!r}"


_MONTH_NAMES = {
    1: "january", 2: "february", 3: "march", 4: "april", 5: "may", 6: "june",
    7: "july", 8: "august", 9: "september", 10: "october", 11: "november", 12: "december",
}


def _assert_period_resolved(actual, spec, key, params):
    """Cross-key check for the 6 tools whose schema documents 'period' (a free-text
    string) as taking priority over separate month/year integers. A model that picks
    EITHER mechanism has correctly resolved the period — this assertion (unlike a
    single-key type) inspects the whole `params` dict rather than one key, since
    'was the period resolved at all' is a fact about the parameter set, not one field.
    Deliberately does not check the specific value: for relative phrasing ('this
    month'), the only correct value depends on today's real date, and hardcoding it
    here would make the dataset go stale exactly like the bug it is meant to detect."""
    period = params.get("period")
    if isinstance(period, str) and period.strip():
        return True, f"period resolved via period={period!r}"
    def _is_numeric(v):
        return isinstance(v, (int, float)) and not isinstance(v, bool)

    month, year = params.get("month"), params.get("year")
    if _is_numeric(month) and _is_numeric(year):
        return True, f"period resolved via month={month!r}, year={year!r}"
    return False, f"neither a non-empty 'period' string nor numeric month+year found in {params!r}"


def _assert_period_scoped_to(actual, spec, key, params):
    """Like _assert_period_resolved, but also checks the resolved period actually
    names the specific (month, year) given in spec — for cases with an EXPLICIT,
    non-relative period in the query text (e.g. 'March 2026'), where hardcoding the
    expected value is safe because it does not depend on today's date."""
    expected_month, expected_year = spec["month"], spec["year"]
    period = params.get("period")
    if isinstance(period, str) and period.strip():
        import re as _re
        year_ok = str(expected_year) in period
        month_name = _MONTH_NAMES[expected_month]
        month_ok = (
            month_name in period.lower()
            or f"-{expected_month:02d}-" in period
            or f"/{expected_month:02d}/" in period
            # Bare "YYYY-MM" / "YYYY-M" (e.g. "2026-06") — a valid, unambiguous
            # way to reference the month; accepted since the AG3.5 freeze run
            # showed the model legitimately emits it.
            or bool(_re.search(rf"{expected_year}-0?{expected_month}(?!\d)", period))
        )
        ok = year_ok and month_ok
        return ok, f"period={period!r} should reference {month_name} {expected_year}"
    month, year = params.get("month"), params.get("year")
    if month is not None or year is not None:
        return (month, year) == (expected_month, expected_year), (
            f"expected month/year {(expected_month, expected_year)}, got {(month, year)}"
        )
    return False, f"neither 'period' nor 'month'/'year' present in {params!r}"


ASSERTION_HANDLERS = {
    "exact": _assert_exact,
    "case_insensitive_equals": _assert_case_insensitive_equals,
    "key_exists": _assert_key_exists,
    "key_absent": _assert_key_absent,
    "allowed_values": _assert_allowed_values,
    "numeric": _assert_numeric,
    "non_empty": _assert_non_empty,
    "period_resolved": _assert_period_resolved,
    "period_scoped_to": _assert_period_scoped_to,
}


def evaluate_parameter_assertions(parameters: dict, parameter_assertions: dict) -> list[str]:
    """Return a list of human-readable failure messages (empty == all passed)."""
    failures: list[str] = []
    for key, spec in parameter_assertions.items():
        actual = parameters.get(key, _MISSING)
        handler = ASSERTION_HANDLERS.get(spec.get("type"))
        if handler is None:
            failures.append(f"{key}: unknown assertion type {spec.get('type')!r}")
            continue
        passed, detail = handler(actual, spec, key, parameters)
        if not passed:
            failures.append(detail)
    return failures


def load_dataset() -> list[dict]:
    with DATASET_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def select_cases(
    cases: list[dict],
    case_id: str | None = None,
    tool: str | None = None,
    language: str | None = None,
    category: str | None = None,
) -> list[dict]:
    selected = cases
    if case_id:
        selected = [c for c in selected if c["id"] == case_id]
    if tool:
        selected = [c for c in selected if c.get("targetTool") == tool or c["expectedTool"] == tool]
    if language:
        selected = [c for c in selected if c["language"] == language]
    if category:
        selected = [c for c in selected if c["category"] == category]
    # Deterministic ordering regardless of input order/filters.
    return sorted(selected, key=lambda c: c["id"])


def run_case(case: dict) -> dict:
    """Execute one routing-eval case under probe substitution.

    Returns a result dict — never raises; a routing exception is captured as
    a FAIL with a safe (message-only, no stack trace, no secrets) error string.
    """
    if case.get("dataMode") in _NON_ROUTING_DATA_MODES:
        return {
            "id": case["id"],
            "status": "SKIPPED",
            "reason": f"dataMode={case['dataMode']!r} is not executed by this runner (see case notes).",
            "latency_ms": None,
            "chosenTool": None,
            "capturedParameters": None,
        }

    start = time.monotonic()
    try:
        with probe_registry():
            result = route_query(case["query"], case.get("history") or [])
        latency_ms = round((time.monotonic() - start) * 1000, 1)
    except Exception as exc:  # noqa: BLE001 — deliberately broad: this is eval, not production
        latency_ms = round((time.monotonic() - start) * 1000, 1)
        return {
            "id": case["id"],
            "status": "FAIL",
            "reason": f"route_query raised {type(exc).__name__}: {exc}",
            "latency_ms": latency_ms,
            "chosenTool": None,
            "capturedParameters": None,
        }

    chosen_tool = result.get("tool")
    parameters = result.get("parameters") or {}

    failures: list[str] = []
    if case["expectedTool"] not in ("n/a",) and chosen_tool != case["expectedTool"]:
        failures.append(f"expectedTool={case['expectedTool']!r}, got {chosen_tool!r}")
    failures.extend(evaluate_parameter_assertions(parameters, case.get("parameterAssertions") or {}))

    status = "PASS" if not failures else "FAIL"
    return {
        "id": case["id"],
        "status": status,
        "reason": "; ".join(failures) if failures else None,
        "latency_ms": latency_ms,
        "chosenTool": chosen_tool,
        "capturedParameters": parameters,
    }


def run_suite(cases: list[dict]) -> list[dict]:
    return [run_case(c) for c in cases]


def summarize(results: list[dict]) -> dict:
    counts: dict[str, int] = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    latencies = [r["latency_ms"] for r in results if r["latency_ms"] is not None]
    return {
        "total": len(results),
        "counts": counts,
        "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else None,
        "model": _model() if is_available() else None,
        "openai_available": is_available(),
    }


def update_dataset_statuses(cases: list[dict], results: list[dict]) -> int:
    """Write real PASS/FAIL back into currentStatus for executed cases only.

    Cases this runner skips (live_odoo/api_contract dataMode) are left
    exactly as authored — their currentStatus is evidence from elsewhere,
    not something this function should overwrite with a guess.
    """
    by_id = {r["id"]: r for r in results}
    updated = 0
    for case in cases:
        r = by_id.get(case["id"])
        if r is None or r["status"] == "SKIPPED":
            continue
        new_status = r["status"] if r["status"] in _ALLOWED_STATUSES else "FAIL"
        if case["currentStatus"] != new_status:
            case["currentStatus"] = new_status
            updated += 1
    return updated


def main() -> int:
    parser = argparse.ArgumentParser(description="AG1 model-assisted routing evaluation (Layer B).")
    parser.add_argument("--case", help="Run only this case id.")
    parser.add_argument("--tool", help="Run only cases targeting this tool.")
    parser.add_argument("--language", help="Run only cases in this language (en/ar/n-a).")
    parser.add_argument("--category", help="Run only cases in this category.")
    parser.add_argument("--output", help="Write full JSON results to this path.")
    parser.add_argument("--fail-on-mismatch", action="store_true",
                         help="Exit non-zero if any executed case is not PASS.")
    parser.add_argument("--update-dataset", action="store_true",
                         help="Write real PASS/FAIL back into agent_cases.json's currentStatus field.")
    args = parser.parse_args()

    if not is_available():
        print("BLOCKED: OPENAI_API_KEY is not set. No live routing calls were made; "
              "no results were fabricated. Set OPENAI_API_KEY and re-run to produce a real baseline.")
        return 1

    cases = load_dataset()
    selected = select_cases(cases, args.case, args.tool, args.language, args.category)
    if not selected:
        print("No cases matched the given filters.")
        return 1

    print(f"Model: {_model()} | Cases selected: {len(selected)}")
    results = run_suite(selected)

    for r in results:
        line = f"[{r['status']:<7}] {r['id']:<22} tool={r['chosenTool']!r:35} {r['latency_ms']}ms"
        if r["reason"]:
            line += f"  -- {r['reason']}"
        print(line)

    summary = summarize(results)
    print("\nSummary:", json.dumps(summary, indent=2))

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("w", encoding="utf-8") as f:
            json.dump({"summary": summary, "results": results}, f, indent=2)
        print(f"Full results written to {out_path}")

    if args.update_dataset:
        updated = update_dataset_statuses(cases, results)
        with DATASET_PATH.open("w", encoding="utf-8") as f:
            json.dump(cases, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"Updated currentStatus for {updated} case(s) in {DATASET_PATH}")

    if args.fail_on_mismatch and summary["counts"].get("FAIL", 0) > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
