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


def get_customer_statement(customer_name: str) -> dict:
    customer = _find_customer(customer_name)
    if not customer:
        return {"error": f"Customer '{customer_name}' not found."}
    name = customer["name"]

    invoices = [
        i for i in provider.get_invoices()
        if i["customer_name"].upper() == name.upper()
    ]
    payments = [
        p for p in provider.get_payments()
        if p["customer_name"].upper() == name.upper()
    ]

    rows = []
    for inv in invoices:
        rows.append({
            "date": inv["issue_date"],
            "type": "Invoice",
            "reference": inv["id"],
            "debit": inv["amount"],
            "credit": 0.0,
        })
    for p in payments:
        rows.append({
            "date": p["date"],
            "type": "Payment",
            "reference": p["reference"] or p["id"],
            "debit": 0.0,
            "credit": p["amount"],
        })

    # Chronological; invoices before payments on the same day.
    rows.sort(key=lambda r: (r["date"] or "", 0 if r["type"] == "Invoice" else 1))

    running = 0.0
    for r in rows:
        running += r["debit"] - r["credit"]
        r["balance"] = running

    # Totals are computed from the FULL timeline, not from any display slice.
    total_invoiced = sum(r["debit"] for r in rows)
    total_paid = sum(r["credit"] for r in rows)
    activity_balance = total_invoiced - total_paid

    outstanding_balance = get_customer_balance(name).get("total_balance", 0.0)

    return {
        "customer_name": name,
        "rows": rows,
        "total_invoiced": total_invoiced,
        "total_paid": total_paid,
        "outstanding_balance": outstanding_balance,
        "activity_balance": activity_balance,
        "invoice_count": len(invoices),
        "payment_count": len(payments),
        "reconciles": abs(activity_balance - outstanding_balance) < 0.01,
        "difference": round(outstanding_balance - activity_balance, 2),
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


def format_customer_statement(data: dict) -> str:
    if "error" in data:
        return f"**Error:** {data['error']}"

    rows = data["rows"]
    total_tx = len(rows)
    max_rows = 50

    lines = [
        f"## Customer Statement: {data['customer_name']}",
        "",
        "| Metric | Value |",
        "|--------|-------|",
        f"| Total Invoiced | {fmt_currency(data['total_invoiced'])} |",
        f"| Total Paid | {fmt_currency(data['total_paid'])} |",
        f"| **Outstanding Balance** | **{fmt_currency(data['outstanding_balance'])}** |",
        f"| Invoices | {data['invoice_count']} |",
        f"| Payments | {data['payment_count']} |",
        "",
    ]

    display_rows = rows[-max_rows:] if total_tx > max_rows else rows
    if total_tx > max_rows:
        lines.append(f"_Showing latest {max_rows} of {total_tx} transactions._")
        lines.append("")

    lines += [
        "| Date | Type | Ref | Debit | Credit | Balance |",
        "|------|------|-----|-------|--------|---------|",
    ]
    for r in display_rows:
        debit = fmt_currency(r["debit"]) if r["debit"] else "-"
        credit = fmt_currency(r["credit"]) if r["credit"] else "-"
        date = fmt_date(r["date"]) if r["date"] else "N/A"
        lines.append(
            f"| {date} | {r['type']} | {r['reference']} | {debit} | {credit} "
            f"| {fmt_currency(r['balance'])} |"
        )

    if not rows:
        lines.append("\n_No transactions found for this customer._")

    lines.append("")
    if data["reconciles"]:
        lines.append(
            f"> Reconciled: activity balance matches open-item balance "
            f"({fmt_currency(data['outstanding_balance'])})."
        )
    else:
        lines.append(
            f"> **Note:** Activity balance {fmt_currency(data['activity_balance'])} vs "
            f"open-item balance {fmt_currency(data['outstanding_balance'])} — difference "
            f"{fmt_currency(data['difference'])} (unreconciled / advance payments)."
        )

    return "\n".join(lines)
