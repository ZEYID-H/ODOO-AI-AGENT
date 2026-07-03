import re
from src.data.mock_data import CUSTOMERS
from src.agent.prompts import UNKNOWN_INTENT_MSG, NO_CUSTOMER_MSG

from src.tools.customer_tools import (
    get_customer_balance, format_customer_balance,
    get_customer_summary, format_customer_summary,
    get_payment_history, format_payment_history,
    get_top_debtors, format_top_debtors,
    get_customer_statement, format_customer_statement,
)
from src.tools.invoice_tools import (
    get_unpaid_invoices, format_unpaid_invoices,
    get_overdue_invoices, format_overdue_invoices,
)
from src.tools.sales_tools import (
    get_top_selling_products, format_top_products,
    get_sales_summary, format_sales_summary,
)
from src.tools.dashboard_tools import (
    get_dashboard_summary, format_dashboard_summary,
)
from src.tools.collections_tools import (
    get_collection_priorities, format_collection_priorities,
)
from src.tools.customer_insights_tools import (
    get_customer_insights, format_customer_insights,
)
from src.tools.product_insights_tools import (
    get_product_insights, format_product_insights,
)

# OpenAI Function Calling layer. Imported defensively so the app still runs if
# the openai SDK is absent: any import failure leaves _OPENAI_IMPORTED False and
# route_query uses the rule-based fallback.
try:
    from src.services.openai_service import is_available, run_agent
    _OPENAI_IMPORTED = True
except Exception:
    _OPENAI_IMPORTED = False

_MONTH_MAP = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}

_THIS_MONTH = 6
_THIS_YEAR = 2026


def _extract_customer(query: str) -> str | None:
    q_upper = query.upper()
    for c in CUSTOMERS:
        if c["name"].upper() in q_upper:
            return c["name"]
    return None


_PRODUCT_TRIGGER_PHRASES = [
    "insights for product", "product insights for", "product insight for",
    "product analytics for", "product analytic for", "analyze product",
    "product performance for", "product performance", "how is", "is selling",
    "selling", "insights for", "tell me about", "product for", "for product",
    "product insight", "product analytic",
]


def _extract_product_query(query: str) -> str:
    """Best-effort: strip known trigger phrases, leaving the product text.

    The OpenAI path extracts product_name precisely via the schema; this is
    only used by the offline rule-based fallback.
    """
    remaining = query
    for phrase in sorted(_PRODUCT_TRIGGER_PHRASES, key=len, reverse=True):
        idx = remaining.lower().find(phrase)
        if idx != -1:
            remaining = remaining[:idx] + remaining[idx + len(phrase):]
    return remaining.strip(" ?.!")


def _extract_period(query: str) -> tuple[int | None, int | None]:
    q_lower = query.lower()

    if "this month" in q_lower:
        return _THIS_MONTH, _THIS_YEAR
    if "last month" in q_lower:
        m = _THIS_MONTH - 1 if _THIS_MONTH > 1 else 12
        y = _THIS_YEAR if _THIS_MONTH > 1 else _THIS_YEAR - 1
        return m, y

    month: int | None = None
    year: int | None = None

    for name, number in _MONTH_MAP.items():
        if name in q_lower:
            month = number
            break

    year_match = re.search(r"\b(202[0-9]|203[0-9])\b", query)
    if year_match:
        year = int(year_match.group())

    return month, year


def _detect_intent(query: str) -> str:
    q = query.lower()

    # Ordered by specificity — most specific patterns first
    if any(kw in q for kw in ["collection priorit", "collections", "payment follow",
                               "follow up", "follow-up", "who should we call",
                               "who should we follow", "overdue customer",
                               "customers requiring", "requiring follow", "collection call"]):
        return "collections"

    if any(kw in q for kw in ["overdue", "past due", "late invoice", "missed payment"]):
        return "overdue_invoices"

    if any(kw in q for kw in ["top debtor", "biggest debtor", "most money", "owes the most",
                               "owe the most", "owes us the most", "who owes the most",
                               "highest outstanding", "highest balance", "largest unpaid",
                               "largest balance", "biggest balance", "biggest customer balance",
                               "rank customer", "most outstanding"]):
        return "top_debtors"

    if any(kw in q for kw in ["customer statement", "account statement", "statement of account",
                               "customer ledger", "ledger for", "ledger",
                               "show transactions", "transactions for", "statement"]):
        return "statement"

    if any(kw in q for kw in ["executive dashboard", "dashboard", "executive summary",
                               "management summary", "business overview", "kpis", "kpi",
                               "key metrics"]):
        return "dashboard"

    if any(kw in q for kw in ["top selling", "top-selling", "best selling", "bestselling",
                               "top product", "best product", "most sold"]):
        return "top_products"

    if any(kw in q for kw in ["sales summary", "sales performance", "sales report",
                               "revenue", "sales data", "summarize sales", "sales for"]):
        return "sales_summary"

    if any(kw in q for kw in ["payment history", "payment record", "payments made",
                               "show payment", "payment for"]):
        return "payment_history"

    if any(kw in q for kw in ["product insight", "product analytic", "analyze product",
                               "product performance", "insights for product", "how is",
                               "is selling"]):
        return "product_insights"

    if any(kw in q for kw in ["customer insight", "customer analytic", "analyze customer",
                               "insights for", "tell me about", "customer risk"]):
        return "customer_insights"

    if any(kw in q for kw in ["customer summary", "account summary", "customer overview",
                               "account overview", "summarize customer", "customer profile"]):
        return "customer_summary"

    if any(kw in q for kw in ["unpaid invoice", "outstanding invoice", "open invoice",
                               "unpaid", "show invoice", "list invoice"]):
        return "unpaid_invoices"

    if any(kw in q for kw in ["balance", "owe", "owes", "how much", "debt",
                               "outstanding balance", "amount due"]):
        return "balance"

    return "unknown"


def route_query(query: str, history: list[dict] | None = None) -> dict:
    """Public entry point (contract unchanged): returns {tool, parameters, result}.

    Orchestrator only — it does not route. It tries the OpenAI Function Calling
    path and degrades to deterministic rule-based routing on any failure.
    """
    # ── OpenAI path ─────────────────────────────────────────────────────────
    # The model selects the tool and extracts arguments via function calling.
    # Reached only when the SDK imported AND an API key is configured.
    if _OPENAI_IMPORTED and is_available():
        try:
            return run_agent(query, history)
        except Exception:
            # ── Error propagation / fallback path ──────────────────────────
            # run_agent raises cleanly on missing key, rate limits, network or
            # timeout errors, malformed arguments, or an unknown tool. The
            # router is the single place resilience lives: we swallow the error
            # here and fall through to rule-based routing so the app keeps
            # working without OpenAI.
            return _rule_based_route(query)

    # ── Fallback path ───────────────────────────────────────────────────────
    # No OpenAI SDK/key available → deterministic keyword routing.
    return _rule_based_route(query)


def _rule_based_route(query: str) -> dict:
    intent = _detect_intent(query)
    customer = _extract_customer(query)
    month, year = _extract_period(query)

    # ── Collection priorities (no customer filter needed) ───────────────────
    if intent == "collections":
        data = get_collection_priorities()
        return {
            "tool": "get_collection_priorities",
            "parameters": {},
            "result": format_collection_priorities(data),
        }

    # ── Top debtors (no customer filter needed) ─────────────────────────────
    if intent == "top_debtors":
        data = get_top_debtors(period=query)
        return {
            "tool": "get_top_debtors",
            "parameters": {},
            "result": format_top_debtors(data),
        }

    # ── Customer statement (requires customer) ──────────────────────────────
    if intent == "statement":
        if not customer:
            return {"tool": "get_customer_statement", "parameters": {}, "result": NO_CUSTOMER_MSG}
        data = get_customer_statement(customer, period=query)
        return {
            "tool": "get_customer_statement",
            "parameters": {"customer_name": customer},
            "result": format_customer_statement(data),
        }

    # ── Executive dashboard (no customer filter needed) ─────────────────────
    if intent == "dashboard":
        data = get_dashboard_summary()
        return {
            "tool": "get_dashboard_summary",
            "parameters": {},
            "result": format_dashboard_summary(data),
        }

    # ── Overdue invoices (no customer filter needed) ────────────────────────
    if intent == "overdue_invoices":
        data = get_overdue_invoices(period=query)
        return {
            "tool": "get_overdue_invoices",
            "parameters": {},
            "result": format_overdue_invoices(data),
        }

    # ── Top selling products ────────────────────────────────────────────────
    if intent == "top_products":
        # Default to this month if no period specified
        m = month if month else _THIS_MONTH
        y = year if year else _THIS_YEAR
        data = get_top_selling_products(period=query, month=m, year=y)
        return {
            "tool": "get_top_selling_products",
            "parameters": {"month": m, "year": y},
            "result": format_top_products(data),
        }

    # ── Sales summary ───────────────────────────────────────────────────────
    if intent == "sales_summary":
        m = month if month else _THIS_MONTH
        y = year if year else _THIS_YEAR
        data = get_sales_summary(period=query, month=m, year=y)
        return {
            "tool": "get_sales_summary",
            "parameters": {"month": m, "year": y},
            "result": format_sales_summary(data),
        }

    # ── Payment history (requires customer) ────────────────────────────────
    if intent == "payment_history":
        if not customer:
            return {"tool": "get_payment_history", "parameters": {}, "result": NO_CUSTOMER_MSG}
        data = get_payment_history(customer)
        return {
            "tool": "get_payment_history",
            "parameters": {"customer_name": customer},
            "result": format_payment_history(data),
        }

    # ── Product insights (no fixed customer list — best-effort text extraction) ─
    if intent == "product_insights":
        product_query = _extract_product_query(query)
        if not product_query:
            return {
                "tool": "get_product_insights",
                "parameters": {},
                "result": "Please specify a product to analyze.",
            }
        data = get_product_insights(product_query)
        return {
            "tool": "get_product_insights",
            "parameters": {"product_name": product_query},
            "result": format_product_insights(data),
        }

    # ── Customer insights (requires customer) ───────────────────────────────
    if intent == "customer_insights":
        if not customer:
            return {"tool": "get_customer_insights", "parameters": {}, "result": NO_CUSTOMER_MSG}
        data = get_customer_insights(customer)
        return {
            "tool": "get_customer_insights",
            "parameters": {"customer_name": customer},
            "result": format_customer_insights(data),
        }

    # ── Customer summary (requires customer) ───────────────────────────────
    if intent == "customer_summary":
        if not customer:
            return {"tool": "get_customer_summary", "parameters": {}, "result": NO_CUSTOMER_MSG}
        data = get_customer_summary(customer)
        return {
            "tool": "get_customer_summary",
            "parameters": {"customer_name": customer},
            "result": format_customer_summary(data),
        }

    # ── Unpaid invoices (optional customer filter) ──────────────────────────
    if intent == "unpaid_invoices":
        data = get_unpaid_invoices(customer_name=customer, period=query)
        return {
            "tool": "get_unpaid_invoices",
            "parameters": {"customer_name": customer},
            "result": format_unpaid_invoices(data),
        }

    # ── Customer balance (requires customer) ───────────────────────────────
    if intent == "balance":
        if not customer:
            return {"tool": "get_customer_balance", "parameters": {}, "result": NO_CUSTOMER_MSG}
        data = get_customer_balance(customer)
        return {
            "tool": "get_customer_balance",
            "parameters": {"customer_name": customer},
            "result": format_customer_balance(data),
        }

    # ── Fallback ────────────────────────────────────────────────────────────
    return {
        "tool": "unknown",
        "parameters": {},
        "result": UNKNOWN_INTENT_MSG,
    }
