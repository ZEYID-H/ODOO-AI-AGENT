"""Collections assistant — prioritizes customers for payment follow-up.

Reuses existing logic only: get_overdue_invoices() for per-customer overdue data
and days_overdue() for ageing. Outstanding balances are looked up once from
get_top_debtors(). No overdue calculations are duplicated.
"""

from src.utils.formatting import fmt_currency, fmt_date, days_overdue
from src.tools.invoice_tools import get_overdue_invoices
from src.tools.customer_tools import get_top_debtors

_ACTIONS = {
    "Critical": "Immediate call / escalate",
    "High": "Call this week",
    "Medium": "Send reminder",
    "Low": "Monitor",
}


def _priority_level(days: int, total_overdue: float) -> str:
    if days >= 30 or total_overdue >= 20000:
        return "Critical"
    if days >= 14 or total_overdue >= 5000:
        return "High"
    if days >= 1 or total_overdue > 0:
        return "Medium"
    return "Low"


def get_collection_priorities(limit: int | None = None) -> dict:
    overdue = get_overdue_invoices()

    # Outstanding balance per customer — one reuse of get_top_debtors (all debtors).
    debtor_balance = {
        d["customer_name"]: d["outstanding_balance"]
        for d in get_top_debtors(limit=10_000)["debtors"]
    }

    priorities = []
    for c in overdue["by_customer"]:
        days = days_overdue(c["oldest_due"])
        total_overdue = c["total_overdue"]
        invoice_count = c["invoice_count"]
        score = total_overdue * (1 + days / 30) + invoice_count * 100
        level = _priority_level(days, total_overdue)
        priorities.append({
            "customer_name": c["customer_name"],
            "outstanding_balance": debtor_balance.get(c["customer_name"], total_overdue),
            "overdue_amount": total_overdue,
            "overdue_invoice_count": invoice_count,
            "oldest_due_date": c["oldest_due"],
            "days_overdue": days,
            "score": round(score, 2),
            "priority": level,
            "recommended_action": _ACTIONS[level],
        })

    priorities.sort(key=lambda x: x["score"], reverse=True)
    total_count = len(priorities)
    if limit:
        priorities = priorities[:limit]

    return {
        "priorities": priorities,
        "customer_count": total_count,
        "total_overdue": overdue["total_amount"],
    }


def format_collection_priorities(data: dict) -> str:
    rows = data["priorities"]
    lines = [
        "## Collection Priorities",
        "",
        f"**{data['customer_count']}** customer(s) with overdue balances | "
        f"**Total Overdue: {fmt_currency(data['total_overdue'])}**",
        "",
        "| Rank | Customer | Outstanding Balance | Overdue Amount | Overdue Invoices "
        "| Oldest Due Date | Days Overdue | Priority | Recommended Action |",
        "|------|----------|---------------------|----------------|------------------"
        "|-----------------|--------------|----------|--------------------|",
    ]
    for i, r in enumerate(rows, 1):
        lines.append(
            f"| {i} | {r['customer_name']} | {fmt_currency(r['outstanding_balance'])} "
            f"| {fmt_currency(r['overdue_amount'])} | {r['overdue_invoice_count']} "
            f"| {fmt_date(r['oldest_due_date'])} | {r['days_overdue']} "
            f"| {r['priority']} | {r['recommended_action']} |"
        )
    if not rows:
        lines.append("\n_No overdue accounts — nothing to follow up._")
    return "\n".join(lines)
