"""Executive dashboard — pure composition of existing tools.

get_dashboard_summary() calls the existing tools and reads provider counts; it
introduces NO new business logic and changes no existing tool. Totals therefore
match the source tools by construction.
"""

from src.data import provider
from src.utils.formatting import fmt_currency
from src.tools.sales_tools import get_sales_summary, get_top_selling_products
from src.tools.customer_tools import get_top_debtors
from src.tools.invoice_tools import get_unpaid_invoices, get_overdue_invoices


def get_dashboard_summary() -> dict:
    sales = get_sales_summary()
    debtors = get_top_debtors(limit=1)
    overdue = get_overdue_invoices()
    unpaid = get_unpaid_invoices()
    top_products = get_top_selling_products(limit=1)

    top_debtor = debtors["debtors"][0] if debtors["debtors"] else None
    top_product = top_products["products"][0] if top_products["products"] else None

    return {
        "total_revenue": sales["total_revenue"],
        "avg_transaction": sales["avg_transaction"],
        "total_transactions": sales["total_transactions"],
        "outstanding_receivables": debtors["total_outstanding"],
        "total_overdue": overdue["total_amount"],
        "overdue_invoice_count": overdue["count"],
        "open_invoice_count": unpaid["count"],
        "top_debtor": (
            {"customer_name": top_debtor["customer_name"],
             "outstanding_balance": top_debtor["outstanding_balance"]}
            if top_debtor else None
        ),
        "top_product": (
            {"product_name": top_product["product_name"],
             "total_revenue": top_product["total_revenue"]}
            if top_product else None
        ),
        "customer_count": len(provider.get_customers()),
        "product_count": len(provider.get_products()),
    }


def format_dashboard_summary(data: dict) -> str:
    td = data["top_debtor"]
    tp = data["top_product"]
    top_debtor = (
        f"{td['customer_name']} ({fmt_currency(td['outstanding_balance'])})" if td else "N/A"
    )
    top_product = (
        f"{tp['product_name']} ({fmt_currency(tp['total_revenue'])})" if tp else "N/A"
    )

    lines = [
        "## Executive Dashboard",
        "",
        "| Metric | Value |",
        "|--------|-------|",
        f"| Total Revenue | **{fmt_currency(data['total_revenue'])}** |",
        f"| Outstanding Receivables | {fmt_currency(data['outstanding_receivables'])} |",
        f"| Total Overdue | {fmt_currency(data['total_overdue'])} |",
        f"| Open Invoices | {data['open_invoice_count']} |",
        f"| Overdue Invoices | {data['overdue_invoice_count']} |",
        f"| Avg. Transaction Value | {fmt_currency(data['avg_transaction'])} |",
        f"| Top Debtor | {top_debtor} |",
        f"| Top Product | {top_product} |",
        f"| Customers | {data['customer_count']} |",
        f"| Products | {data['product_count']} |",
    ]
    return "\n".join(lines)
