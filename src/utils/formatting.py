# Single source of truth for the display currency. The data layer
# (mock_data / provider) tags customers with this same code so data and
# presentation can never disagree. Single-currency assumption — validating
# against real per-invoice Odoo currencies is AG4 scope
# (docs/AI_AGENT_TOOL_CONTRACTS.md §6).
CURRENCY = "QAR"

# Detail tables are capped so a live-Odoo result with hundreds of invoices or
# payments cannot flood the chat/API response. Same cap the customer-statement
# formatter has always used. Totals are always computed from the full dataset.
TABLE_MAX_ROWS = 50


def fmt_currency(amount: float) -> str:
    return f"{CURRENCY} {amount:,.2f}"


def fmt_date(date_str: str) -> str:
    from datetime import date as dt
    try:
        d = dt.fromisoformat(date_str)
        return d.strftime("%d %b %Y")
    except Exception:
        return date_str


def days_overdue(due_date_str: str) -> int:
    from datetime import date
    due = date.fromisoformat(due_date_str)
    delta = date.today() - due
    return max(delta.days, 0)


def _truncation_note(shown: int, total: int, noun: str) -> list[str]:
    """A consistent '_Showing X of Y noun(s)._' line, or nothing if not truncated."""
    if total > shown:
        return [f"_Showing {shown} of {total} {noun}(s)._", ""]
    return []


def fmt_invoice_table(invoices: list[dict]) -> str:
    if not invoices:
        return "_No invoices found._"

    shown = invoices[:TABLE_MAX_ROWS]
    header = "| Invoice # | Description | Amount | Outstanding | Status | Due Date |"
    separator = "|-----------|-------------|--------|-------------|--------|----------|"
    rows = []
    for inv in shown:
        status_label = inv["status"].upper()
        if inv["status"] == "overdue":
            days = days_overdue(inv["due_date"])
            status_label = f"OVERDUE ({days}d)"
        # Outstanding differs from Amount whenever a partial payment exists
        # (Odoo mode: paid_amount = amount_total - amount_residual); the
        # summary totals sum outstanding, so the column must show it too.
        outstanding = inv["amount"] - inv["paid_amount"]
        due = fmt_date(inv["due_date"]) if inv["due_date"] else "N/A"
        description = inv["description"] or "-"
        rows.append(
            f"| {inv['id']} | {description} | {fmt_currency(inv['amount'])} "
            f"| {fmt_currency(outstanding)} | {status_label} | {due} |"
        )
    table = "\n".join([header, separator] + rows)
    note = _truncation_note(len(shown), len(invoices), "invoice")
    return "\n".join(note + [table]) if note else table


def fmt_payment_table(payments: list[dict]) -> str:
    if not payments:
        return "_No payment records found._"

    shown = payments[:TABLE_MAX_ROWS]
    header = "| Payment ID | Amount | Date | Method | Reference |"
    separator = "|------------|--------|------|--------|-----------|"
    rows = []
    for p in shown:
        pay_date = fmt_date(p["date"]) if p["date"] else "N/A"
        method = p["method"] or "-"
        reference = p["reference"] or "-"
        rows.append(
            f"| {p['id']} | {fmt_currency(p['amount'])} | {pay_date} "
            f"| {method} | {reference} |"
        )
    table = "\n".join([header, separator] + rows)
    note = _truncation_note(len(shown), len(payments), "payment")
    return "\n".join(note + [table]) if note else table


def fmt_product_table(products: list[dict]) -> str:
    if not products:
        return "_No product data found._"

    header = "| Rank | Product | Category | Revenue | Units Sold |"
    separator = "|------|---------|----------|---------|------------|"
    rows = []
    for i, p in enumerate(products, 1):
        rows.append(
            f"| {i} | {p['product_name']} | {p['category']} "
            f"| {fmt_currency(p['total_revenue'])} | {p['total_qty']:,} |"
        )
    return "\n".join([header, separator] + rows)


def fmt_status_badge(status: str) -> str:
    badges = {
        "paid": "✅ PAID",
        "unpaid": "🔵 UNPAID",
        "overdue": "🔴 OVERDUE",
    }
    return badges.get(status, status.upper())
