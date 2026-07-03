"""Product-level business intelligence — additive, read-only.

Matching rule (locked):
    1. Exact match on the sold product's display name (case-insensitive).
    2. Else aggregate every sold product whose display name CONTAINS the query
       (case-insensitive substring) — e.g. "OLIVE OIL" combines all olive oil SKUs.
    3. Else a clear "no_match" result.

Reuses provider.get_sales() and get_sales_summary() (for the revenue-share
denominator). No existing tool is modified.
"""

from src.data import provider
from src.utils.formatting import fmt_currency, fmt_date
from src.tools.sales_tools import get_sales_summary


def get_product_insights(product_name: str) -> dict:
    query = (product_name or "").strip()
    if not query:
        return {"query": product_name, "mode": "no_match", "matched_skus": [],
                "error": "No product name provided."}

    sales = provider.get_sales()
    query_upper = query.upper()

    exact = [s for s in sales if s["product_name"].upper() == query_upper]
    if exact:
        mode = "exact"
        matched_skus = [exact[0]["product_name"]]
        selected = exact
    else:
        matched_skus = sorted({
            s["product_name"] for s in sales if query_upper in s["product_name"].upper()
        })
        if not matched_skus:
            return {
                "query": product_name,
                "mode": "no_match",
                "matched_skus": [],
                "error": f"No product found matching '{product_name}'.",
            }
        mode = "aggregated"
        selected = [s for s in sales if s["product_name"] in matched_skus]

    total_all_revenue = get_sales_summary()["total_revenue"]

    revenue = sum(s["total"] for s in selected)
    units_sold = sum(s["quantity"] for s in selected)
    customer_count = len({s["customer_name"] for s in selected})
    dates = sorted(s["date"] for s in selected)
    first_sale_date = dates[0] if dates else None
    last_sale_date = dates[-1] if dates else None
    average_sale_price = revenue / units_sold if units_sold else 0.0
    revenue_share_pct = round(revenue / total_all_revenue * 100, 2) if total_all_revenue else 0.0

    by_customer: dict[str, float] = {}
    for s in selected:
        by_customer[s["customer_name"]] = by_customer.get(s["customer_name"], 0.0) + s["total"]
    top_customers = sorted(
        ({"customer_name": k, "revenue": v} for k, v in by_customer.items()),
        key=lambda x: x["revenue"], reverse=True,
    )[:5]

    return {
        "query": product_name,
        "mode": mode,
        "matched_skus": matched_skus,
        "revenue": revenue,
        "units_sold": units_sold,
        "customer_count": customer_count,
        "first_sale_date": first_sale_date,
        "last_sale_date": last_sale_date,
        "average_sale_price": average_sale_price,
        "revenue_share_pct": revenue_share_pct,
        "top_customers": top_customers,
    }


def format_product_insights(data: dict) -> str:
    if data.get("mode") == "no_match" or "error" in data:
        return f"**Error:** {data.get('error', 'Product not found.')}"

    lines = ["## Product Insights", "", f"**Query:** {data['query']}"]

    if data["mode"] == "exact":
        lines.append(f"**Matching Mode:** Exact — {data['matched_skus'][0]}")
    else:
        lines.append(
            f"**Matching Mode:** Aggregated — combined {len(data['matched_skus'])} matching SKU(s):"
        )
        for sku in data["matched_skus"]:
            lines.append(f"- {sku}")

    lines += [
        "",
        "| Metric | Value |",
        "|--------|-------|",
        f"| Revenue | **{fmt_currency(data['revenue'])}** |",
        f"| Units Sold | {data['units_sold']:,} |",
        f"| Customers | {data['customer_count']} |",
        f"| First Sale Date | {fmt_date(data['first_sale_date']) if data['first_sale_date'] else 'N/A'} |",
        f"| Last Sale Date | {fmt_date(data['last_sale_date']) if data['last_sale_date'] else 'N/A'} |",
        f"| Average Sale Price | {fmt_currency(data['average_sale_price'])} |",
        f"| Share of Total Revenue | {data['revenue_share_pct']}% |",
        "",
        "### Top Customers",
        "| Customer | Revenue |",
        "|----------|---------|",
    ]
    if data["top_customers"]:
        for c in data["top_customers"]:
            lines.append(f"| {c['customer_name']} | {fmt_currency(c['revenue'])} |")
    else:
        lines.append("| _None_ | - |")

    return "\n".join(lines)
