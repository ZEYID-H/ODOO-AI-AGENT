"""AG4 independent reference calculations.

THE POINT OF THIS MODULE: none of these functions import or reuse
src/data/provider.py's normalization or src/tools/* aggregation. They pull
RAW Odoo records through the read-only gateway (shared transport is allowed;
shared aggregation is not) and recompute every business figure from first
principles — several deliberately from a DIFFERENT authoritative source than
the production code uses:

  - Customer outstanding balance: recomputed from posted receivable
    move lines (`account.move.line`, account_type='asset_receivable',
    sum of amount_residual) — the accounting-authoritative source — while
    the production tools derive it from invoice-level fields on
    `account.move`. Agreement between the two is real evidence; both being
    wrong the same way is structurally unlikely.
  - Invoice counts/status: recomputed from raw account.move rows with this
    module's own status derivation.
  - Sales/product figures: re-aggregated from raw sale.order.line rows.

All amounts are returned unrounded; comparisons apply a 0.01 tolerance
(currency rounding) at the test layer.
"""

from datetime import date

_PAGE = 500


def _all(gateway, model, domain, fields):
    rows, offset = [], 0
    while True:
        page = gateway.search_read(model, domain, fields, limit=_PAGE, offset=offset)
        rows.extend(page)
        if len(page) < _PAGE:
            break
        offset += _PAGE
    return rows


# ── Customers ────────────────────────────────────────────────────────────────

def customers(gateway) -> list[dict]:
    return _all(gateway, "res.partner", [("customer_rank", ">", 0)], ["id", "name"])


def receivable_balance_from_move_lines(gateway, partner_id: int) -> float:
    """Authoritative outstanding balance: sum of residuals on POSTED
    receivable journal items. Independent of account.move invoice fields."""
    lines = _all(
        gateway, "account.move.line",
        [("partner_id", "=", partner_id),
         ("account_id.account_type", "=", "asset_receivable"),
         ("parent_state", "=", "posted")],
        ["amount_residual"],
    )
    return sum(l["amount_residual"] or 0.0 for l in lines)


def raw_posted_customer_invoices(gateway, partner_id: int | None = None) -> list[dict]:
    domain = [("move_type", "=", "out_invoice"), ("state", "=", "posted")]
    if partner_id is not None:
        domain.append(("partner_id", "=", partner_id))
    return _all(gateway, "account.move", domain,
                ["partner_id", "amount_total", "amount_residual",
                 "invoice_date", "invoice_date_due", "payment_state"])


def raw_credit_notes(gateway, partner_id: int | None = None) -> list[dict]:
    domain = [("move_type", "=", "out_refund"), ("state", "=", "posted")]
    if partner_id is not None:
        domain.append(("partner_id", "=", partner_id))
    return _all(gateway, "account.move", domain,
                ["partner_id", "amount_total", "amount_residual"])


def invoice_status(inv: dict, today: str) -> str:
    """This module's OWN status derivation (mirrors the documented contract,
    implemented independently of provider.py)."""
    if inv["payment_state"] in ("paid", "in_payment", "reversed"):
        return "paid"
    due = inv["invoice_date_due"] or ""
    if (inv["amount_residual"] or 0.0) > 0 and due and str(due) < today:
        return "overdue"
    return "unpaid"


def expected_open_invoice_stats(gateway, partner_id: int) -> dict:
    """count / outstanding / overdue amounts for one customer, from raw moves."""
    today = date.today().isoformat()
    open_inv = [i for i in raw_posted_customer_invoices(gateway, partner_id)
                if invoice_status(i, today) in ("unpaid", "overdue")]
    return {
        "count": len(open_inv),
        "outstanding": sum(i["amount_residual"] or 0.0 for i in open_inv),
        "overdue": sum(i["amount_residual"] or 0.0 for i in open_inv
                       if invoice_status(i, today) == "overdue"),
    }


def expected_overdue_totals(gateway) -> dict:
    """All-customer overdue rollup from raw moves."""
    today = date.today().isoformat()
    overdue = [i for i in raw_posted_customer_invoices(gateway)
               if invoice_status(i, today) == "overdue"]
    partners = {i["partner_id"][0] for i in overdue if i.get("partner_id")}
    return {
        "count": len(overdue),
        "total": sum(i["amount_residual"] or 0.0 for i in overdue),
        "customers_affected": len(partners),
    }


def expected_top_debtors(gateway, limit: int = 10) -> list[tuple[str, float]]:
    """(customer_name, outstanding) ranked desc, from raw open invoices."""
    today = date.today().isoformat()
    by_partner: dict[str, float] = {}
    for i in raw_posted_customer_invoices(gateway):
        if invoice_status(i, today) == "paid" or not i.get("partner_id"):
            continue
        name = i["partner_id"][1]
        by_partner[name] = by_partner.get(name, 0.0) + (i["amount_residual"] or 0.0)
    ranked = sorted(by_partner.items(), key=lambda kv: kv[1], reverse=True)
    return ranked[:limit]


# ── Payments ─────────────────────────────────────────────────────────────────

def raw_customer_payments(gateway, partner_id: int) -> list[dict]:
    return _all(gateway, "account.payment",
                [("partner_type", "=", "customer"), ("payment_type", "=", "inbound"),
                 ("partner_id", "=", partner_id)],
                ["amount", "date", "state"])


def expected_payment_totals(gateway, partner_id: int) -> dict:
    """Two views on purpose: ALL inbound payments vs POSTED-only. The
    production provider currently applies NO state filter — comparing both
    against the tool output answers AG4 open question Q1 (does the tool
    include draft/cancelled payments?)."""
    rows = raw_customer_payments(gateway, partner_id)
    posted = [r for r in rows if r.get("state") in ("posted", "paid", "in_process")]
    return {
        "all_count": len(rows),
        "all_total": sum(r["amount"] or 0.0 for r in rows),
        "posted_count": len(posted),
        "posted_total": sum(r["amount"] or 0.0 for r in posted),
    }


# ── Sales ────────────────────────────────────────────────────────────────────

def raw_confirmed_sale_lines(gateway) -> list[dict]:
    return _all(gateway, "sale.order.line",
                [("order_id.state", "in", ["sale", "done"])],
                ["product_id", "product_uom_qty", "price_subtotal", "order_id"])


def expected_sales_totals(gateway, start: str | None = None, end: str | None = None) -> dict:
    """Revenue/transaction totals re-aggregated from raw sale lines, with
    order dates joined independently."""
    lines = raw_confirmed_sale_lines(gateway)
    order_ids = list({l["order_id"][0] for l in lines if l.get("order_id")})
    orders = _all(gateway, "sale.order", [("id", "in", order_ids)], ["date_order"]) if order_ids else []
    order_date = {o["id"]: (o.get("date_order") or "")[:10] for o in orders}

    def in_range(l):
        d = order_date.get(l["order_id"][0] if l.get("order_id") else None, "")
        if not d:
            return not (start or end)
        if start and d < start:
            return False
        if end and d > end:
            return False
        return True

    selected = [l for l in lines if in_range(l)]
    return {
        "revenue": sum(l["price_subtotal"] or 0.0 for l in selected),
        "transactions": len(selected),
    }


def expected_product_revenue(gateway) -> dict[str, float]:
    """product display name -> revenue, all-time, from raw lines."""
    out: dict[str, float] = {}
    for l in raw_confirmed_sale_lines(gateway):
        if not l.get("product_id"):
            continue
        name = l["product_id"][1]
        out[name] = out.get(name, 0.0) + (l["price_subtotal"] or 0.0)
    return out
