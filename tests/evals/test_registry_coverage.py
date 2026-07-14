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
    _THIS_MONTH, _THIS_YEAR, _detect_intent, _extract_customer, _extract_period,
    _rule_based_route,
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


# ── Known issue: stale hardcoded fallback date constants (NOT fixed here) ──
# src/agent/router.py lines 51-52: _THIS_MONTH = 6, _THIS_YEAR = 2026.
# Explicit instruction for AG1: document/demonstrate, do not fix. Owner of the
# eventual fix: AG3 (routing behavior).

def test_stale_date_constants_are_exactly_what_the_fallback_uses_for_this_month():
    assert (_THIS_MONTH, _THIS_YEAR) == (6, 2026), (
        "This test pins the exact hardcoded values the rule-based fallback is built on. "
        "If this fails, the constants changed — re-derive the AG1 baseline's date-sensitive "
        "findings rather than editing this assertion to match."
    )
    result = _rule_based_route("What are the top selling products this month?")
    assert result["tool"] == "get_top_selling_products"
    assert result["parameters"] == {"month": 6, "year": 2026}, (
        "Proves 'this month' resolves to the hardcoded constants, not the real current date, "
        "on the rule-based fallback path (src/agent/router.py::_extract_period)."
    )


def test_stale_date_constants_affect_last_month_too():
    result = _rule_based_route("Top selling products last month")
    assert result["parameters"] == {"month": 5, "year": 2026}, (
        "'last month' = _THIS_MONTH-1 computed from the same hardcoded constants, not from "
        "the real current date."
    )


def test_unhandled_relative_period_silently_defaults_to_the_stale_this_month_constants():
    """'last quarter' is not one of _extract_period's special-cased phrases (only 'this
    month'/'last month', an explicit month name, or a bare 4-digit year are). The rule-based
    fallback then silently defaults to the stale this-month constants instead of raising or
    reporting 'not understood' — a distinct, compounding finding from the constants themselves
    being wrong."""
    month, year = _extract_period("Sales summary for last quarter")
    assert (month, year) == (None, None), "extraction correctly finds nothing for 'last quarter'"
    result = _rule_based_route("Sales summary for last quarter")
    assert result["tool"] == "get_sales_summary"
    assert result["parameters"] == {"month": 6, "year": 2026}, (
        "Silently substitutes the stale this-month default rather than reporting the period "
        "as unrecognized."
    )


# ── Known issue: ambiguous-entity keyword mis-routing (NOT fixed here) ─────
# Owner of the eventual fix: AG3 (routing behavior).

def test_how_is_x_doing_misroutes_a_customer_query_to_product_insights():
    assert _detect_intent("How is APPLE MART doing?") == "product_insights", (
        "'how is' is checked in the product_insights keyword list before any customer-aware "
        "handling; a genuine customer question about APPLE MART is misrouted."
    )
    result = _rule_based_route("How is APPLE MART doing?")
    assert result["tool"] == "get_product_insights"
    # APPLE MART is a customer name, not a substring of any real product name
    # (src/data/mock_data.py PRODUCTS), so the real tool call comes back no_match.
    assert result["result"].startswith("**Error:**")
    assert "No product found matching" in result["result"]


def test_tell_me_about_x_misroutes_a_product_query_to_customer_insights():
    assert _detect_intent("Tell me about Fresh Apples") == "customer_insights", (
        "'tell me about' is only in the customer_insights keyword list; a genuine product "
        "question about Fresh Apples is misrouted and never reaches get_product_insights."
    )
    assert _extract_customer("Tell me about Fresh Apples") is None, "Fresh Apples is not a known customer"
    result = _rule_based_route("Tell me about Fresh Apples")
    assert result["tool"] == "get_customer_insights"
    assert result["result"] == NO_CUSTOMER_MSG


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


# ── Rule-based fallback has no Arabic keyword coverage ──────────────────────

def test_rule_based_fallback_does_not_understand_arabic_even_with_a_known_customer_present():
    query = "كم تدين لنا شركة APPLE MART؟"
    assert _detect_intent(query) == "unknown", (
        "No English keyword substring exists in the Arabic query text, so intent detection fails "
        "even though the Latin-script customer name is embedded in it."
    )
    assert _extract_customer(query) == "APPLE MART", (
        "Customer extraction still succeeds (uppercase substring match), but the extracted name is "
        "discarded: _rule_based_route()'s final 'unknown' branch never references it."
    )
    result = _rule_based_route(query)
    assert result["tool"] == "unknown"
    assert result["result"] == UNKNOWN_INTENT_MSG


def test_rule_based_fallback_has_no_history_parameter():
    """Proves the rule-based fallback structurally cannot use conversation history —
    referenced by GLOBAL-FOLLOWUP-01/02's notes."""
    import inspect
    sig = inspect.signature(_rule_based_route)
    assert "history" not in sig.parameters, (
        f"_rule_based_route signature is {sig} — if history now exists, the follow-up cases' "
        f"notes about OpenAI-only support are stale and must be revisited."
    )


# ── Silent scope-broadening on an unrecognized customer name (unpaid invoices) ──

def test_unknown_customer_silently_broadens_unpaid_invoices_to_all_customers():
    """Direct tool-level proof (bypasses routing entirely): get_unpaid_invoices() treats
    customer_name=None as 'no filter'. Combined with the router's inability to extract an
    unrecognized name, an unrecognized customer's unpaid-invoices question silently returns
    every customer's unpaid invoices instead of an empty result or an error."""
    from src.tools.invoice_tools import get_unpaid_invoices

    all_unpaid = get_unpaid_invoices(customer_name=None)
    named_unknown = get_unpaid_invoices(customer_name="GALAXY TRADERS TOTALLY UNKNOWN CO")

    assert named_unknown["count"] == 0, "an explicitly unmatched name correctly filters to zero rows"
    assert all_unpaid["count"] > 0, "sanity: the mock dataset has unpaid invoices at all"

    # The routing-layer defect: _extract_customer returns None (not the literal unmatched
    # string) for an unrecognized name, so the ROUTER ends up calling
    # get_unpaid_invoices(customer_name=None, ...) — the "no filter" branch — not the
    # explicitly-filtered branch demonstrated above.
    result = _rule_based_route("Show unpaid invoices for GALAXY TRADERS")
    assert _extract_customer("Show unpaid invoices for GALAXY TRADERS") is None
    assert result["tool"] == "get_unpaid_invoices"
    assert result["parameters"] == {"customer_name": None}
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
