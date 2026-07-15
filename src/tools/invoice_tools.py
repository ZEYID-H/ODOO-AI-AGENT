from src.data import provider
from src.utils.date_filters import filter_by_date, period_label
from src.utils.formatting import fmt_currency, fmt_date, fmt_invoice_table, days_overdue

# One customer-matching rule for the whole toolset (case-insensitive exact
# match, owned by customer_tools). Reused here so an unknown name fails the
# same way it does for balance/summary/statement instead of silently
# succeeding with zero rows.
from src.tools.customer_tools import _find_customer


def get_unpaid_invoices(customer_name: str | None = None, period: str | None = None) -> dict:
    # Whitespace-only == omitted (the schema documents "omit to list all
    # customers"); a NON-empty unknown name is an error, never a silent
    # zero-row result or an all-customers broadening.
    customer_name = customer_name.strip() if customer_name else None
    if customer_name:
        customer = _find_customer(customer_name)
        if not customer:
            return {"error": f"Customer '{customer_name}' not found."}
        customer_name = customer["name"]

    invoices = [
        inv for inv in provider.get_invoices()
        if inv["status"] in ("unpaid", "overdue")
    ]
    if customer_name:
        invoices = [
            inv for inv in invoices
            if inv["customer_name"].upper() == customer_name.upper()
        ]
    invoices = filter_by_date(invoices, period, "issue_date")

    invoices_sorted = sorted(invoices, key=lambda x: x["due_date"])
    total_amount = sum(inv["amount"] - inv["paid_amount"] for inv in invoices_sorted)

    return {
        "customer_name": customer_name,
        "invoices": invoices_sorted,
        "count": len(invoices_sorted),
        "total_amount": total_amount,
        "period_label": period_label(period),
    }


def get_overdue_invoices(period: str | None = None) -> dict:
    overdue = [inv for inv in provider.get_invoices() if inv["status"] == "overdue"]
    overdue = filter_by_date(overdue, period, "issue_date")
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
        "period_label": period_label(period),
    }


# ── Response Formatters ──────────────────────────────────────────────────────

def _scope_suffix(data: dict) -> str:
    label = data.get("period_label")
    return f" ({label})" if label else ""


def format_unpaid_invoices(data: dict) -> str:
    if "error" in data:
        return f"**Error:** {data['error']}"

    scope = f"**{data['customer_name']}**" if data["customer_name"] else "All Customers"
    header = f"## Unpaid Invoices – {scope}{_scope_suffix(data)}"

    if not data["invoices"]:
        return f"{header}\n\n_No unpaid invoices found._"

    lines = [
        header,
        "",
        f"**Count:** {data['count']} invoice(s) | **Total Outstanding:** {fmt_currency(data['total_amount'])}",
        "",
        fmt_invoice_table(data["invoices"]),
    ]
    return "\n".join(lines)


def format_overdue_invoices(data: dict) -> str:
    header = f"## Overdue Invoices – All Customers{_scope_suffix(data)}"

    if not data["invoices"]:
        return f"{header}\n\n_No overdue invoices found — all invoices are current._"

    lines = [
        header,
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
