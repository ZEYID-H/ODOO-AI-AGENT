"""AG2 — formatter contract: every registered formatter renders its real
result type into safe, complete, bounded markdown. Offline only; empty-dataset
scenarios are produced by monkeypatching the provider functions the tools
actually call.
"""

import re
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

import pytest  # noqa: E402

from src.agent.tool_registry import TOOL_REGISTRY, execute_tool  # noqa: E402
from src.data import provider  # noqa: E402
from src.utils.formatting import CURRENCY, TABLE_MAX_ROWS, fmt_currency, fmt_invoice_table, fmt_payment_table  # noqa: E402
from tests.contracts.test_tool_result_shapes import VALID_CALLS  # noqa: E402

# Tools whose formatted output must state amounts with an explicit currency.
FINANCIAL_TOOLS = [
    "get_customer_balance", "get_customer_summary", "get_payment_history",
    "get_top_debtors", "get_customer_statement", "get_unpaid_invoices",
    "get_overdue_invoices", "get_top_selling_products", "get_sales_summary",
    "get_dashboard_summary", "get_collection_priorities",
    "get_customer_insights", "get_product_insights",
]

# Signals of a raw Python object leaking into user-facing text.
_REPR_LEAK = re.compile(r"Decimal\(|<[a-z_]+\.[A-Za-z_.]+ object at 0x|\{'|\[\{")


@pytest.mark.parametrize("tool", sorted(VALID_CALLS))
def test_formatter_accepts_its_real_result_and_leaks_no_repr(tool):
    args, _ = VALID_CALLS[tool]
    _, formatted = execute_tool(tool, args)
    assert formatted.strip(), f"{tool}: blank output"
    assert not _REPR_LEAK.search(formatted), f"{tool}: raw object repr leaked"
    assert "Traceback" not in formatted


@pytest.mark.parametrize("tool", FINANCIAL_TOOLS)
def test_financial_output_states_an_explicit_currency(tool):
    args, _ = VALID_CALLS[tool]
    _, formatted = execute_tool(tool, args)
    assert CURRENCY in formatted, f"{tool}: no explicit currency in financial output"


def test_currency_formatting_is_consistent_everywhere():
    assert fmt_currency(0) == f"{CURRENCY} 0.00"
    assert fmt_currency(1234567.891) == f"{CURRENCY} 1,234,567.89"
    assert fmt_currency(-500) == f"{CURRENCY} -500.00"
    # Float artifacts must never surface (0.1+0.2 style).
    assert fmt_currency(0.1 + 0.2) == f"{CURRENCY} 0.30"


def test_data_layer_currency_tag_matches_the_display_currency():
    """AG2 fix D2: customers were tagged USD while every amount printed QAR."""
    for c in provider.get_customers():
        assert c["currency"] == CURRENCY


def test_zero_values_render_explicitly():
    from src.tools.customer_tools import format_customer_balance
    zeroed = {
        "customer_name": "APPLE MART", "total_balance": 0.0, "overdue_amount": 0.0,
        "unpaid_count": 0, "oldest_due_date": None, "credit_limit": 50000.0,
        "credit_used_pct": 0, "open_invoices": [],
    }
    out = format_customer_balance(zeroed)
    assert f"{CURRENCY} 0.00" in out, "zero balance must be shown, not omitted"


def test_dates_render_unambiguously():
    from src.utils.formatting import fmt_date
    assert fmt_date("2026-06-05") == "05 Jun 2026"  # day/month can't be confused
    assert fmt_date("") == ""  # unparseable input degrades, never raises


def test_invoice_table_shows_outstanding_distinct_from_amount():
    """AG2 fix D11: a partially-paid invoice's outstanding differs from its
    amount (Odoo mode); totals sum outstanding so the table must show it."""
    rows = [{
        "id": "INV-1", "description": "Partial", "amount": 1000.0,
        "paid_amount": 400.0, "status": "unpaid", "due_date": "2026-08-01",
        "customer_name": "APPLE MART", "issue_date": "2026-07-01",
    }]
    out = fmt_invoice_table(rows)
    assert f"{CURRENCY} 1,000.00" in out and f"{CURRENCY} 600.00" in out
    assert "Outstanding" in out


def test_detail_tables_are_bounded_with_a_truncation_note():
    """AG2 fix D4: unbounded invoice/payment tables could flood a live-Odoo response."""
    many = [{
        "id": f"INV-{i}", "description": "x", "amount": 10.0, "paid_amount": 0.0,
        "status": "unpaid", "due_date": "2026-08-01",
        "customer_name": "A", "issue_date": "2026-07-01",
    } for i in range(TABLE_MAX_ROWS + 25)]
    out = fmt_invoice_table(many)
    assert out.count("| INV-") == TABLE_MAX_ROWS
    assert f"Showing {TABLE_MAX_ROWS} of {TABLE_MAX_ROWS + 25}" in out

    pay = [{"id": f"P-{i}", "amount": 5.0, "date": "2026-07-01",
            "method": "Bank", "reference": f"R{i}"} for i in range(TABLE_MAX_ROWS + 5)]
    pout = fmt_payment_table(pay)
    assert pout.count("| P-") == TABLE_MAX_ROWS
    assert f"Showing {TABLE_MAX_ROWS} of {TABLE_MAX_ROWS + 5}" in pout


def test_falsy_cells_render_placeholders_not_blank_or_none():
    """AG2 fix D10: Odoo mode can produce empty method/reference/description/due_date."""
    out = fmt_payment_table([{"id": "P-1", "amount": 5.0, "date": "",
                              "method": "", "reference": ""}])
    assert "| - | - |" in out and "N/A" in out
    inv_out = fmt_invoice_table([{
        "id": "INV-1", "description": "", "amount": 10.0, "paid_amount": 0.0,
        "status": "unpaid", "due_date": "", "customer_name": "A", "issue_date": "",
    }])
    assert "| - |" in inv_out and "N/A" in inv_out
    assert "None" not in out and "None" not in inv_out


def test_ranked_outputs_indicate_truncation():
    """AG2 fix D5: limited lists must say they are limited."""
    from src.tools.customer_tools import get_top_debtors, format_top_debtors
    from src.tools.business_alerts_tools import get_business_alerts, format_business_alerts
    from src.tools.collections_tools import get_collection_priorities, format_collection_priorities

    d = get_top_debtors(limit=2)
    if d["customer_count"] > 2:
        assert "Showing top 2 of" in format_top_debtors(d)

    b = get_business_alerts(limit=2)
    if b["total_alerts"] > 2:
        out = format_business_alerts(b)
        assert "Showing top 2 of" in out
        # app.py's regex parser depends on this exact marker — never remove it.
        assert re.search(r"\*\*Total Alerts:\*\*\s*\d+", out)

    c = get_collection_priorities(limit=1)
    if c["customer_count"] > 1:
        assert "Showing top 1 of" in format_collection_priorities(c)


def test_streamlit_alert_parser_still_parses_the_alert_format():
    """format_business_alerts is regex-parsed by app.py::_parse_alerts; its
    structural markers are a compatibility contract, verified here without
    importing streamlit (the parsing regexes are replicated literally)."""
    from src.tools.business_alerts_tools import get_business_alerts, format_business_alerts
    md = format_business_alerts(get_business_alerts(limit=3))
    assert re.search(r"\*\*Total Alerts:\*\*\s*(\d+)", md)
    sections = re.split(r"^###\s+", md, flags=re.M)[1:]
    assert sections, "alert sections must remain ### headed"
    for sec in sections:
        assert re.match(r"\d+\.\s*\[(\w+)\]\s*(.+)", sec.splitlines()[0].strip()), (
            "### N. [Risk] Title marker broken — app.py's parser would fall back"
        )


def test_empty_datasets_produce_explicit_empty_states(monkeypatch):
    """No tool may return a blank string or a bare table header when the
    dataset has no matching records."""
    monkeypatch.setattr(provider, "get_invoices", lambda: [])
    monkeypatch.setattr(provider, "get_payments", lambda: [])
    monkeypatch.setattr(provider, "get_sales", lambda: [])

    from src.tools.invoice_tools import get_unpaid_invoices, format_unpaid_invoices
    from src.tools.invoice_tools import get_overdue_invoices, format_overdue_invoices
    from src.tools.collections_tools import get_collection_priorities, format_collection_priorities
    from src.tools.sales_tools import get_sales_summary, format_sales_summary

    out = format_unpaid_invoices(get_unpaid_invoices())
    assert "No unpaid invoices found" in out

    out = format_overdue_invoices(get_overdue_invoices())
    assert "No overdue invoices found" in out
    assert "|" not in out, "empty state must not render bare table headers"

    out = format_collection_priorities(get_collection_priorities())
    assert "nothing to follow up" in out

    out = format_sales_summary(get_sales_summary())
    assert "No sales data found" in out


def test_deterministic_ordering_where_business_meaning_requires_it():
    from src.tools.customer_tools import get_top_debtors
    from src.tools.invoice_tools import get_unpaid_invoices, get_overdue_invoices

    d = get_top_debtors()["debtors"]
    assert d == sorted(d, key=lambda x: x["outstanding_balance"], reverse=True)

    u = get_unpaid_invoices()["invoices"]
    assert u == sorted(u, key=lambda x: x["due_date"])

    o = get_overdue_invoices()["by_customer"]
    assert o == sorted(o, key=lambda x: x["total_overdue"], reverse=True)
