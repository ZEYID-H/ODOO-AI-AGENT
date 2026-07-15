"""AG2 — execution contract: every registered tool, called with valid
parameters against the mock backend, returns the documented result shape;
invalid/edge parameters fail safely and deterministically. Offline only.
"""

import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

import pytest  # noqa: E402

from src.agent.tool_registry import TOOL_REGISTRY, execute_tool  # noqa: E402

# Valid invocation + the result keys the formatter/consumers rely on.
# (customer/product names are real mock entities — src/data/mock_data.py.)
VALID_CALLS = {
    "get_customer_balance": (
        {"customer_name": "APPLE MART"},
        {"customer_name", "total_balance", "overdue_amount", "unpaid_count",
         "oldest_due_date", "credit_limit", "credit_used_pct", "open_invoices"},
    ),
    "get_customer_summary": (
        {"customer_name": "APPLE MART"},
        {"customer", "total_invoices", "total_billed", "total_paid",
         "outstanding_balance", "overdue_amount", "payments", "invoices"},
    ),
    "get_payment_history": (
        {"customer_name": "APPLE MART"},
        {"customer_name", "payments", "total_payments", "total_paid"},
    ),
    "get_top_debtors": (
        {"limit": 3},
        {"debtors", "customer_count", "total_outstanding", "limit", "period_label"},
    ),
    "get_customer_statement": (
        {"customer_name": "APPLE MART", "period": "this year"},
        {"customer_name", "rows", "total_invoiced", "total_paid",
         "outstanding_balance", "activity_balance", "invoice_count",
         "payment_count", "reconciles", "difference", "period_label", "period_note"},
    ),
    "get_unpaid_invoices": (
        {"customer_name": "APPLE MART"},
        {"customer_name", "invoices", "count", "total_amount", "period_label"},
    ),
    "get_overdue_invoices": (
        {},
        {"invoices", "count", "total_amount", "customers_affected",
         "by_customer", "period_label"},
    ),
    "get_top_selling_products": (
        {"month": 6, "year": 2026, "limit": 3},
        {"products", "product_count", "period_month", "period_year",
         "period_label", "total_revenue", "total_transactions"},
    ),
    "get_sales_summary": (
        {"month": 6, "year": 2026},
        {"period_month", "period_year", "period_label", "total_revenue",
         "total_transactions", "avg_transaction", "by_customer", "by_product",
         "customer_count", "product_count"},
    ),
    "get_dashboard_summary": (
        {},
        {"total_revenue", "avg_transaction", "total_transactions",
         "outstanding_receivables", "total_overdue", "overdue_invoice_count",
         "open_invoice_count", "top_debtor", "top_product",
         "customer_count", "product_count"},
    ),
    "get_collection_priorities": (
        {"limit": 2},
        {"priorities", "customer_count", "total_overdue"},
    ),
    "get_customer_insights": (
        {"customer_name": "APPLE MART"},
        {"customer_name", "lifetime_revenue", "total_invoices", "total_payments",
         "outstanding_balance", "overdue_amount", "average_order_value",
         "first_purchase_date", "last_purchase_date", "days_since_last_purchase",
         "purchase_frequency", "risk_level", "recommended_action"},
    ),
    "get_product_insights": (
        {"product_name": "Fresh Apples"},
        {"query", "mode", "matched_skus", "revenue", "units_sold",
         "customer_count", "first_sale_date", "last_sale_date",
         "average_sale_price", "revenue_share_pct", "top_customers"},
    ),
    "get_business_alerts": (
        {"limit": 3},
        {"alerts", "total_alerts"},
    ),
}

# Customer-scoped tools that must return {"error": ...} for an unknown name.
CUSTOMER_SCOPED = [
    "get_customer_balance", "get_customer_summary", "get_payment_history",
    "get_customer_statement", "get_customer_insights", "get_unpaid_invoices",
]


def test_valid_calls_cover_every_registered_tool():
    assert set(VALID_CALLS) == set(TOOL_REGISTRY)


@pytest.mark.parametrize("tool", sorted(VALID_CALLS))
def test_valid_parameters_produce_the_documented_result_shape(tool):
    args, expected_keys = VALID_CALLS[tool]
    raw, formatted = execute_tool(tool, args)
    assert isinstance(raw, dict), tool
    assert "error" not in raw, f"{tool}: valid call unexpectedly errored: {raw}"
    missing = expected_keys - set(raw)
    assert not missing, f"{tool}: result missing keys {missing}"
    assert isinstance(formatted, str) and formatted.strip(), f"{tool}: blank formatted output"


@pytest.mark.parametrize("tool", CUSTOMER_SCOPED)
def test_unknown_customer_is_an_explicit_error_never_a_silent_success(tool):
    raw = TOOL_REGISTRY[tool]["function"](customer_name="NO SUCH CUSTOMER LLC")
    assert "error" in raw, f"{tool}: unknown customer did not error"
    assert "not found" in raw["error"].lower()
    formatted = TOOL_REGISTRY[tool]["formatter"](raw)
    assert formatted.startswith("**Error:**"), f"{tool}: error not clearly presented"


def test_unknown_product_is_an_explicit_error():
    raw = TOOL_REGISTRY["get_product_insights"]["function"](product_name="Purple Widget 9000")
    assert raw["mode"] == "no_match" and "error" in raw
    formatted = TOOL_REGISTRY["get_product_insights"]["formatter"](raw)
    assert formatted.startswith("**Error:**")


def test_customer_name_matching_is_case_insensitive_and_result_is_canonical():
    for tool in CUSTOMER_SCOPED:
        raw = TOOL_REGISTRY[tool]["function"](customer_name="  apple mart  ")
        assert "error" not in raw, f"{tool}: case/whitespace variant rejected"
        # Whichever key carries the name, it must be the canonical record name.
        name = raw.get("customer_name") or raw.get("customer", {}).get("name")
        assert name == "APPLE MART", f"{tool}: returned {name!r}, not the canonical name"


def test_unpaid_invoices_blank_customer_means_all_customers_not_an_error():
    """Documented omit semantics: schema says 'Omit to list all customers'.
    ''/whitespace-only normalize to omitted — identically, not divergently
    (pre-AG2, '' broadened and '   ' silently returned zero rows)."""
    from src.tools.invoice_tools import get_unpaid_invoices
    all_c = get_unpaid_invoices(customer_name=None)
    assert get_unpaid_invoices(customer_name="")["count"] == all_c["count"]
    assert get_unpaid_invoices(customer_name="   ")["count"] == all_c["count"]


@pytest.mark.parametrize("tool,default_len_key", [
    ("get_top_debtors", "debtors"),
    ("get_collection_priorities", "priorities"),
    ("get_top_selling_products", "products"),
    ("get_business_alerts", "alerts"),
])
@pytest.mark.parametrize("bad_limit", [-1, 0])
def test_invalid_limits_fall_back_to_the_default_never_dropping_ranked_rows(
    tool, default_len_key, bad_limit
):
    """Pre-AG2, list[:-1] silently dropped the LAST ranked row for limit=-1."""
    fn = TOOL_REGISTRY[tool]["function"]
    with_bad = fn(limit=bad_limit)
    with_default = fn()
    assert len(with_bad[default_len_key]) == len(with_default[default_len_key]), (
        f"{tool}: limit={bad_limit} changed the result vs the default"
    )


def test_explicit_year_in_period_is_honored():
    """AG2 fix D3: 'June 2025' used to silently resolve to June of the CURRENT year."""
    from datetime import date
    from src.utils.date_filters import parse_date_range
    assert parse_date_range("June 2025", today=date(2026, 7, 15)) == ("2025-06-01", "2025-06-30")
    assert parse_date_range("sales for march 2024", today=date(2026, 7, 15)) == ("2024-03-01", "2024-03-31")
    # The bare-month current-year fallback still works.
    assert parse_date_range("sales in March", today=date(2026, 7, 15)) == ("2026-03-01", "2026-03-31")


def test_period_filtered_results_carry_an_explicit_date_range_label():
    """AG2 fix D12: date-filtered results used to carry no period context at all."""
    from src.tools.invoice_tools import get_unpaid_invoices, get_overdue_invoices
    from src.tools.customer_tools import get_top_debtors
    for result in (
        get_unpaid_invoices(period="this month"),
        get_overdue_invoices(period="this month"),
        get_top_debtors(period="this month"),
    ):
        assert result["period_label"], "filtered result must name its date range"
    # ...and no fake label when no filter was applied.
    assert get_unpaid_invoices()["period_label"] is None
    assert get_overdue_invoices(period="no dates in this text")["period_label"] is None


def test_sales_summary_breakdowns_are_bounded():
    """AG2 fix D8: by_customer was unbounded (live Odoo would list every customer)."""
    from src.tools.sales_tools import get_sales_summary, _SUMMARY_TOP_N
    s = get_sales_summary()
    assert len(s["by_customer"]) <= _SUMMARY_TOP_N
    assert len(s["by_product"]) <= _SUMMARY_TOP_N
    assert s["customer_count"] >= len(s["by_customer"])


def test_execute_tool_rejects_unknown_tool_names():
    with pytest.raises(KeyError):
        execute_tool("get_totally_fake_tool", {})


def test_execute_tool_unexpected_parameter_raises_cleanly():
    """Documented behavior: an unexpected kwarg raises TypeError, which
    run_agent propagates and route_query() catches (degrading to the
    rule-based fallback). It must never half-execute."""
    with pytest.raises(TypeError):
        execute_tool("get_dashboard_summary", {"bogus_parameter": 1})


def test_route_query_result_remains_api_and_frontend_compatible():
    """The public envelope {tool, parameters, result} must satisfy
    apps/api's ChatResponse — proven against the real pydantic model."""
    from src.agent.router import _rule_based_route
    from apps.api.schemas import ChatResponse

    for query in ("How much does APPLE MART owe us?", "hello nonsense query"):
        r = _rule_based_route(query)
        assert set(r) == {"tool", "parameters", "result"}
        model = ChatResponse(success=True, tool=r["tool"],
                             parameters=r["parameters"] or {}, result=r["result"])
        assert model.result == r["result"]
