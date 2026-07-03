import os
from datetime import date
from pathlib import Path

import pandas as pd
import streamlit as st

from src.agent.router import route_query
from src.agent.tool_registry import TOOL_REGISTRY
from src.tools.export_tools import export_customer_statement


# ── Memory helper (unchanged) ────────────────────────────────────────────────
def _build_history(messages: list[dict]) -> list[dict]:
    """Lightweight conversational memory for the model.

    Stores ONLY user text and a short assistant note — never tool outputs,
    markdown tables, or ERP figures. ERP data always comes from a fresh tool
    call; history exists only to resolve references like "too" -> APPLE MART.
    """
    history: list[dict] = []
    for m in messages:
        role = m.get("role")
        if role == "user":
            history.append({"role": "user", "content": m["content"]})
        elif role == "assistant":
            tool = m.get("tool")
            if tool in (None, "assistant", "unknown"):
                # Plain-text reply (e.g. a greeting) — no ERP data, safe to keep.
                history.append({"role": "assistant", "content": m["content"]})
            else:
                # Tool result: keep only a lightweight note, never the table.
                history.append({"role": "assistant", "content": f"(Provided {tool} results.)"})
    return history


# ── Export helpers (unchanged) ───────────────────────────────────────────────
@st.cache_data(show_spinner=False)
def _cached_export(customer_name: str, fmt: str) -> dict:
    return export_customer_statement(customer_name, fmt)


def _render_statement_downloads(customer_name: str, key_prefix: str) -> None:
    """Download buttons for a customer statement (CSV mandatory, Excel if available)."""
    if not customer_name:
        return
    cols = st.columns(2)
    csv_res = _cached_export(customer_name, "csv")
    if "error" not in csv_res:
        cols[0].download_button(
            "⬇️ Download CSV", data=csv_res["content"], file_name=csv_res["filename"],
            mime=csv_res["mimetype"], key=f"{key_prefix}_csv", use_container_width=True,
        )
    try:
        xlsx_res = _cached_export(customer_name, "xlsx")
        if "error" not in xlsx_res:
            cols[1].download_button(
                "⬇️ Download Excel", data=xlsx_res["content"], file_name=xlsx_res["filename"],
                mime=xlsx_res["mimetype"], key=f"{key_prefix}_xlsx", use_container_width=True,
            )
    except Exception:
        cols[1].caption("Excel export unavailable (install openpyxl)")


# ── Dashboard helpers (unchanged) ────────────────────────────────────────────
@st.cache_data(show_spinner="Loading dashboard…")
def _dashboard_data() -> dict:
    from src.tools.dashboard_tools import get_dashboard_summary
    return get_dashboard_summary()


@st.cache_data(show_spinner=False)
def _dashboard_charts():
    from src.tools.customer_tools import get_top_debtors
    from src.tools.sales_tools import get_top_selling_products
    debtors = get_top_debtors(limit=5)["debtors"]
    products = get_top_selling_products(limit=5)["products"]
    debtors_df = pd.DataFrame(
        [(x["customer_name"], x["outstanding_balance"]) for x in debtors],
        columns=["Customer", "Outstanding"],
    ).set_index("Customer")
    products_df = pd.DataFrame(
        [(x["product_name"], x["total_revenue"]) for x in products],
        columns=["Product", "Revenue"],
    ).set_index("Product")
    return debtors_df, products_df


def _ask(question: str) -> None:
    """Queue a quick-question for processing on the next rerun."""
    st.session_state["_pending_query"] = question


# ── Theme (Stitch "Executive Intelligence" dark mode — presentation only) ───
def _inject_theme() -> None:
    css_path = Path(__file__).parent / "assets" / "streamlit_theme.css"
    if css_path.exists():
        st.markdown(f"<style>{css_path.read_text(encoding='utf-8')}</style>", unsafe_allow_html=True)


# Friendly badge metadata per tool name. Presentation-only mapping (icon,
# label, is_alert) — never touches tool inputs/outputs. Unknown tool names
# (e.g. a future registry addition) fall back to a generic derived label.
_TOOL_BADGES = {
    "get_customer_balance": ("💰", "Customer Balance", False),
    "get_customer_summary": ("👤", "Customer Summary", False),
    "get_payment_history": ("🧾", "Payment History", False),
    "get_top_debtors": ("📉", "Top Debtors", False),
    "get_customer_statement": ("📄", "Customer Statement", False),
    "get_dashboard_summary": ("📊", "Executive Dashboard", False),
    "get_collection_priorities": ("📋", "Collection Priorities", False),
    "get_customer_insights": ("🔎", "Customer Insights", False),
    "get_product_insights": ("📦", "Product Insights", False),
    "get_business_alerts": ("🚨", "Business Alerts", True),
    "get_unpaid_invoices": ("🧾", "Unpaid Invoices", False),
    "get_overdue_invoices": ("⏰", "Overdue Invoices", False),
    "get_top_selling_products": ("🏆", "Top Products", False),
    "get_sales_summary": ("📈", "Sales Summary", False),
}


def _tool_badge_html(tool_name: str) -> str:
    icon, label, is_alert = _TOOL_BADGES.get(
        tool_name, ("🔧", tool_name.replace("get_", "").replace("_", " ").title(), False)
    )
    css_class = "xi-tool-badge xi-alert" if is_alert else "xi-tool-badge"
    return f'<span class="{css_class}">{icon} {label}</span>'


# ── Page config ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Odoo Business Intelligence Assistant",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)
_inject_theme()

QUICK_QUESTIONS = [
    {"icon": "👤", "title": "Customer Insights — Apple Mart", "question": "Customer insights for Apple Mart",
     "desc": "Full financial and behavioral profile for a single account."},
    {"icon": "📦", "title": "Product Insights — Olive Oil", "question": "Product insights for Olive Oil",
     "desc": "Performance, velocity and margin tracking for a single product."},
    {"icon": "🚨", "title": "Business Alerts", "question": "Show business alerts",
     "desc": "Critical risk and anomaly signals that need attention now."},
    {"icon": "💰", "title": "Top Debtors", "question": "Who owes us the most money?",
     "desc": "Accounts with the largest outstanding balances."},
    {"icon": "🏆", "title": "Top Products", "question": "Show top selling products",
     "desc": "Highest revenue-generating stock items, ranked."},
    {"icon": "📈", "title": "Sales Summary", "question": "Show sales summary",
     "desc": "Aggregate sales performance for the period."},
    {"icon": "📊", "title": "Dashboard", "question": "Show dashboard summary",
     "desc": "High-level KPIs and operational health at a glance."},
    {"icon": "⏰", "title": "Overdue Invoices", "question": "Show overdue invoices",
     "desc": "Aged receivables that require collection follow-up."},
    {"icon": "🧾", "title": "Unpaid Invoices", "question": "Show unpaid invoices",
     "desc": "All outstanding invoices still awaiting payment."},
]

# ── Session State ─────────────────────────────────────────────────────────────
if "messages" not in st.session_state:
    st.session_state.messages = []

# Popped once, up-front: lets the empty-state landing block (below) know a
# quick-question is about to be processed this run, avoiding a one-frame
# overlap where both the landing content and the fresh answer would show.
_pending_query = st.session_state.pop("_pending_query", None)

_backend = os.getenv("DATA_BACKEND", "mock").lower()

# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.title("📊 Odoo BI Assistant")
    st.caption("Read-only Business Intelligence & ERP Assistant")
    st.divider()

    st.markdown("**Connection**")
    st.markdown(f"- Backend: `{_backend.upper()}`")
    st.markdown("- Access: ✅ Read-Only")
    st.markdown(f"- Tools available: **{len(TOOL_REGISTRY)}**")
    st.markdown(f"- Date: {date.today().strftime('%d %b %Y')}")
    st.divider()

    st.markdown("**Quick Questions**")
    for q in QUICK_QUESTIONS:
        label = f"{q['icon']} {q['title']}"
        st.button(label, key=f"quick_{label}", use_container_width=True,
                  on_click=_ask, args=(q["question"],))

    st.divider()
    if st.button("🗑️ Clear Chat", use_container_width=True):
        st.session_state.messages = []
        st.rerun()

# ── Hero header ───────────────────────────────────────────────────────────────
st.markdown(
    """
    <div class="xi-hero">
        <div class="xi-kicker">Executive Intelligence</div>
        <h1>Odoo Business Intelligence Assistant</h1>
        <p>Read-only AI assistant for business analytics and reporting</p>
    </div>
    """,
    unsafe_allow_html=True,
)
st.markdown(
    f"""
    <div class="xi-badge-row" style="justify-content:center;">
        <span class="xi-badge">✓ Read Only</span>
        <span class="xi-badge">✓ Secure</span>
        <span class="xi-badge">✓ {'Odoo Connected' if _backend == 'odoo' else 'Mock Data'}</span>
        <span class="xi-badge">✓ GPT Powered</span>
    </div>
    """,
    unsafe_allow_html=True,
)
st.divider()

# ── Empty-state landing content (AI Assistant Home) ───────────────────────────
if not st.session_state.messages and not _pending_query:
    st.markdown("#### Quick Intelligence Actions")
    st.caption("Ask a business question above, or start from one of these.")
    grid_cols = st.columns(3)
    for i, q in enumerate(QUICK_QUESTIONS):
        with grid_cols[i % 3]:
            with st.container(border=True):
                st.markdown(f"##### {q['icon']} {q['title']}")
                st.caption(q["desc"])
                st.button("Ask →", key=f"qi_card_{i}", use_container_width=True,
                          on_click=_ask, args=(q["question"],))
    st.divider()

# ── Executive Dashboard ───────────────────────────────────────────────────────
with st.expander("📊 Executive Dashboard", expanded=False):
    if st.button("Load / Refresh Dashboard", key="dash_refresh"):
        _dashboard_data.clear()
        _dashboard_charts.clear()
        st.session_state["show_dashboard"] = True
    if st.session_state.get("show_dashboard"):
        d = _dashboard_data()
        r1 = st.columns(4)
        kpi_row1 = [
            ("Total Revenue", f"QAR {d['total_revenue']:,.0f}"),
            ("Receivables", f"QAR {d['outstanding_receivables']:,.0f}"),
            ("Total Overdue", f"QAR {d['total_overdue']:,.0f}"),
            ("Avg Txn", f"QAR {d['avg_transaction']:,.0f}"),
        ]
        for col, (label, value) in zip(r1, kpi_row1):
            with col, st.container(border=True):
                st.metric(label, value)
        r2 = st.columns(4)
        kpi_row2 = [
            ("Open Invoices", d["open_invoice_count"]),
            ("Overdue Invoices", d["overdue_invoice_count"]),
            ("Customers", d["customer_count"]),
            ("Products", d["product_count"]),
        ]
        for col, (label, value) in zip(r2, kpi_row2):
            with col, st.container(border=True):
                st.metric(label, value)
        if d["top_debtor"]:
            st.caption(
                f"**Top Debtor:** {d['top_debtor']['customer_name']} — "
                f"QAR {d['top_debtor']['outstanding_balance']:,.2f}"
            )
        if d["top_product"]:
            st.caption(
                f"**Top Product:** {d['top_product']['product_name']} — "
                f"QAR {d['top_product']['total_revenue']:,.2f}"
            )
        st.divider()
        debtors_df, products_df = _dashboard_charts()
        ch = st.columns(2)
        ch[0].caption("Top 5 Debtors (Outstanding)")
        ch[0].bar_chart(debtors_df, color="#4EDEA3")
        ch[1].caption("Top 5 Products (Revenue)")
        ch[1].bar_chart(products_df, color="#4EDEA3")

st.divider()

# ── Chat History ──────────────────────────────────────────────────────────────
for idx, msg in enumerate(st.session_state.messages):
    with st.chat_message(msg["role"]):
        has_tool = (
            msg["role"] == "assistant" and msg.get("tool") and msg["tool"] not in ("assistant", None)
        )
        if has_tool:
            st.markdown(_tool_badge_html(msg["tool"]), unsafe_allow_html=True)
            with st.container(border=True):
                st.markdown(msg["content"])
                if msg.get("tool") == "get_customer_statement" and msg.get("customer_name"):
                    _render_statement_downloads(msg["customer_name"], f"hist_{idx}")
        else:
            st.markdown(msg["content"])
    st.write("")  # small spacer between turns

# ── Chat Input ────────────────────────────────────────────────────────────────
typed_input = st.chat_input("Ask a business question...")
user_input = typed_input or _pending_query

if user_input:
    # Store and display user message
    st.session_state.messages.append({"role": "user", "content": user_input})
    with st.chat_message("user"):
        st.markdown(user_input)

    # Route and respond
    with st.chat_message("assistant"):
        tool_name = "unknown"
        params: dict = {}
        result = ""
        had_error = False

        with st.status("Thinking…", expanded=False) as status:
            try:
                status.update(label="Calling tools & generating response…", state="running")
                # Pass prior turns only (exclude the just-appended current message).
                # Memory is lightweight text; ERP data still comes from a fresh tool call.
                history = _build_history(st.session_state.messages[:-1])
                response = route_query(user_input, history)
                tool_name = response.get("tool", "unknown")
                params = response.get("parameters", {})
                result = response.get("result", "")
                status.update(label="Finished", state="complete")
            except Exception:
                had_error = True
                status.update(label="Something went wrong", state="error")

        if had_error:
            st.error(
                "⚠️ Something went wrong while processing your request. "
                "Please try again or rephrase your question."
            )
            result = (
                "Sorry, I couldn't process that request. Please try again "
                "or rephrase your question."
            )
            tool_name = None
        else:
            if tool_name and tool_name not in ("assistant", None):
                st.markdown(_tool_badge_html(tool_name), unsafe_allow_html=True)
            if params:
                param_str = " | ".join(f"`{k}`: {v}" for k, v in params.items() if v is not None)
                if param_str:
                    st.caption(f"Parameters: {param_str}")

            with st.container(border=True):
                st.markdown(result)
                if tool_name == "get_customer_statement":
                    _render_statement_downloads(
                        params.get("customer_name"), f"cur_{len(st.session_state.messages)}"
                    )

    st.session_state.messages.append({
        "role": "assistant",
        "content": result,
        "tool": tool_name,
        "customer_name": params.get("customer_name") if tool_name == "get_customer_statement" else None,
    })
