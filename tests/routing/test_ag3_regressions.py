# -*- coding: utf-8 -*-
"""AG3 — permanent regression suite for the routing hardening.

One named test (or family) per fixed defect, plus an intent matrix and a
backward-compatibility sweep. Deterministic, offline: everything here
exercises the rule-based path (`_rule_based_route`) directly — the OpenAI
path's routing quality is measured separately by the AG1 evaluation harness
(`scripts/run_agent_evaluation.py`).
"""

import sys
from datetime import date
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

import pytest  # noqa: E402

from src.agent.prompts import NO_CUSTOMER_MSG, SYSTEM_PROMPT, UNKNOWN_INTENT_MSG  # noqa: E402
from src.agent.router import (  # noqa: E402
    _extract_customer, _extract_period, _match_product,
    _names_unmatched_customer, _rule_based_route,
)
from src.utils.date_filters import parse_date_range  # noqa: E402


def route(query: str) -> dict:
    return _rule_based_route(query)


# ═══ Defect 1 (AG1/M1): hardcoded fallback dates ════════════════════════════

def test_no_hardcoded_date_constants_remain():
    import src.agent.router as router_module
    assert not hasattr(router_module, "_THIS_MONTH")
    assert not hasattr(router_module, "_THIS_YEAR")


def test_relative_periods_track_the_real_clock():
    today = date.today()
    assert _extract_period("sales this month") == (today.month, today.year)
    m = today.month - 1 if today.month > 1 else 12
    y = today.year if today.month > 1 else today.year - 1
    assert _extract_period("sales last month") == (m, y)


def test_default_scope_without_any_period_is_the_real_current_month():
    today = date.today()
    result = route("Show top selling products")
    assert result["tool"] == "get_top_selling_products"
    assert result["parameters"] == {"month": today.month, "year": today.year}


@pytest.mark.parametrize("phrase", [
    "last quarter", "this quarter", "last 30 days", "last 90 days",
    "year to date", "month to date", "current month", "previous month",
    "this week", "last week", "today", "yesterday", "this year", "last year",
])
def test_every_documented_relative_phrase_parses(phrase):
    start, end = parse_date_range(phrase)
    assert start and end, f"{phrase!r} must resolve to a concrete range"
    assert start <= end


def test_parsed_period_is_reported_honestly_in_parameters():
    """Pre-AG3 the fallback reported month/year values it wasn't actually
    using whenever the period text took priority; the parameters now state the
    real applied range."""
    result = route("Sales summary for last quarter")
    assert result["tool"] == "get_sales_summary"
    assert set(result["parameters"]) == {"period"}
    start, _end = parse_date_range("last quarter")
    assert start[:4] in result["parameters"]["period"]


def test_explicit_year_beats_the_current_year():
    result = route("Summarize sales for June 2026")
    assert result["parameters"].get("period"), "explicit month+year should parse as a period"
    assert "2026" in result["parameters"]["period"]
    assert "Jun" in result["parameters"]["period"]


# ═══ Defect 2 (AG1): ambiguous analytic phrasings ═══════════════════════════

AMBIGUITY_MATRIX = [
    ("Tell me about Apple Mart.", "get_customer_insights"),
    ("What can you tell me about Apple Mart?", "get_customer_insights"),
    ("Analyze Apple Mart", "get_customer_insights"),
    ("Give me insights about Apple Mart", "get_customer_insights"),
    ("How is APPLE MART doing?", "get_customer_insights"),
    ("Show Apple Mart balance.", "get_customer_balance"),
    ("How much does Apple Mart owe us?", "get_customer_balance"),
    ("Show Apple Mart invoices.", "get_unpaid_invoices"),
    ("Tell me about Fresh Apples", "get_product_insights"),
    ("How is Fresh Apples selling?", "get_product_insights"),
    ("Analyze Fresh Apples", "get_product_insights"),
    ("Analyze product Fresh Apples", "get_product_insights"),
]


@pytest.mark.parametrize("query,expected", AMBIGUITY_MATRIX)
def test_ambiguous_query_matrix(query, expected):
    result = route(query)
    assert result["tool"] == expected, f"{query!r} -> {result['tool']}, wanted {expected}"
    assert not result["result"].startswith("**Error:**"), (
        f"{query!r} routed to {result['tool']} but the tool errored — wrong entity extracted"
    )


def test_entity_type_decides_between_customer_and_product_analytics():
    """The core AG3 rule: for analytic phrasings the ENTITY decides, keywords
    only break ties."""
    assert route("How is APPLE MART doing?")["tool"] == "get_customer_insights"
    assert route("How is Fresh Apples doing?")["tool"] == "get_product_insights"


# ═══ Defect 3 (AG1): unknown-customer scope broadening ══════════════════════

def test_unknown_customer_in_unpaid_invoices_never_broadens():
    result = route("Show unpaid invoices for GALAXY TRADERS")
    assert result["tool"] == "get_unpaid_invoices"
    assert result["result"] == NO_CUSTOMER_MSG
    assert "All Customers" not in result["result"]


def test_genuinely_unscoped_unpaid_invoices_still_covers_all_customers():
    for query in ("Show unpaid invoices",
                  "Show unpaid invoices for all customers",
                  "Show me every single unpaid invoice across all customers, all pages"):
        result = route(query)
        assert result["tool"] == "get_unpaid_invoices"
        assert "All Customers" in result["result"], f"{query!r} wrongly refused"


def test_for_a_date_phrase_is_not_mistaken_for_a_customer():
    result = route("Show unpaid invoices for this month")
    assert result["result"] != NO_CUSTOMER_MSG
    assert result["parameters"].get("period"), "date filter should apply and be reported"


def test_names_unmatched_customer_guard_edges():
    assert _names_unmatched_customer("unpaid invoices for GALAXY TRADERS")
    assert not _names_unmatched_customer("unpaid invoices for this month")
    assert not _names_unmatched_customer("unpaid invoices for all customers")
    assert not _names_unmatched_customer("unpaid invoices")


# ═══ Defect 4 (AG1): no Arabic coverage in the fallback ═════════════════════

ARABIC_MATRIX = [
    ("كم تدين لنا شركة APPLE MART؟", "get_customer_balance"),
    ("أعطني ملخص حساب شركة APPLE MART", "get_customer_summary"),
    ("أظهر لي سجل مدفوعات شركة APPLE MART", "get_payment_history"),
    ("من هم أكبر المدينين لنا؟", "get_top_debtors"),
    ("أعطني كشف حساب شركة APPLE MART", "get_customer_statement"),
    ("أظهر الفواتير غير المدفوعة لشركة APPLE MART", "get_unpaid_invoices"),
    ("ما هي الفواتير المتأخرة؟", "get_overdue_invoices"),
    ("ما هي المنتجات الأكثر مبيعاً هذا الشهر؟", "get_top_selling_products"),
    ("لخص لنا المبيعات لشهر يونيو 2026", "get_sales_summary"),
    ("أرني لوحة المعلومات التنفيذية", "get_dashboard_summary"),
    ("من يجب أن نتابع معه بخصوص الدفع؟", "get_collection_priorities"),
    ("حلل لي حساب شركة APPLE MART", "get_customer_insights"),
    ("كيف أداء منتج Extra Virgin Olive Oil؟", "get_product_insights"),
    ("أظهر لي تنبيهات الأعمال", "get_business_alerts"),
]


@pytest.mark.parametrize("query,expected", ARABIC_MATRIX)
def test_arabic_intent_matrix_covers_all_14_tools(query, expected):
    result = route(query)
    assert result["tool"] == expected, f"{query!r} -> {result['tool']}, wanted {expected}"
    assert result["result"] != UNKNOWN_INTENT_MSG


def test_arabic_month_and_year_are_extracted():
    assert _extract_period("لخص لنا المبيعات لشهر يونيو 2026") == (6, 2026)
    result = route("لخص لنا المبيعات لشهر يونيو 2026")
    assert result["parameters"] == {"month": 6, "year": 2026}


def test_arabic_relative_this_month_is_dynamic():
    today = date.today()
    assert _extract_period("المبيعات هذا الشهر") == (today.month, today.year)


# ═══ Defect 5 (AG1): mock-bound customer extraction ═════════════════════════

def test_customer_extraction_reads_through_the_provider(monkeypatch):
    """The fallback must recognize whatever customers the ACTIVE backend has —
    not just the hardcoded mock list (pre-AG3 it imported mock_data.CUSTOMERS
    directly, so live-Odoo customers were never extractable)."""
    from src.data import provider
    monkeypatch.setattr(provider, "get_customers", lambda: [
        {"name": "ZANZIBAR IMPORTS", "email": "", "phone": "", "credit_limit": 0, "currency": "QAR"},
    ])
    assert _extract_customer("How much does ZANZIBAR IMPORTS owe us?") == "ZANZIBAR IMPORTS"
    assert _extract_customer("How much does APPLE MART owe us?") is None, (
        "with a swapped backend, the old mock names must no longer match"
    )


def test_longest_customer_name_wins(monkeypatch):
    from src.data import provider
    monkeypatch.setattr(provider, "get_customers", lambda: [
        {"name": "STAR", "email": "", "phone": "", "credit_limit": 0, "currency": "QAR"},
        {"name": "GOLDEN STAR TRADING", "email": "", "phone": "", "credit_limit": 0, "currency": "QAR"},
    ])
    assert _extract_customer("balance for GOLDEN STAR TRADING") == "GOLDEN STAR TRADING"


# ═══ Entity extraction robustness (goal 5) ══════════════════════════════════

@pytest.mark.parametrize("variant", [
    "Apple Mart", "apple mart", "APPLE MART", "Apple-Mart", "Apple Mart LLC",
    "  Apple   Mart  ", "'Apple Mart'", '"APPLE MART"', "Apple Mart.",
    "Apple Mart's", "APPLE-MART!!!",
])
def test_customer_name_variants_all_extract(variant):
    assert _extract_customer(f"How much does {variant} owe us?") == "APPLE MART", variant


def test_partial_product_names_match():
    assert _match_product("Extra Virgin Olive Oil")   # exact
    assert _match_product("Olive Oil")                # substring of a product
    assert _match_product("fresh apples")             # case-insensitive
    assert not _match_product("Purple Widget 9000")
    assert not _match_product("ok")                   # too short to trust


# ═══ Live-path guidance exists for the AG1 live misses (defect 6) ═══════════
# The OpenAI path's fixes are prompt-level; their effect is measured by the
# model-assisted eval. These tests pin that the guidance itself cannot
# silently disappear from SYSTEM_PROMPT.

def test_system_prompt_carries_overdue_disambiguation_guidance():
    assert "get_overdue_invoices" in SYSTEM_PROMPT
    assert "missed" in SYSTEM_PROMPT.lower()
    assert "follow up with" in SYSTEM_PROMPT.lower() or "chase" in SYSTEM_PROMPT.lower()


def test_system_prompt_carries_follow_up_resolution_guidance():
    assert "conversation history" in SYSTEM_PROMPT
    assert "too" in SYSTEM_PROMPT


def test_system_prompt_carries_entity_disambiguation_guidance():
    assert "get_customer_insights" in SYSTEM_PROMPT
    assert "get_product_insights" in SYSTEM_PROMPT


# ═══ Backward compatibility sweep (goal 8) ══════════════════════════════════
# Every rule-path routing that worked before AG3 must still work.

BACKWARD_COMPAT = [
    ("How much does APPLE MART owe us?", "get_customer_balance"),
    ("What is APPLE MART's outstanding balance?", "get_customer_balance"),
    ("Get customer summary for APPLE MART", "get_customer_summary"),
    ("Show payment history for APPLE MART", "get_payment_history"),
    ("What are the top debtors?", "get_top_debtors"),
    ("Who owes us the most money?", "get_top_debtors"),
    ("customer statement for APPLE MART", "get_customer_statement"),
    ("Give me the ledger for TECH SOLUTIONS CO", "get_customer_statement"),
    ("Show unpaid invoices for APPLE MART", "get_unpaid_invoices"),
    ("Which customers have overdue invoices?", "get_overdue_invoices"),
    ("Show me past due invoices", "get_overdue_invoices"),
    ("Any missed payments recently?", "get_overdue_invoices"),
    ("Show overdue invoice", "get_overdue_invoices"),
    ("Top selling products this month", "get_top_selling_products"),
    ("Show me the best sellers", "get_top_selling_products"),
    ("What's our sales performance?", "get_sales_summary"),
    ("Show me the executive dashboard", "get_dashboard_summary"),
    ("What are our key business metrics?", "get_dashboard_summary"),
    ("Who should we follow up with for payment?", "get_collection_priorities"),
    ("Show me collection priorities", "get_collection_priorities"),
    ("What's APPLE MART's risk level?", "get_customer_insights"),
    ("What should I worry about in the business?", "get_business_alerts"),
    ("Show me the top 3 business alerts", "get_business_alerts"),
    ("hello", "unknown"),
    ("What is the weather today?", "unknown"),
    ("Delete the invoice for APPLE MART", "unknown"),
    ("Create a new invoice for APPLE MART for $5000", "unknown"),
]


@pytest.mark.parametrize("query,expected", BACKWARD_COMPAT)
def test_backward_compatible_routing(query, expected):
    assert route(query)["tool"] == expected


def test_route_query_envelope_unchanged():
    result = route("How much does APPLE MART owe us?")
    assert set(result) == {"tool", "parameters", "result"}
    assert isinstance(result["parameters"], dict)
    assert isinstance(result["result"], str)


def test_fallback_remains_stateless_by_design():
    """Documented AG3 decision: follow-up reference resolution is an LLM-path
    capability; the deterministic fallback takes no history. If this signature
    ever changes, revisit docs/AI_AGENT_ROUTING.md's limitation section."""
    import inspect
    assert "history" not in inspect.signature(_rule_based_route).parameters
