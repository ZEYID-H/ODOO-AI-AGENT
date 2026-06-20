from src.data import provider
from src.utils.formatting import fmt_currency, fmt_date, fmt_invoice_table, fmt_payment_table


def _find_customer(customer_name: str) -> dict | None:
    name_upper = customer_name.upper().strip()
    for c in provider.get_customers():
        if c["name"].upper() == name_upper:
            return c
    return None


def get_customer_balance(customer_name: str) -> dict:
    customer = _find_customer(customer_name)
    if not customer:
        return {"error": f"Customer '{customer_name}' not found."}

    open_invoices = [
        inv for inv in provider.get_invoices()
        if inv["customer_name"].upper() == customer_name.upper()
        and inv["status"] in ("unpaid", "overdue")
    ]

    total_balance = sum(inv["amount"] - inv["paid_amount"] for inv in open_invoices)
    overdue_amount = sum(
        inv["amount"] - inv["paid_amount"]
        for inv in open_invoices if inv["status"] == "overdue"
    )
    unpaid_count = len(open_invoices)

    oldest_due = None
    if open_invoices:
        oldest_due = min(inv["due_date"] for inv in open_invoices)

    return {
        "customer_name": customer["name"],
        "total_balance": total_balance,
        "overdue_amount": overdue_amount,
        "unpaid_count": unpaid_count,
        "oldest_due_date": oldest_due,
        "credit_limit": customer["credit_limit"],
        "credit_used_pct": round((total_balance / customer["credit_limit"]) * 100, 1) if customer["credit_limit"] else 0,
        "open_invoices": open_invoices,
    }


def get_customer_summary(customer_name: str) -> dict:
    customer = _find_customer(customer_name)
    if not customer:
        return {"error": f"Customer '{customer_name}' not found."}

    all_invoices = [
        inv for inv in provider.get_invoices()
        if inv["customer_name"].upper() == customer_name.upper()
    ]
    payments = [
        p for p in provider.get_payments()
        if p["customer_name"].upper() == customer_name.upper()
    ]

    total_billed = sum(inv["amount"] for inv in all_invoices)
    total_paid = sum(p["amount"] for p in payments)
    balance_data = get_customer_balance(customer_name)

    return {
        "customer": customer,
        "total_invoices": len(all_invoices),
        "total_billed": total_billed,
        "total_paid": total_paid,
        "outstanding_balance": balance_data.get("total_balance", 0),
        "overdue_amount": balance_data.get("overdue_amount", 0),
        "payments": payments,
        "invoices": all_invoices,
    }


def get_payment_history(customer_name: str) -> dict:
    customer = _find_customer(customer_name)
    if not customer:
        return {"error": f"Customer '{customer_name}' not found."}

    payments = [
        p for p in provider.get_payments()
        if p["customer_name"].upper() == customer_name.upper()
    ]
    payments_sorted = sorted(payments, key=lambda p: p["date"], reverse=True)
    total_paid = sum(p["amount"] for p in payments_sorted)

    return {
        "customer_name": customer["name"],
        "payments": payments_sorted,
        "total_payments": len(payments_sorted),
        "total_paid": total_paid,
    }


def get_top_debtors(limit: int = 10) -> dict:
    open_invoices = [
        inv for inv in provider.get_invoices()
        if inv["status"] in ("unpaid", "overdue")
    ]

    by_customer: dict[str, dict] = {}
    for inv in open_invoices:
        name = inv["customer_name"]
        bucket = by_customer.setdefault(name, {
            "customer_name": name,
            "outstanding_balance": 0.0,
            "overdue_amount": 0.0,
            "open_invoice_count": 0,
            "oldest_due_date": None,
        })
        outstanding = inv["amount"] - inv["paid_amount"]
        bucket["outstanding_balance"] += outstanding
        if inv["status"] == "overdue":
            bucket["overdue_amount"] += outstanding
        bucket["open_invoice_count"] += 1
        due = inv["due_date"]
        if due and (bucket["oldest_due_date"] is None or due < bucket["oldest_due_date"]):
            bucket["oldest_due_date"] = due

    debtors = sorted(
        by_customer.values(), key=lambda x: x["outstanding_balance"], reverse=True
    )

    return {
        "debtors": debtors[:limit],
        "customer_count": len(debtors),
        "total_outstanding": sum(d["outstanding_balance"] for d in debtors),
        "limit": limit,
    }


# ── Response Formatters ──────────────────────────────────────────────────────

def format_customer_balance(data: dict) -> str:
    if "error" in data:
        return f"**Error:** {data['error']}"

    lines = [
        f"## Account Balance: {data['customer_name']}",
        "",
        f"| Field | Value |",
        f"|-------|-------|",
        f"| **Outstanding Balance** | **{fmt_currency(data['total_balance'])}** |",
        f"| Overdue Amount | {fmt_currency(data['overdue_amount'])} |",
        f"| Open Invoices | {data['unpaid_count']} |",
        f"| Oldest Due Date | {fmt_date(data['oldest_due_date']) if data['oldest_due_date'] else 'N/A'} |",
        f"| Credit Limit | {fmt_currency(data['credit_limit'])} |",
        f"| Credit Utilization | {data['credit_used_pct']}% |",
    ]

    if data["overdue_amount"] > 0:
        lines.append("")
        lines.append(f"> **Warning:** This customer has {fmt_currency(data['overdue_amount'])} in overdue payments.")

    if data["open_invoices"]:
        lines.append("")
        lines.append("### Open Invoices")
        lines.append(fmt_invoice_table(data["open_invoices"]))

    return "\n".join(lines)


def format_customer_summary(data: dict) -> str:
    if "error" in data:
        return f"**Error:** {data['error']}"

    c = data["customer"]
    lines = [
        f"## Customer Summary: {c['name']}",
        "",
        f"**Contact:** {c['email']} | {c['phone']}",
        "",
        f"### Financial Overview",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| Total Billed | {fmt_currency(data['total_billed'])} |",
        f"| Total Paid | {fmt_currency(data['total_paid'])} |",
        f"| Outstanding Balance | **{fmt_currency(data['outstanding_balance'])}** |",
        f"| Overdue Amount | {fmt_currency(data['overdue_amount'])} |",
        f"| Total Invoices | {data['total_invoices']} |",
        f"| Total Payments | {len(data['payments'])} |",
        "",
        "### Invoice History",
        fmt_invoice_table(data["invoices"]),
        "",
        "### Payment History",
        fmt_payment_table(data["payments"]),
    ]
    return "\n".join(lines)


def format_payment_history(data: dict) -> str:
    if "error" in data:
        return f"**Error:** {data['error']}"

    lines = [
        f"## Payment History: {data['customer_name']}",
        "",
        f"**Total Payments:** {data['total_payments']} | "
        f"**Total Paid:** {fmt_currency(data['total_paid'])}",
        "",
        fmt_payment_table(data["payments"]),
    ]
    return "\n".join(lines)


def format_top_debtors(data: dict) -> str:
    if "error" in data:
        return f"**Error:** {data['error']}"

    debtors = data["debtors"]
    lines = [
        "## Top Debtors",
        "",
        f"**Customers with balance:** {data['customer_count']} | "
        f"**Total Outstanding:** {fmt_currency(data['total_outstanding'])}",
        "",
        "| Rank | Customer | Outstanding Balance | Overdue Amount | Open Invoices | Oldest Due Date |",
        "|------|----------|---------------------|----------------|---------------|-----------------|",
    ]
    for i, d in enumerate(debtors, 1):
        oldest = fmt_date(d["oldest_due_date"]) if d["oldest_due_date"] else "N/A"
        lines.append(
            f"| {i} | {d['customer_name']} | {fmt_currency(d['outstanding_balance'])} "
            f"| {fmt_currency(d['overdue_amount'])} | {d['open_invoice_count']} | {oldest} |"
        )
    if not debtors:
        lines.append("\n_No outstanding balances found._")

    return "\n".join(lines)
