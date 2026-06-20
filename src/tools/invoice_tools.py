from src.data import provider
from src.utils.formatting import fmt_currency, fmt_date, fmt_invoice_table, days_overdue


def get_unpaid_invoices(customer_name: str | None = None) -> dict:
    invoices = [
        inv for inv in provider.get_invoices()
        if inv["status"] in ("unpaid", "overdue")
    ]
    if customer_name:
        invoices = [
            inv for inv in invoices
            if inv["customer_name"].upper() == customer_name.upper()
        ]

    invoices_sorted = sorted(invoices, key=lambda x: x["due_date"])
    total_amount = sum(inv["amount"] - inv["paid_amount"] for inv in invoices_sorted)

    return {
        "customer_name": customer_name,
        "invoices": invoices_sorted,
        "count": len(invoices_sorted),
        "total_amount": total_amount,
    }


def get_overdue_invoices() -> dict:
    overdue = [inv for inv in provider.get_invoices() if inv["status"] == "overdue"]
    overdue_sorted = sorted(overdue, key=lambda x: x["due_date"])
    total_amount = sum(inv["amount"] - inv["paid_amount"] for inv in overdue_sorted)

    # Group by customer
    by_customer: dict[str, list] = {}
    for inv in overdue_sorted:
        name = inv["customer_name"]
        by_customer.setdefault(name, []).append(inv)

    customer_totals = [
        {
            "customer_name": name,
            "invoice_count": len(invs),
            "total_overdue": sum(i["amount"] - i["paid_amount"] for i in invs),
            "oldest_due": min(i["due_date"] for i in invs),
        }
        for name, invs in by_customer.items()
    ]
    customer_totals.sort(key=lambda x: x["total_overdue"], reverse=True)

    return {
        "invoices": overdue_sorted,
        "count": len(overdue_sorted),
        "total_amount": total_amount,
        "customers_affected": len(by_customer),
        "by_customer": customer_totals,
    }


# ── Response Formatters ──────────────────────────────────────────────────────

def format_unpaid_invoices(data: dict) -> str:
    scope = f"**{data['customer_name']}**" if data["customer_name"] else "All Customers"
    header = f"## Unpaid Invoices – {scope}"

    lines = [
        header,
        "",
        f"**Count:** {data['count']} invoice(s) | **Total Outstanding:** {fmt_currency(data['total_amount'])}",
        "",
        fmt_invoice_table(data["invoices"]),
    ]
    if not data["invoices"]:
        lines.append("\n_No unpaid invoices found._")

    return "\n".join(lines)


def format_overdue_invoices(data: dict) -> str:
    lines = [
        "## Overdue Invoices – All Customers",
        "",
        f"**{data['count']}** overdue invoice(s) across **{data['customers_affected']}** customer(s) | "
        f"**Total Overdue: {fmt_currency(data['total_amount'])}**",
        "",
        "### By Customer",
        "| Customer | Invoices | Total Overdue | Oldest Due Date |",
        "|----------|----------|---------------|-----------------|",
    ]

    for ct in data["by_customer"]:
        d_overdue = days_overdue(ct["oldest_due"])
        lines.append(
            f"| {ct['customer_name']} | {ct['invoice_count']} "
            f"| {fmt_currency(ct['total_overdue'])} | {fmt_date(ct['oldest_due'])} ({d_overdue}d ago) |"
        )

    lines += ["", "### Invoice Detail", fmt_invoice_table(data["invoices"])]
    return "\n".join(lines)
