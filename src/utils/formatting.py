def fmt_currency(amount: float) -> str:
    return f"QAR {amount:,.2f}"


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


def fmt_invoice_table(invoices: list[dict]) -> str:
    if not invoices:
        return "_No invoices found._"

    header = "| Invoice # | Description | Amount | Status | Due Date |"
    separator = "|-----------|-------------|--------|--------|----------|"
    rows = []
    for inv in invoices:
        status_label = inv["status"].upper()
        if inv["status"] == "overdue":
            days = days_overdue(inv["due_date"])
            status_label = f"OVERDUE ({days}d)"
        rows.append(
            f"| {inv['id']} | {inv['description']} | {fmt_currency(inv['amount'])} "
            f"| {status_label} | {fmt_date(inv['due_date'])} |"
        )
    return "\n".join([header, separator] + rows)


def fmt_payment_table(payments: list[dict]) -> str:
    if not payments:
        return "_No payment records found._"

    header = "| Payment ID | Amount | Date | Method | Reference |"
    separator = "|------------|--------|------|--------|-----------|"
    rows = []
    for p in payments:
        rows.append(
            f"| {p['id']} | {fmt_currency(p['amount'])} | {fmt_date(p['date'])} "
            f"| {p['method']} | {p['reference']} |"
        )
    return "\n".join([header, separator] + rows)


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
