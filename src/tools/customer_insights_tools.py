"""Customer-level business intelligence — additive, read-only.

Reuses get_customer_balance() (for validation + authoritative balance/overdue)
and existing provider data. No existing tool is modified.
"""

from datetime import date

from src.data import provider
from src.utils.formatting import fmt_currency, fmt_date
from src.tools.customer_tools import get_customer_balance

_HIGH_INACTIVITY_DAYS = 60
_MEDIUM_INACTIVITY_DAYS = 30


def _assess_risk(overdue_amount: float, outstanding_balance: float,
                 days_since_last: int | None) -> tuple[str, str]:
    """Heuristic risk level from overdue amount, outstanding balance, and recency."""
    days = days_since_last if days_since_last is not None else _HIGH_INACTIVITY_DAYS + 1

    if overdue_amount >= 20000 or outstanding_balance >= 30000 or days > _HIGH_INACTIVITY_DAYS:
        return "High", "Immediate follow-up / credit review"
    if overdue_amount > 0 or outstanding_balance > 5000 or days > _MEDIUM_INACTIVITY_DAYS:
        return "Medium", "Monitor closely / send reminder"
    return "Low", "No action needed"


def get_customer_insights(customer_name: str) -> dict:
    balance = get_customer_balance(customer_name)
    if "error" in balance:
        return {"error": balance["error"]}
    name = balance["customer_name"]

    sales = [s for s in provider.get_sales() if s["customer_name"].upper() == name.upper()]
    invoices = [i for i in provider.get_invoices() if i["customer_name"].upper() == name.upper()]
    payments = [p for p in provider.get_payments() if p["customer_name"].upper() == name.upper()]

    lifetime_revenue = sum(s["total"] for s in sales)
    sale_line_count = len(sales)
    average_order_value = lifetime_revenue / sale_line_count if sale_line_count else 0.0

    dates = sorted(s["date"] for s in sales)
    first_purchase_date = dates[0] if dates else None
    last_purchase_date = dates[-1] if dates else None
    days_since_last_purchase = (
        (date.today() - date.fromisoformat(last_purchase_date)).days
        if last_purchase_date else None
    )

    active_months = len({d[:7] for d in dates})
    purchase_frequency = round(sale_line_count / active_months, 2) if active_months else 0.0

    risk_level, recommended_action = _assess_risk(
        balance["overdue_amount"], balance["total_balance"], days_since_last_purchase
    )

    return {
        "customer_name": name,
        "lifetime_revenue": lifetime_revenue,
        "total_invoices": len(invoices),
        "total_payments": len(payments),
        "outstanding_balance": balance["total_balance"],
        "overdue_amount": balance["overdue_amount"],
        "average_order_value": average_order_value,
        "first_purchase_date": first_purchase_date,
        "last_purchase_date": last_purchase_date,
        "days_since_last_purchase": days_since_last_purchase,
        "purchase_frequency": purchase_frequency,
        "risk_level": risk_level,
        "recommended_action": recommended_action,
    }


def format_customer_insights(data: dict) -> str:
    if "error" in data:
        return f"**Error:** {data['error']}"

    first = fmt_date(data["first_purchase_date"]) if data["first_purchase_date"] else "N/A"
    last = fmt_date(data["last_purchase_date"]) if data["last_purchase_date"] else "N/A"
    days_since = (
        data["days_since_last_purchase"] if data["days_since_last_purchase"] is not None else "N/A"
    )

    lines = [
        f"## Customer Insights: {data['customer_name']}",
        "",
        "| Metric | Value |",
        "|--------|-------|",
        f"| Lifetime Revenue | **{fmt_currency(data['lifetime_revenue'])}** |",
        f"| Total Invoices | {data['total_invoices']} |",
        f"| Total Payments | {data['total_payments']} |",
        f"| Outstanding Balance | {fmt_currency(data['outstanding_balance'])} |",
        f"| Overdue Amount | {fmt_currency(data['overdue_amount'])} |",
        f"| Average Order Value | {fmt_currency(data['average_order_value'])} |",
        f"| First Purchase Date | {first} |",
        f"| Last Purchase Date | {last} |",
        f"| Days Since Last Purchase | {days_since} |",
        f"| Purchase Frequency | {data['purchase_frequency']} sale(s)/active month |",
        f"| **Risk Level** | **{data['risk_level']}** |",
        f"| Recommended Action | {data['recommended_action']} |",
    ]
    return "\n".join(lines)
