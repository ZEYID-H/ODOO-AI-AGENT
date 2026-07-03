"""Business alerts — proactive, read-only risk/opportunity dashboard.

Composes existing tools (get_collection_priorities, get_unpaid_invoices,
get_top_selling_products, get_sales_summary) exactly like the Module C
dashboard does. Does NOT import or call Module E/F tools: the "inactive
customer" category uses the same definitions as get_customer_insights
(lifetime revenue = sales-based, days since last purchase) but computes
them via a single local pass over provider.get_sales() instead of calling
get_customer_insights() once per customer — looping that per-customer over
~90 live customers would multiply Odoo round-trips ~90x, unlike every other
category here which reuses existing tools directly.
"""

from datetime import date

from src.data import provider
from src.utils.formatting import fmt_currency, fmt_date, days_overdue
from src.tools.collections_tools import get_collection_priorities
from src.tools.invoice_tools import get_unpaid_invoices
from src.tools.sales_tools import get_sales_summary, get_top_selling_products

_LARGE_INVOICE_THRESHOLD = 15000.0
_INACTIVITY_DAYS_THRESHOLD = 30
_INACTIVITY_HIGH_DAYS = 60
_MAX_INACTIVE_ALERTS = 5
_PRODUCT_CONCENTRATION_MEDIUM_PCT = 15.0
_PRODUCT_CONCENTRATION_HIGH_PCT = 30.0
_OPPORTUNITY_RECENT_DAYS = 7

_RISK_ORDER = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}


def _sales_activity_by_customer(sales: list[dict]) -> dict:
    """One pass over sales: {customer_name: {lifetime_revenue, last_purchase_date}}."""
    acc: dict = {}
    for s in sales:
        bucket = acc.setdefault(
            s["customer_name"], {"lifetime_revenue": 0.0, "last_purchase_date": None}
        )
        bucket["lifetime_revenue"] += s["total"]
        if bucket["last_purchase_date"] is None or s["date"] > bucket["last_purchase_date"]:
            bucket["last_purchase_date"] = s["date"]
    return acc


def _collection_alerts() -> list[dict]:
    data = get_collection_priorities()
    alerts = []
    for p in data["priorities"]:
        if p["priority"] not in ("Critical", "High"):
            continue
        alerts.append({
            "risk_level": p["priority"],
            "alert_type": "Overdue Customer",
            "title": f"{p['customer_name']} — {fmt_currency(p['overdue_amount'])} overdue ({p['days_overdue']}d)",
            "details": [
                f"Outstanding Balance: {fmt_currency(p['outstanding_balance'])}",
                f"Overdue Amount: {fmt_currency(p['overdue_amount'])}",
                f"Overdue Invoices: {p['overdue_invoice_count']}",
                f"Oldest Due Date: {fmt_date(p['oldest_due_date'])}",
            ],
            "recommended_action": p["recommended_action"],
            "_sort_key": p["score"],
        })
    return alerts


def _large_invoice_alerts() -> list[dict]:
    data = get_unpaid_invoices()
    alerts = []
    for inv in data["invoices"]:
        outstanding = inv["amount"] - inv["paid_amount"]
        if outstanding < _LARGE_INVOICE_THRESHOLD:
            continue
        if inv["status"] == "overdue":
            days = days_overdue(inv["due_date"])
            risk = "Critical" if days >= 30 else "High"
            status_note = f"Overdue by {days} day(s)"
            action = "Escalate to collections / confirm payment plan"
        else:
            days = None
            status_note = "Unpaid, not yet past due"
            risk = "Medium"
            action = "Monitor and follow up before the due date"
        alerts.append({
            "risk_level": risk,
            "alert_type": "Large Invoice",
            "title": f"Invoice {inv['id']} — {inv['customer_name']} — {fmt_currency(outstanding)}",
            "details": [
                f"Customer: {inv['customer_name']}",
                f"Amount Outstanding: {fmt_currency(outstanding)}",
                f"Due Date: {fmt_date(inv['due_date'])}",
                f"Status: {status_note}",
            ],
            "recommended_action": action,
            "_sort_key": outstanding,
        })
    return alerts


def _inactive_customer_alerts(activity_map: dict) -> list[dict]:
    candidates = []
    for name, act in activity_map.items():
        if act["lifetime_revenue"] <= 0 or not act["last_purchase_date"]:
            continue
        days = (date.today() - date.fromisoformat(act["last_purchase_date"])).days
        if days <= _INACTIVITY_DAYS_THRESHOLD:
            continue
        candidates.append((name, act, days))
    candidates.sort(key=lambda x: x[1]["lifetime_revenue"], reverse=True)

    alerts = []
    for name, act, days in candidates[:_MAX_INACTIVE_ALERTS]:
        risk = "High" if days >= _INACTIVITY_HIGH_DAYS else "Medium"
        alerts.append({
            "risk_level": risk,
            "alert_type": "Inactive Customer",
            "title": f"{name} — inactive {days}d (lifetime {fmt_currency(act['lifetime_revenue'])})",
            "details": [
                f"Lifetime Revenue: {fmt_currency(act['lifetime_revenue'])}",
                f"Last Purchase: {fmt_date(act['last_purchase_date'])}",
                f"Days Since Last Purchase: {days}",
            ],
            "recommended_action": "Re-engage: check in with the customer to confirm the relationship is intact",
            "_sort_key": act["lifetime_revenue"],
        })
    return alerts


def _product_concentration_alerts() -> list[dict]:
    total_revenue = get_sales_summary()["total_revenue"]
    if not total_revenue:
        return []
    top_products = get_top_selling_products(limit=5)["products"]

    alerts = []
    for p in top_products:
        share = round(p["total_revenue"] / total_revenue * 100, 2)
        if share < _PRODUCT_CONCENTRATION_MEDIUM_PCT:
            continue
        risk = "High" if share >= _PRODUCT_CONCENTRATION_HIGH_PCT else "Medium"
        alerts.append({
            "risk_level": risk,
            "alert_type": "Product Concentration",
            "title": f"{p['product_name']} — {share}% of total revenue",
            "details": [
                f"Revenue: {fmt_currency(p['total_revenue'])}",
                f"Share of Total Revenue: {share}%",
                f"Units Sold: {p['total_qty']:,}",
            ],
            "recommended_action": "Diversify product/customer mix — high dependency on a single product",
            "_sort_key": share,
        })
    return alerts


def _opportunity_alerts(sales_summary_data: dict, activity_map: dict) -> list[dict]:
    by_customer = sales_summary_data.get("by_customer") or []
    if not by_customer:
        return []

    top = by_customer[0]
    act = activity_map.get(top["customer_name"])
    if not act or not act["last_purchase_date"]:
        return []

    days = (date.today() - date.fromisoformat(act["last_purchase_date"])).days
    if days > _OPPORTUNITY_RECENT_DAYS:
        return []

    return [{
        "risk_level": "Low",
        "alert_type": "Opportunity",
        "title": f"{top['customer_name']} — top revenue customer, recently active",
        "details": [
            f"Revenue: {fmt_currency(top['revenue'])}",
            f"Last Purchase: {fmt_date(act['last_purchase_date'])} ({days}d ago)",
        ],
        "recommended_action": "Consider proactive engagement / upsell for this key account",
        "_sort_key": top["revenue"],
    }]


def get_business_alerts(limit: int = 10) -> dict:
    sales = provider.get_sales()
    activity_map = _sales_activity_by_customer(sales)
    sales_summary_data = get_sales_summary()

    alerts = (
        _collection_alerts()
        + _large_invoice_alerts()
        + _inactive_customer_alerts(activity_map)
        + _product_concentration_alerts()
        + _opportunity_alerts(sales_summary_data, activity_map)
    )

    alerts.sort(key=lambda a: (_RISK_ORDER.get(a["risk_level"], 9), -a["_sort_key"]))
    total_alerts = len(alerts)
    limited = alerts[: limit or len(alerts)]
    for a in limited:
        a.pop("_sort_key", None)

    return {"alerts": limited, "total_alerts": total_alerts}


def format_business_alerts(data: dict) -> str:
    lines = ["## Business Alerts", "", f"**Total Alerts:** {data['total_alerts']}", ""]

    if not data["alerts"]:
        lines.append("_No urgent business alerts at this time._")
        return "\n".join(lines)

    for i, a in enumerate(data["alerts"], 1):
        lines.append(f"### {i}. [{a['risk_level']}] {a['title']}")
        lines.append(f"**Type:** {a['alert_type']}")
        lines.append("**Details:**")
        for d in a["details"]:
            lines.append(f"- {d}")
        lines.append(f"**Recommended Action:** {a['recommended_action']}")
        lines.append("")

    return "\n".join(lines).rstrip()
