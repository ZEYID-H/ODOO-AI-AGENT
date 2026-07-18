"""Layer A (deterministic, no network, no OpenAI key required) — direct,
reproducible proof of specific current-behavior facts referenced by the
dataset's `notes`/`expectedErrorBehavior` fields, plus a safety check on the
probe-substitution mechanism itself.

Every test here calls real production functions directly (never mocks them)
and asserts on their real return values. Nothing in src/ is modified.
"""

import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.agent.prompts import NO_CUSTOMER_MSG, UNKNOWN_INTENT_MSG  # noqa: E402
from src.agent.router import (  # noqa: E402
    _detect_intent, _extract_customer, _extract_period, _rule_based_route,
)
from src.agent.tool_registry import TOOL_REGISTRY, execute_tool  # noqa: E402
from src.data import provider  # noqa: E402
from tests.evals.evaluation_runner import probe_registry  # noqa: E402


# ── Probe-substitution safety ────────────────────────────────────────────────

def test_probe_registry_replaces_every_tool_and_fully_restores_originals():
    original_functions = {name: entry["function"] for name, entry in TOOL_REGISTRY.items()}
    original_formatters = {name: entry["formatter"] for name, entry in TOOL_REGISTRY.items()}

    with probe_registry():
        assert len(TOOL_REGISTRY) == 14
        for name, entry in TOOL_REGISTRY.items():
            assert entry["function"] is not original_functions[name], f"{name} function not patched"
            assert entry["formatter"] is not original_formatters[name], f"{name} formatter not patched"
        # execute_tool() under the patch never reaches real business logic.
        raw, formatted = execute_tool("get_customer_balance", {"customer_name": "APPLE MART"})
        assert raw == {"_probe": True}
        assert "PROBE OUTPUT" in formatted

    # Fully restored afterward — same function objects, real business logic reachable again.
    for name, entry in TOOL_REGISTRY.items():
        assert entry["function"] is original_functions[name], f"{name} function not restored"
        assert entry["formatter"] is original_formatters[name], f"{name} formatter not restored"
    raw, _ = execute_tool("get_customer_balance", {"customer_name": "APPLE MART"})
    assert raw.get("customer_name") == "APPLE MART", "real business logic should be reachable again"


def test_probe_registry_restores_originals_even_if_the_wrapped_code_raises():
    original_functions = {name: entry["function"] for name, entry in TOOL_REGISTRY.items()}
    with pytest_raises_value_error():
        with probe_registry():
            raise ValueError("simulated failure mid-evaluation")
    for name, entry in TOOL_REGISTRY.items():
        assert entry["function"] is original_functions[name]


def pytest_raises_value_error():
    import pytest
    return pytest.raises(ValueError)


# ── AG3-fixed: fallback dates are dynamic (were hardcoded _THIS_MONTH=6/2026) ──
# The AG1 versions of these tests pinned the defect; they now pin the fix.

def test_fallback_this_month_resolves_to_the_real_current_month():
    from datetime import date
    today = date.today()
    result = _rule_based_route("What are the top selling products this month?")
    assert result["tool"] == "get_top_selling_products"
    # The router now resolves 'this month' via period parsing and reports the
    # actual applied date range in parameters (honest, dynamic — AG3).
    params = result["parameters"]
    if "period" in params:
        assert str(today.year) in params["period"]
        assert today.strftime("%b") in params["period"]
    else:
        assert params == {"month": today.month, "year": today.year}


def test_fallback_last_month_resolves_dynamically():
    from datetime import date
    today = date.today()
    m = today.month - 1 if today.month > 1 else 12
    y = today.year if today.month > 1 else today.year - 1
    result = _rule_based_route("Top selling products last month")
    params = result["parameters"]
    if "period" in params:
        assert str(y) in params["period"]
    else:
        assert params == {"month": m, "year": y}


def test_fallback_last_quarter_is_actually_filtered_not_silently_this_month():
    """AG1 finding (fixed in AG3): 'last quarter' used to silently default to the
    stale this-month constants. It now flows through parse_date_range and the
    parameters state the real quarter range applied."""
    from datetime import date
    from src.utils.date_filters import parse_date_range
    start, end = parse_date_range("last quarter")
    assert start and end, "'last quarter' must be a recognized phrase"
    result = _rule_based_route("Sales summary for last quarter")
    assert result["tool"] == "get_sales_summary"
    assert "period" in result["parameters"], "applied range must be visible in parameters"
    assert "month" not in result["parameters"], "no fake month/year default may be reported"
    # A stale-style hardcoded 'June 2026' default would show in the heading; the
    # real quarter label must be there instead.
    y = str(date.today().year if date.today().month > 3 else date.today().year - 1)
    assert y in result["parameters"]["period"]


# ── AG3-fixed: entity-aware analytic disambiguation ─────────────────────────
# AG1 proved "how is X"/"tell me about X" misrouted on keywords alone.

def test_how_is_a_customer_doing_routes_to_customer_insights():
    result = _rule_based_route("How is APPLE MART doing?")
    assert result["tool"] == "get_customer_insights"
    assert result["parameters"] == {"customer_name": "APPLE MART"}
    assert not result["result"].startswith("**Error:**")


def test_tell_me_about_a_product_routes_to_product_insights():
    assert _extract_customer("Tell me about Fresh Apples") is None
    result = _rule_based_route("Tell me about Fresh Apples")
    assert result["tool"] == "get_product_insights"
    assert result["parameters"].get("product_name")
    assert not result["result"].startswith("**Error:**")


def test_unambiguous_analytic_queries_still_route_as_before():
    """Backward compatibility: the AG3 resolver must not disturb queries that
    were already correct."""
    assert _rule_based_route("Tell me about APPLE MART")["tool"] == "get_customer_insights"
    assert _rule_based_route("How is Fresh Apples selling?")["tool"] == "get_product_insights"
    assert _rule_based_route("Customer insights for APPLE MART")["tool"] == "get_customer_insights"
    assert _rule_based_route("Product insights for Extra Virgin Olive Oil")["tool"] == "get_product_insights"


# ── Read-only guarantee holds at the routing layer, not just the Odoo gateway ──

def test_write_intent_queries_never_resolve_to_a_known_tool():
    for query in [
        "Delete the invoice for APPLE MART",
        "Create a new invoice for APPLE MART for $5000",
    ]:
        assert _detect_intent(query) == "unknown", f"{query!r} unexpectedly matched a tool intent"
        result = _rule_based_route(query)
        assert result["tool"] == "unknown"
        assert result["result"] == UNKNOWN_INTENT_MSG


# ── AG3-fixed: fallback now has Arabic keyword coverage ─────────────────────
# AG1 proved Arabic queries always dead-ended on UNKNOWN_INTENT_MSG.

def test_rule_based_fallback_understands_arabic_balance_question():
    query = "كم تدين لنا شركة APPLE MART؟"
    assert _detect_intent(query) == "balance"
    assert _extract_customer(query) == "APPLE MART"
    result = _rule_based_route(query)
    assert result["tool"] == "get_customer_balance"
    assert result["parameters"] == {"customer_name": "APPLE MART"}
    assert result["result"] != UNKNOWN_INTENT_MSG


def test_rule_based_fallback_has_no_history_parameter():
    """Proves the rule-based fallback structurally cannot use conversation history —
    referenced by GLOBAL-FOLLOWUP-01/02's notes."""
    import inspect
    sig = inspect.signature(_rule_based_route)
    assert "history" not in sig.parameters, (
        f"_rule_based_route signature is {sig} — if history now exists, the follow-up cases' "
        f"notes about OpenAI-only support are stale and must be revisited."
    )


# ── Unknown-customer handling in unpaid invoices ────────────────────────────
# AG1 originally documented that an explicitly-named unknown customer produced
# a silent zero-row "success" (inconsistent with every other customer-scoped
# tool). AG2 fixed the TOOL-level contract: a non-empty unknown name now
# returns the same {"error": ...} shape as get_customer_balance et al. The
# ROUTER-level half of the AG1 finding is unchanged and still owned by AG3.

def test_unknown_customer_now_errors_instead_of_silently_succeeding():
    """AG2 contract: get_unpaid_invoices() with a non-empty unknown name returns an
    error result — never a silent zero-row success, never an all-customer broadening."""
    from src.tools.invoice_tools import get_unpaid_invoices

    all_unpaid = get_unpaid_invoices(customer_name=None)
    named_unknown = get_unpaid_invoices(customer_name="GALAXY TRADERS TOTALLY UNKNOWN CO")

    assert "error" in named_unknown, "unknown customer must be an explicit error (AG2 fix)"
    assert "not found" in named_unknown["error"]
    assert all_unpaid["count"] > 0, "sanity: the mock dataset has unpaid invoices at all"

    # Routing-layer half — FIXED in AG3: the router's unknown-customer guard
    # now returns a clear "name the customer" reply instead of silently
    # broadening the question to every customer's unpaid invoices.
    result = _rule_based_route("Show unpaid invoices for GALAXY TRADERS")
    assert _extract_customer("Show unpaid invoices for GALAXY TRADERS") is None
    assert result["tool"] == "get_unpaid_invoices"
    assert result["result"] == NO_CUSTOMER_MSG, "unknown 'for X' must not broaden to all customers"
    # ...while a genuinely unscoped question still legitimately covers everyone:
    unscoped = _rule_based_route("Show unpaid invoices")
    assert unscoped["parameters"]["customer_name"] is None
    unfiltered = provider.get_invoices()
    expected_all_count = len([i for i in unfiltered if i["status"] in ("unpaid", "overdue")])
    assert all_unpaid["count"] == expected_all_count


# ── Singular/plural wording makes no difference (keyword substring match) ──

def test_overdue_invoice_singular_and_plural_both_match():
    assert _detect_intent("Show overdue invoice") == "overdue_invoices"
    assert _detect_intent("Show overdue invoices") == "overdue_invoices"


# ── Positive evidence: representative tools degrade gracefully with no OpenAI ──
# (the deterministic equivalent of the "OpenAI unavailable" global category —
# route_query() falls back to exactly this function on any OpenAI failure.)

def test_rule_based_fallback_correctly_resolves_a_customer_required_tool():
    result = _rule_based_route("How much does APPLE MART owe us?")
    assert result["tool"] == "get_customer_balance"
    assert result["parameters"] == {"customer_name": "APPLE MART"}
    assert "Outstanding Balance" in result["result"]


def test_rule_based_fallback_correctly_resolves_a_zero_parameter_tool():
    result = _rule_based_route("Which customers have overdue invoices?")
    assert result["tool"] == "get_overdue_invoices"
    assert "Overdue Invoices" in result["result"]


def test_rule_based_fallback_correctly_resolves_the_dashboard_tool():
    result = _rule_based_route("Show me the executive dashboard")
    assert result["tool"] == "get_dashboard_summary"
    assert "Executive" in result["result"] or "Dashboard" in result["result"]
