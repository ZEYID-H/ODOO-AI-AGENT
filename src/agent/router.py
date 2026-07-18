"""Query routing.

Two layers, one public contract (`route_query(query, history) ->
{tool, parameters, result}`):

  1. OpenAI Function Calling (primary): the model resolves intent
     semantically, guided by SYSTEM_PROMPT's routing rules and the tool
     schemas. Used whenever the SDK imported and an API key is configured.
  2. Rule-based fallback (this file's `_rule_based_route`): deterministic,
     offline, stateless. AG3 hardened it — entity-aware ambiguity resolution,
     dynamic date handling (no hardcoded "today"), provider-backed entity
     extraction (works for whichever backend is active, not just mock),
     punctuation/casing-tolerant matching, Arabic keyword coverage, and an
     unknown-customer guard so a misheard name degrades to a clear "name the
     customer" reply instead of silently answering for ALL customers.

The fallback is deliberately stateless: it takes no conversation history.
Follow-up resolution ("their", "too") is an LLM-path capability — a
deterministic keyword layer has no safe way to resolve references, so a
follow-up that reaches the fallback simply routes on its own literal text
(documented limitation, docs/AI_AGENT_ROUTING.md).
"""

import re
from datetime import date

from src.data import provider
from src.utils.date_filters import parse_date_range, period_label
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
from src.tools.business_alerts_tools import (
    get_business_alerts, format_business_alerts,
)

# OpenAI Function Calling layer. Imported defensively so the app still runs if
# the openai SDK is absent: any import failure leaves _OPENAI_IMPORTED False and
# route_query uses the rule-based fallback.
try:
    from src.services.openai_service import is_available, run_agent
    _OPENAI_IMPORTED = True
except Exception:
    _OPENAI_IMPORTED = False

# English + Arabic month names → month number (the fallback's own map;
# date_filters handles the English phrases inside `period` strings).
_MONTH_MAP = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
    "يناير": 1, "فبراير": 2, "مارس": 3, "أبريل": 4, "ابريل": 4,
    "مايو": 5, "يونيو": 6, "يوليو": 7, "أغسطس": 8, "اغسطس": 8,
    "سبتمبر": 9, "أكتوبر": 10, "اكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12,
}


# ── Entity extraction ────────────────────────────────────────────────────────

def _normalize_for_matching(text: str) -> str:
    """Uppercase, punctuation → spaces, collapsed whitespace.

    Makes "Apple-Mart", "'APPLE MART'", "apple mart." and "Apple Mart LLC"
    all contain the same canonical token sequence "APPLE MART".
    """
    return re.sub(r"[^\w]+", " ", text, flags=re.UNICODE).upper().strip()


def _extract_customer(query: str) -> str | None:
    """Find a known customer named in the query (whichever backend is active).

    Reads through provider.get_customers() — not the mock list directly — so
    the fallback recognizes live-Odoo customers too (pre-AG3 it was
    mock-bound). Longest name wins so "GOLDEN STAR TRADING" beats a
    hypothetical customer named "STAR".
    """
    q_norm = f" {_normalize_for_matching(query)} "
    best: str | None = None
    for c in provider.get_customers():
        name_norm = _normalize_for_matching(c["name"])
        if name_norm and f" {name_norm} " in q_norm:
            if best is None or len(name_norm) > len(_normalize_for_matching(best)):
                best = c["name"]
    return best


def _match_product(text: str) -> bool:
    """True if `text` plausibly names a known product.

    Same containment idea get_product_insights uses (exact, or substring in
    either direction) against the active backend's product catalog. Minimum
    length guards against matching stray short words.
    """
    t = _normalize_for_matching(text)
    if len(t) < 3:
        return False
    for p in provider.get_products():
        p_norm = _normalize_for_matching(p["name"])
        if p_norm and (t in p_norm or p_norm in t):
            return True
    return False


_PRODUCT_TRIGGER_PHRASES = [
    "insights for product", "product insights for", "product insight for",
    "product analytics for", "product analytic for", "analyze product",
    "product performance for", "product performance", "how is", "is selling",
    "selling", "insights for", "tell me about", "product for", "for product",
    "product insight", "product analytic", "doing", "analyze",
    "insights about", "give me insights", "give me",
    # Arabic triggers ("performance of product", "product", "how")
    "أداء منتج", "اداء منتج", "منتج", "كيف",
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
    return remaining.strip(" ?.!؟،")


# ── Date extraction (fallback path) ──────────────────────────────────────────

def _extract_period(query: str) -> tuple[int | None, int | None]:
    """(month, year) when the query names one explicitly or relatively.

    AG3: fully dynamic — derived from date.today() at call time, never from
    hardcoded constants (the pre-AG3 `_THIS_MONTH = 6` / `_THIS_YEAR = 2026`
    silently misdated every relative query once the real month moved on).
    """
    q_lower = query.lower()
    today = date.today()

    if "this month" in q_lower or "current month" in q_lower or "هذا الشهر" in query:
        return today.month, today.year
    if "last month" in q_lower or "previous month" in q_lower or "الشهر الماضي" in query:
        m = today.month - 1 if today.month > 1 else 12
        y = today.year if today.month > 1 else today.year - 1
        return m, y

    month: int | None = None
    year: int | None = None

    for name, number in _MONTH_MAP.items():
        if name in q_lower or name in query:
            month = number
            break

    year_match = re.search(r"\b(20[0-9]{2})\b", query)
    if year_match:
        year = int(year_match.group())

    return month, year


# ── Intent detection ─────────────────────────────────────────────────────────

# Write-intent verbs: no tool performs writes, so these must never resolve to
# any tool — an explicit guard rather than an accident of keyword coverage.
_WRITE_VERBS = (
    "delete", "remove", "create", "update", "modify", "cancel", "void",
    "احذف", "حذف", "أنشئ", "انشئ", "عدل", "ألغ", "الغ",
)


def _detect_intent(query: str) -> str:
    q = query.lower()

    def has(*keywords: str) -> bool:
        return any(kw in q or kw in query for kw in keywords)

    # Read-only guarantee at the intent layer: write requests are always
    # "unknown" regardless of what other keywords they happen to contain.
    if has(*_WRITE_VERBS):
        return "unknown"

    # Ordered by specificity — most specific patterns first
    if has("business alert", "show alert", "what should i worry",
           "urgent business risk", "urgent business issue",
           "business health", "problems in the business",
           "what needs attention", "تنبيهات", "تنبيه"):
        return "business_alerts"

    if has("collection priorit", "collections", "payment follow",
           "follow up", "follow-up", "who should we call",
           "who should we follow", "overdue customer",
           "customers requiring", "requiring follow", "collection call",
           "نتابع", "متابعة الدفع", "التحصيل"):
        return "collections"

    if has("overdue", "past due", "late invoice", "missed payment",
           "المتأخرة", "متأخرة", "متأخره"):
        return "overdue_invoices"

    if has("top debtor", "biggest debtor", "most money", "owes the most",
           "owe the most", "owes us the most", "who owes the most",
           "highest outstanding", "highest balance", "largest unpaid",
           "largest balance", "biggest balance", "biggest customer balance",
           "rank customer", "most outstanding",
           "أكبر المدينين", "اكبر المدينين"):
        return "top_debtors"

    if has("customer statement", "account statement", "statement of account",
           "customer ledger", "ledger for", "ledger",
           "show transactions", "transactions for", "statement",
           "كشف حساب", "كشف الحساب"):
        return "statement"

    if has("executive dashboard", "dashboard", "executive summary",
           "management summary", "business overview", "kpis", "kpi",
           "key metrics", "business metrics", "لوحة"):
        return "dashboard"

    if has("top selling", "top-selling", "best selling", "bestselling",
           "best seller", "top product", "best product", "most sold",
           "الأكثر مبيع", "الاكثر مبيع"):
        return "top_products"

    if has("sales summary", "sales performance", "sales report",
           "revenue", "sales data", "summarize sales", "sales for",
           "المبيعات", "لخص المبيعات"):
        return "sales_summary"

    if has("payment history", "payment record", "payments made",
           "show payment", "payment for",
           "سجل مدفوعات", "سجل المدفوعات", "مدفوعات"):
        return "payment_history"

    if has("product insight", "product analytic", "analyze product",
           "product performance", "insights for product", "how is",
           "is selling", "doing",
           "أداء منتج", "اداء منتج"):
        return "product_insights"

    # Bare "analyze"/"insight" land here LAST among the analytic intents —
    # "analyze product X" / "product insights" already matched above, and the
    # entity-aware resolver flips this to product_insights when the named
    # entity is a product.
    if has("customer insight", "customer analytic", "analyze customer",
           "insights for", "insights about", "insight", "analyze",
           "tell me about", "customer risk", "risk level", "risk",
           "حلل", "تحليل"):
        return "customer_insights"

    if has("customer summary", "account summary", "customer overview",
           "account overview", "summarize customer", "customer profile",
           "ملخص حساب", "ملخص الحساب"):
        return "customer_summary"

    if has("unpaid invoice", "outstanding invoice", "open invoice",
           "unpaid", "show invoice", "list invoice", "invoices",
           "غير المدفوعة", "غير مدفوعة", "فواتير", "الفواتير"):
        return "unpaid_invoices"

    if has("balance", "owe", "owes", "how much", "debt",
           "outstanding balance", "amount due",
           "تدين", "يدين", "رصيد", "الرصيد"):
        return "balance"

    return "unknown"


def _resolve_analytic_ambiguity(intent: str, query: str, customer: str | None) -> str:
    """Entity-aware disambiguation for analytic phrasings (AG3).

    "Tell me about X" / "how is X doing" / "analyze X" are keyword-ambiguous
    between customer and product analytics. The entity decides:

      - a product-analytic intent with a KNOWN CUSTOMER named (and no product
        match) is really a customer question — pre-AG3, "How is APPLE MART
        doing?" routed to product insights and errored;
      - a customer-analytic intent with NO known customer but a KNOWN PRODUCT
        named is really a product question — pre-AG3, "Tell me about Fresh
        Apples" dead-ended on NO_CUSTOMER_MSG.

    When both or neither match, the keyword intent stands (the tool itself
    then reports not-found clearly — never a silent wrong answer).
    """
    if intent not in ("product_insights", "customer_insights"):
        return intent

    product_matched = _match_product(_extract_product_query(query))

    if intent == "product_insights" and customer and not product_matched:
        return "customer_insights"
    if intent == "customer_insights" and not customer and product_matched:
        return "product_insights"
    return intent


# ── Unknown-customer guard (unpaid invoices) ────────────────────────────────

_FOR_TARGET = re.compile(r"\bfor\s+(.+)$", re.IGNORECASE)
_FOR_TARGET_AR = re.compile(r"لشركة\s+(.+)$")
_ALL_CUSTOMERS_WORDS = ("all", "every", "everyone", "each")


def _names_unmatched_customer(query: str) -> bool:
    """True when the query says "... for <TARGET>" but TARGET is not a known
    customer, a date phrase, a product, or an explicit "all customers".

    Guards the optional-customer unpaid-invoices branch: pre-AG3, "unpaid
    invoices for GALAXY TRADERS" (unknown) silently broadened to ALL
    customers' invoices. A clear "couldn't identify the customer" reply is
    strictly safer than a confidently wrong scope.
    """
    m = _FOR_TARGET.search(query) or _FOR_TARGET_AR.search(query)
    if not m:
        return False
    target = m.group(1).strip(" ?.!؟،\"'")
    if not target:
        return False
    t_lower = target.lower()
    if any(w in t_lower.split() for w in _ALL_CUSTOMERS_WORDS):
        return False
    if parse_date_range(target) != (None, None):
        return False
    if _match_product(target):
        return False
    return True


# ── Public entry point ───────────────────────────────────────────────────────

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


def _period_params(query: str) -> dict:
    """{"period": "<resolved range>"} when the query carries a parseable date
    phrase — the parameters dict states the range actually applied, instead of
    silently filtering with no visible trace (pre-AG3 behavior)."""
    label = period_label(query)
    return {"period": label} if label else {}


def _rule_based_route(query: str) -> dict:
    intent = _detect_intent(query)
    customer = _extract_customer(query)
    intent = _resolve_analytic_ambiguity(intent, query, customer)
    month, year = _extract_period(query)

    # ── Business alerts (no customer filter needed) ─────────────────────────
    if intent == "business_alerts":
        data = get_business_alerts()
        return {
            "tool": "get_business_alerts",
            "parameters": {},
            "result": format_business_alerts(data),
        }

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
            "parameters": _period_params(query),
            "result": format_top_debtors(data),
        }

    # ── Customer statement (requires customer) ──────────────────────────────
    if intent == "statement":
        if not customer:
            return {"tool": "get_customer_statement", "parameters": {}, "result": NO_CUSTOMER_MSG}
        data = get_customer_statement(customer, period=query)
        return {
            "tool": "get_customer_statement",
            "parameters": {"customer_name": customer, **_period_params(query)},
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
            "parameters": _period_params(query),
            "result": format_overdue_invoices(data),
        }

    # ── Top selling products ────────────────────────────────────────────────
    if intent == "top_products":
        return _dated_sales_route(
            query, month, year,
            tool_name="get_top_selling_products",
            tool=get_top_selling_products, formatter=format_top_products,
        )

    # ── Sales summary ───────────────────────────────────────────────────────
    if intent == "sales_summary":
        return _dated_sales_route(
            query, month, year,
            tool_name="get_sales_summary",
            tool=get_sales_summary, formatter=format_sales_summary,
        )

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
        if customer is None and _names_unmatched_customer(query):
            return {"tool": "get_unpaid_invoices", "parameters": {}, "result": NO_CUSTOMER_MSG}
        data = get_unpaid_invoices(customer_name=customer, period=query)
        return {
            "tool": "get_unpaid_invoices",
            "parameters": {"customer_name": customer, **_period_params(query)},
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


def _dated_sales_route(query: str, month: int | None, year: int | None, *,
                       tool_name: str, tool, formatter) -> dict:
    """Shared routing for the two month/year-scoped sales tools.

    Date precedence (all dynamic — AG3 removed the hardcoded constants):
      1. A parseable natural-language phrase in the query ("last quarter",
         "last 30 days") → passed as `period`; parameters state the resolved
         range.
      2. An explicit or relative month/year the fallback extracted
         ("June 2026", "يونيو 2026", "this month") → passed as month/year.
      3. Nothing at all → default to the REAL current month (the fallback's
         long-standing default scope, now computed at call time).
    """
    label = period_label(query)
    if label:
        data = tool(period=query)
        params = {"period": label}
    else:
        today = date.today()
        m = month if month else today.month
        y = year if year else today.year
        data = tool(month=m, year=y)
        params = {"month": m, "year": y}
    return {"tool": tool_name, "parameters": params, "result": formatter(data)}
