from src.data import provider
from src.utils.date_filters import parse_date_range, filter_by_date
from src.tools.customer_tools import _normalize_limit

_DEFAULT_PRODUCT_LIMIT = 5
# Top-customer/top-product breakdowns are bounded so a live-Odoo dataset with
# ~90+ customers doesn't render its entire customer base as a "top" list.
_SUMMARY_TOP_N = 5


_MONTH_NAMES = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}


def _filter_sales(month: int | None = None, year: int | None = None,
                  period: str | None = None) -> list[dict]:
    result = provider.get_sales()
    if period:
        # period takes priority over month/year; falls through only if unparseable.
        filtered = filter_by_date(result, period, "date")
        if filtered is not result:
            return filtered
    if year:
        result = [s for s in result if int(s["date"][:4]) == year]
    if month:
        result = [s for s in result if int(s["date"][5:7]) == month]
    return result


def _resolve_label(month: int | None, year: int | None, period: str | None) -> str:
    if period:
        start, end = parse_date_range(period)
        if start and end:
            from src.utils.formatting import fmt_date
            return f"{fmt_date(start)} – {fmt_date(end)}"
    return _period_label(month, year)


def _build_category_maps() -> tuple[dict, dict]:
    """Resolve category by product_id (reliable) with a name fallback (mock)."""
    by_id: dict = {}
    by_name: dict = {}
    for p in provider.get_products():
        category = p.get("category") or "Unknown"
        if p.get("id") is not None:
            by_id[p["id"]] = category
        by_name[p["name"]] = category
    return by_id, by_name


def _resolve_category(sale: dict, by_id: dict, by_name: dict) -> str:
    pid = sale.get("product_id")
    if pid is not None and pid in by_id:
        return by_id[pid]
    return by_name.get(sale["product_name"], "Unknown")


def get_top_selling_products(period: str | None = None, month: int | None = None,
                             year: int | None = None, limit: int = 5) -> dict:
    limit = _normalize_limit(limit, _DEFAULT_PRODUCT_LIMIT)
    filtered = _filter_sales(month, year, period)

    cat_by_id, cat_by_name = _build_category_maps()

    aggregated: dict[str, dict] = {}
    for sale in filtered:
        name = sale["product_name"]
        if name not in aggregated:
            aggregated[name] = {
                "product_name": name,
                "category": _resolve_category(sale, cat_by_id, cat_by_name),
                "total_revenue": 0.0,
                "total_qty": 0,
                "order_count": 0,
            }
        aggregated[name]["total_revenue"] += sale["total"]
        aggregated[name]["total_qty"] += sale["quantity"]
        aggregated[name]["order_count"] += 1

    ranked = sorted(aggregated.values(), key=lambda x: x["total_revenue"], reverse=True)
    top = ranked[:limit]

    total_revenue = sum(s["total"] for s in filtered)

    return {
        "products": top,
        "product_count": len(ranked),
        "period_month": month,
        "period_year": year,
        "period_label": _resolve_label(month, year, period),
        "total_revenue": total_revenue,
        "total_transactions": len(filtered),
    }


def get_sales_summary(period: str | None = None, month: int | None = None,
                      year: int | None = None) -> dict:
    filtered = _filter_sales(month, year, period)
    label = _resolve_label(month, year, period)

    if not filtered:
        return {
            "period_month": month,
            "period_year": year,
            "period_label": label,
            "total_revenue": 0,
            "total_transactions": 0,
            "avg_transaction": 0,
            "by_customer": [],
            "by_product": [],
            "customer_count": 0,
            "product_count": 0,
        }

    total_revenue = sum(s["total"] for s in filtered)
    avg_transaction = total_revenue / len(filtered) if filtered else 0

    by_customer: dict[str, float] = {}
    for s in filtered:
        by_customer[s["customer_name"]] = by_customer.get(s["customer_name"], 0) + s["total"]
    top_customers = sorted(
        [{"customer_name": k, "revenue": v} for k, v in by_customer.items()],
        key=lambda x: x["revenue"],
        reverse=True,
    )[:_SUMMARY_TOP_N]

    by_product: dict[str, float] = {}
    for s in filtered:
        by_product[s["product_name"]] = by_product.get(s["product_name"], 0) + s["total"]
    top_products = sorted(
        [{"product_name": k, "revenue": v} for k, v in by_product.items()],
        key=lambda x: x["revenue"],
        reverse=True,
    )

    return {
        "period_month": month,
        "period_year": year,
        "period_label": label,
        "total_revenue": total_revenue,
        "total_transactions": len(filtered),
        "avg_transaction": round(avg_transaction, 2),
        "by_customer": top_customers,
        "by_product": top_products[:_SUMMARY_TOP_N],
        "customer_count": len(by_customer),
        "product_count": len(by_product),
    }


# ── Response Formatters ──────────────────────────────────────────────────────

def _period_label(month: int | None, year: int | None) -> str:
    month_names = [
        "", "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ]
    if month and year:
        return f"{month_names[month]} {year}"
    elif year:
        return str(year)
    return "All Time"


def format_top_products(data: dict) -> str:
    from src.utils.formatting import fmt_currency, fmt_product_table
    period = data.get("period_label") or _period_label(data["period_month"], data["period_year"])

    lines = [
        f"## Top Selling Products – {period}",
        "",
        f"**Total Revenue:** {fmt_currency(data['total_revenue'])} | "
        f"**Transactions:** {data['total_transactions']}",
        "",
    ]
    product_count = data.get("product_count", len(data["products"]))
    if product_count > len(data["products"]):
        lines += [f"_Showing top {len(data['products'])} of {product_count} product(s)._", ""]
    lines.append(fmt_product_table(data["products"]))
    return "\n".join(lines)


def format_sales_summary(data: dict) -> str:
    from src.utils.formatting import fmt_currency
    period = data.get("period_label") or _period_label(data["period_month"], data["period_year"])

    if data["total_transactions"] == 0:
        return f"## Sales Summary – {period}\n\n_No sales data found for this period._"

    lines = [
        f"## Sales Summary – {period}",
        "",
        "### Key Metrics",
        "| Metric | Value |",
        "|--------|-------|",
        f"| Total Revenue | **{fmt_currency(data['total_revenue'])}** |",
        f"| Transactions | {data['total_transactions']} |",
        f"| Avg. Transaction Value | {fmt_currency(data['avg_transaction'])} |",
        "",
        _top_section_heading("Top Customers by Revenue",
                             len(data["by_customer"]), data.get("customer_count")),
        "| Customer | Revenue |",
        "|----------|---------|",
    ]
    for c in data["by_customer"]:
        lines.append(f"| {c['customer_name']} | {fmt_currency(c['revenue'])} |")

    lines += [
        "",
        _top_section_heading("Top Products by Revenue",
                             len(data["by_product"]), data.get("product_count")),
        "| Product | Revenue |",
        "|---------|---------|",
    ]
    for p in data["by_product"]:
        lines.append(f"| {p['product_name']} | {fmt_currency(p['revenue'])} |")

    return "\n".join(lines)


def _top_section_heading(title: str, shown: int, total: int | None) -> str:
    """'### Top Customers by Revenue (top 5 of 92)' when the list is truncated."""
    if total is not None and total > shown:
        return f"### {title} (top {shown} of {total})"
    return f"### {title}"
