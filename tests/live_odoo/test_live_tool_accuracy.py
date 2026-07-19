"""AG4 — tool-by-tool live accuracy validation.

Each test:
  1. runs the PRODUCTION tool through the real provider path
     (DATA_BACKEND=odoo, via the `live_backend_env` fixture), then
  2. recomputes the expected figures INDEPENDENTLY from raw Odoo records
     (tests/live_odoo/reference.py — different aggregation code, and for
     balances a different authoritative source: posted receivable move
     lines), and
  3. compares values, counts, and empty states with currency tolerance 0.01.

Representative cases are DISCOVERED from the live database; a category with
no matching live records is reported as NOT REPRESENTED (pytest skip with
that exact wording) — never fabricated.

Committed output/evidence must stay sanitized: assertions reference
anonymized labels (customer #1 …), never asserting on literal live names.
"""

import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

import pytest  # noqa: E402

from tests.live_odoo import reference  # noqa: E402

TOL = 0.01


def _pick_customer(gateway, predicate, label: str) -> dict:
    """First live customer whose reference stats satisfy `predicate`;
    skip as NOT REPRESENTED when none exists."""
    for c in reference.customers(gateway):
        stats = reference.expected_open_invoice_stats(gateway, c["id"])
        if predicate(stats):
            return {**c, **stats}
    pytest.skip(f"NOT REPRESENTED in live database: {label}")


# ── 1. get_customer_balance ──────────────────────────────────────────────────

def test_customer_balance_matches_raw_invoices_and_receivable_ledger(odoo_live, live_backend_env):
    c = _pick_customer(odoo_live, lambda s: s["count"] > 0, "customer with open invoices")
    from src.tools.customer_tools import get_customer_balance
    tool = get_customer_balance(c["name"])
    assert "error" not in tool, "live customer must be found by the tool"

    assert abs(tool["total_balance"] - c["outstanding"]) <= TOL
    assert abs(tool["overdue_amount"] - c["overdue"]) <= TOL
    assert tool["unpaid_count"] == c["count"]

    # Cross-check against the accounting-authoritative receivable ledger.
    # A difference here is not automatically a tool bug (credit notes /
    # unreconciled entries live in the ledger but not in out_invoice rows) —
    # it is AG4 evidence to record either way.
    ledger = reference.receivable_balance_from_move_lines(odoo_live, c["id"])
    assert abs(tool["total_balance"] - ledger) <= TOL, (
        f"invoice-derived balance differs from posted receivable ledger by "
        f"{tool['total_balance'] - ledger:+.2f} — investigate credit notes / "
        f"unreconciled items (AG4 discrepancy register)"
    )


def test_customer_with_no_invoices_reports_zero_balance(odoo_live, live_backend_env):
    c = _pick_customer(odoo_live, lambda s: s["count"] == 0, "customer with no open invoices")
    from src.tools.customer_tools import get_customer_balance
    tool = get_customer_balance(c["name"])
    assert "error" not in tool
    assert abs(tool["total_balance"]) <= TOL
    assert tool["unpaid_count"] == 0


# ── 2. get_customer_summary ──────────────────────────────────────────────────

def test_customer_summary_totals_match_raw_moves(odoo_live, live_backend_env):
    c = _pick_customer(odoo_live, lambda s: s["count"] > 0, "customer with open invoices")
    from src.tools.customer_tools import get_customer_summary
    tool = get_customer_summary(c["name"])
    assert "error" not in tool

    raw = reference.raw_posted_customer_invoices(odoo_live, c["id"])
    assert tool["total_invoices"] == len(raw), "posted out_invoice count mismatch"
    assert abs(tool["total_billed"] - sum(i["amount_total"] or 0.0 for i in raw)) <= TOL
    assert abs(tool["outstanding_balance"] - c["outstanding"]) <= TOL


# ── 3. get_payment_history (answers AG4 open question Q1: state filter) ─────

def test_payment_history_totals_and_state_filtering(odoo_live, live_backend_env):
    cust = None
    for c in reference.customers(odoo_live):
        stats = reference.expected_payment_totals(odoo_live, c["id"])
        if stats["all_count"] > 0:
            cust, pay = c, stats
            break
    if cust is None:
        pytest.skip("NOT REPRESENTED in live database: customer with inbound payments")

    from src.tools.customer_tools import get_payment_history
    tool = get_payment_history(cust["name"])
    assert "error" not in tool

    matches_all = (tool["total_payments"] == pay["all_count"]
                   and abs(tool["total_paid"] - pay["all_total"]) <= TOL)
    matches_posted = (tool["total_payments"] == pay["posted_count"]
                      and abs(tool["total_paid"] - pay["posted_total"]) <= TOL)
    assert matches_all or matches_posted, (
        f"tool reports {tool['total_payments']}/{tool['total_paid']:.2f}; raw all="
        f"{pay['all_count']}/{pay['all_total']:.2f}, posted-only="
        f"{pay['posted_count']}/{pay['posted_total']:.2f}"
    )
    if matches_all and not matches_posted:
        pytest.fail(
            "AG4-Q1 CONFIRMED AS DISCREPANCY: get_payment_history includes "
            "non-posted (draft/cancelled) payments — provider domain lacks a "
            "state filter. Record in the discrepancy register and fix per Phase 7."
        )


# ── 4. get_top_debtors ───────────────────────────────────────────────────────

def test_top_debtors_ranking_matches_raw_aggregation(odoo_live, live_backend_env):
    expected = reference.expected_top_debtors(odoo_live, limit=10)
    if not expected:
        pytest.skip("NOT REPRESENTED in live database: any customer with outstanding balance")
    from src.tools.customer_tools import get_top_debtors
    tool = get_top_debtors(limit=10)
    got = [(d["customer_name"], d["outstanding_balance"]) for d in tool["debtors"]]
    assert len(got) == len(expected)
    for i, ((en, ev), (gn, gv)) in enumerate(zip(expected, got), 1):
        assert gn == en, f"rank {i}: expected customer #{i} to match raw ranking"
        assert abs(gv - ev) <= TOL, f"rank {i}: amount differs by {gv - ev:+.2f}"


# ── 5. get_customer_statement ────────────────────────────────────────────────

def test_customer_statement_reconciles_against_raw_totals(odoo_live, live_backend_env):
    c = _pick_customer(odoo_live, lambda s: s["count"] > 0, "customer with open invoices")
    from src.tools.customer_tools import get_customer_statement
    tool = get_customer_statement(c["name"])
    assert "error" not in tool
    raw = reference.raw_posted_customer_invoices(odoo_live, c["id"])
    assert tool["invoice_count"] == len(raw)
    assert abs(tool["total_invoiced"] - sum(i["amount_total"] or 0.0 for i in raw)) <= TOL
    assert abs(tool["outstanding_balance"] - c["outstanding"]) <= TOL


# ── 6/7. get_unpaid_invoices / get_overdue_invoices ─────────────────────────

def test_unpaid_invoices_all_customers_matches_raw(odoo_live, live_backend_env):
    from src.tools.invoice_tools import get_unpaid_invoices
    from datetime import date
    today = date.today().isoformat()
    raw_open = [i for i in reference.raw_posted_customer_invoices(odoo_live)
                if reference.invoice_status(i, today) != "paid"]
    tool = get_unpaid_invoices()
    assert tool["count"] == len(raw_open)
    assert abs(tool["total_amount"] - sum(i["amount_residual"] or 0.0 for i in raw_open)) <= TOL


def test_overdue_invoices_matches_raw(odoo_live, live_backend_env):
    from src.tools.invoice_tools import get_overdue_invoices
    expected = reference.expected_overdue_totals(odoo_live)
    tool = get_overdue_invoices()
    assert tool["count"] == expected["count"]
    assert abs(tool["total_amount"] - expected["total"]) <= TOL
    assert tool["customers_affected"] == expected["customers_affected"]


# ── 8/9. get_top_selling_products / get_sales_summary ───────────────────────

def test_sales_summary_all_time_matches_raw_lines(odoo_live, live_backend_env):
    from src.tools.sales_tools import get_sales_summary
    expected = reference.expected_sales_totals(odoo_live)
    tool = get_sales_summary()
    assert tool["total_transactions"] == expected["transactions"]
    assert abs(tool["total_revenue"] - expected["revenue"]) <= TOL


@pytest.mark.parametrize("period", [
    "today", "yesterday", "this week", "last week", "this month", "last month",
    "this quarter", "last quarter", "this year", "year to date",
])
def test_sales_summary_date_boundaries(odoo_live, live_backend_env, period):
    from src.tools.sales_tools import get_sales_summary
    from src.utils.date_filters import parse_date_range
    start, end = parse_date_range(period)
    assert start and end
    expected = reference.expected_sales_totals(odoo_live, start, end)
    tool = get_sales_summary(period=period)
    assert tool["total_transactions"] == expected["transactions"], period
    assert abs(tool["total_revenue"] - expected["revenue"]) <= TOL, period


def test_top_selling_products_matches_raw_ranking(odoo_live, live_backend_env):
    from src.tools.sales_tools import get_top_selling_products
    revenue = reference.expected_product_revenue(odoo_live)
    if not revenue:
        pytest.skip("NOT REPRESENTED in live database: any confirmed sale lines")
    expected = sorted(revenue.items(), key=lambda kv: kv[1], reverse=True)[:5]
    tool = get_top_selling_products(limit=5)
    got = [(p["product_name"], p["total_revenue"]) for p in tool["products"]]
    assert len(got) == len(expected)
    for i, ((en, ev), (gn, gv)) in enumerate(zip(expected, got), 1):
        assert abs(gv - ev) <= TOL, f"rank {i}: revenue differs by {gv - ev:+.2f}"


# ── 10-14. composed tools: dashboard, collections, insights, alerts ─────────
# These compose the already-validated primitives; live validation checks the
# composition's totals against the same independent references.

def test_dashboard_summary_composition(odoo_live, live_backend_env):
    from src.tools.dashboard_tools import get_dashboard_summary
    tool = get_dashboard_summary()
    overdue = reference.expected_overdue_totals(odoo_live)
    sales = reference.expected_sales_totals(odoo_live)
    assert abs(tool["total_overdue"] - overdue["total"]) <= TOL
    assert tool["overdue_invoice_count"] == overdue["count"]
    assert abs(tool["total_revenue"] - sales["revenue"]) <= TOL
    debtors = reference.expected_top_debtors(odoo_live, limit=1)
    if debtors:
        assert abs(tool["top_debtor"]["outstanding_balance"] - debtors[0][1]) <= TOL


def test_collection_priorities_cover_exactly_the_overdue_customers(odoo_live, live_backend_env):
    from src.tools.collections_tools import get_collection_priorities
    expected = reference.expected_overdue_totals(odoo_live)
    tool = get_collection_priorities()
    assert tool["customer_count"] == expected["customers_affected"]
    assert abs(tool["total_overdue"] - expected["total"]) <= TOL


def test_customer_insights_financials_match_references(odoo_live, live_backend_env):
    c = _pick_customer(odoo_live, lambda s: s["count"] > 0, "customer with open invoices")
    from src.tools.customer_insights_tools import get_customer_insights
    tool = get_customer_insights(c["name"])
    assert "error" not in tool
    assert abs(tool["outstanding_balance"] - c["outstanding"]) <= TOL
    assert abs(tool["overdue_amount"] - c["overdue"]) <= TOL
    raw = reference.raw_posted_customer_invoices(odoo_live, c["id"])
    assert tool["total_invoices"] == len(raw)


def test_product_insights_revenue_matches_raw(odoo_live, live_backend_env):
    revenue = reference.expected_product_revenue(odoo_live)
    if not revenue:
        pytest.skip("NOT REPRESENTED in live database: any confirmed sale lines")
    name, expected_rev = max(revenue.items(), key=lambda kv: kv[1])
    from src.tools.product_insights_tools import get_product_insights
    tool = get_product_insights(name)
    assert tool.get("mode") in ("exact", "aggregated")
    if tool["mode"] == "exact":
        assert abs(tool["revenue"] - expected_rev) <= TOL
    else:
        combined = sum(v for k, v in revenue.items() if name.upper() in k.upper() or k.upper() in name.upper())
        assert tool["revenue"] >= expected_rev - TOL
        assert abs(tool["revenue"] - combined) <= max(TOL, 0.01 * combined)


def test_business_alerts_totals_are_consistent_with_references(odoo_live, live_backend_env):
    from src.tools.business_alerts_tools import get_business_alerts
    tool = get_business_alerts(limit=50)
    # Structural + cross-total checks (alert composition is heuristic; the
    # financial figures inside must still come from validated primitives).
    assert tool["total_alerts"] >= 0
    overdue = reference.expected_overdue_totals(odoo_live)
    overdue_alerts = [a for a in tool["alerts"] if a["alert_type"] == "Overdue Customer"]
    assert len(overdue_alerts) <= max(overdue["customers_affected"], 0)


# ── Credit notes / refunds: documented-contract check ───────────────────────

def test_credit_note_handling_matches_documented_contract(odoo_live, live_backend_env):
    """Documented contract (docs/AG4_LIVE_ODOO_VALIDATION.md §4): tools read
    move_type='out_invoice' only — credit notes (out_refund) are EXCLUDED from
    invoice counts and invoice-derived balances. This test makes that visible
    against live data: if credit notes exist, the receivable-ledger
    cross-check in test_customer_balance… is the place a real mismatch would
    surface; here we record representation."""
    notes = reference.raw_credit_notes(odoo_live)
    if not notes:
        pytest.skip("NOT REPRESENTED in live database: posted credit notes")
    # Presence recorded; the balance cross-check test carries the assertion.
    assert all((n["amount_total"] or 0.0) >= 0 for n in notes)
