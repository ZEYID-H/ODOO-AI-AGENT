import os
from datetime import date

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


# ── Page config ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Odoo Business Intelligence Assistant",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)

QUICK_QUESTIONS = [
    ("👤 Customer Insights — Apple Mart", "Customer insights for Apple Mart"),
    ("📦 Product Insights — Olive Oil", "Product insights for Olive Oil"),
    ("🚨 Business Alerts", "Show business alerts"),
    ("💰 Top Debtors", "Who owes us the most money?"),
    ("🏆 Top Products", "Show top selling products"),
    ("📈 Sales Summary", "Show sales summary"),
    ("📊 Dashboard", "Show dashboard summary"),
    ("⏰ Overdue Invoices", "Show overdue invoices"),
    ("🧾 Unpaid Invoices", "Show unpaid invoices"),
]

HOME_CAPABILITIES = [
    "Customer Insights", "Product Insights", "Business Alerts", "Top Debtors",
    "Sales Summary", "Unpaid Invoices", "Dashboard Summary",
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
    for label, question in QUICK_QUESTIONS:
        st.button(label, key=f"quick_{label}", use_container_width=True,
                  on_click=_ask, args=(question,))

    st.divider()
    if st.button("🗑️ Clear Chat", use_container_width=True):
        st.session_state.messages = []
        st.rerun()

# ── Hero header ───────────────────────────────────────────────────────────────
st.title("Odoo Business Intelligence Assistant")
st.caption("Read-only AI assistant for business analytics and reporting")

badge_cols = st.columns(4)
badge_cols[0].markdown("✅ **Read Only**")
badge_cols[1].markdown("✅ **Secure**")
badge_cols[2].markdown(f"✅ **{'Odoo Connected' if _backend == 'odoo' else 'Mock Data'}**")
badge_cols[3].markdown("✅ **GPT Powered**")
st.divider()

# ── Empty-state capability overview (landing content) ────────────────────────
if not st.session_state.messages and not _pending_query:
    st.markdown("#### Ask a business question, or try one of these:")
    cap_cols = st.columns(4)
    for i, cap in enumerate(HOME_CAPABILITIES):
        cap_cols[i % 4].markdown(f"- {cap}")
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
        r1[0].metric("Total Revenue", f"QAR {d['total_revenue']:,.0f}")
        r1[1].metric("Receivables", f"QAR {d['outstanding_receivables']:,.0f}")
        r1[2].metric("Total Overdue", f"QAR {d['total_overdue']:,.0f}")
        r1[3].metric("Avg Txn", f"QAR {d['avg_transaction']:,.0f}")
        r2 = st.columns(4)
        r2[0].metric("Open Invoices", d["open_invoice_count"])
        r2[1].metric("Overdue Invoices", d["overdue_invoice_count"])
        r2[2].metric("Customers", d["customer_count"])
        r2[3].metric("Products", d["product_count"])
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
        ch[0].bar_chart(debtors_df)
        ch[1].caption("Top 5 Products (Revenue)")
        ch[1].bar_chart(products_df)

st.divider()

# ── Chat History ──────────────────────────────────────────────────────────────
for idx, msg in enumerate(st.session_state.messages):
    with st.chat_message(msg["role"]):
        if msg["role"] == "assistant" and msg.get("tool") and msg["tool"] not in ("assistant", None):
            st.caption(f"🔧 Tool called: `{msg['tool']}`")
        st.markdown(msg["content"])
        if msg.get("tool") == "get_customer_statement" and msg.get("customer_name"):
            _render_statement_downloads(msg["customer_name"], f"hist_{idx}")
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
                st.caption(f"🔧 Tool called: `{tool_name}`")
            if params:
                param_str = " | ".join(f"`{k}`: {v}" for k, v in params.items() if v is not None)
                if param_str:
                    st.caption(f"Parameters: {param_str}")

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
