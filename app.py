import html as html_lib
import os
import re
from datetime import date, datetime
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


# ── Dashboard data helpers (same tool calls as before — read-only) ──────────
@st.cache_data(show_spinner="Loading dashboard…")
def _dashboard_data() -> dict:
    from src.tools.dashboard_tools import get_dashboard_summary
    return get_dashboard_summary()


@st.cache_data(show_spinner=False)
def _dashboard_lists() -> tuple[list, list]:
    from src.tools.customer_tools import get_top_debtors
    from src.tools.sales_tools import get_top_selling_products
    debtors = get_top_debtors(limit=5)["debtors"]
    products = get_top_selling_products(limit=5)["products"]
    return debtors, products


def _ask(question: str) -> None:
    """Queue a quick-question for processing on the next rerun."""
    st.session_state["_pending_query"] = question


def _nav_view(idx: int, view: str) -> None:
    st.session_state["nav_active"] = idx
    st.session_state["view"] = view


def _nav_ask(idx: int, question: str) -> None:
    st.session_state["nav_active"] = idx
    st.session_state["view"] = "assistant"
    _ask(question)


# ── Theme (Stitch "Executive Intelligence" — presentation only) ─────────────
def _inject_theme() -> None:
    css_path = Path(__file__).parent / "assets" / "streamlit_theme.css"
    if css_path.exists():
        st.markdown(f"<style>{css_path.read_text(encoding='utf-8')}</style>", unsafe_allow_html=True)


def _esc(value) -> str:
    """Escape a dynamic value for safe embedding in our HTML blocks."""
    return html_lib.escape(str(value))


def _ms(icon: str, extra: str = "") -> str:
    return f'<span class="msym {extra}">{icon}</span>'


def _initials(name: str) -> str:
    parts = [p for p in re.split(r"\s+", name.strip()) if p]
    if not parts:
        return "?"
    return (parts[0][0] + (parts[1][0] if len(parts) > 1 else "")).upper()


def _fmt_qar(value: float) -> str:
    return f"QAR {value:,.0f}"


# ── Markdown → structured parsers (presentation only; fall back to raw md) ──
def _md_table_pairs(md: str) -> dict[str, str] | None:
    """Parse a 2-column markdown metric table into {label: value}."""
    pairs: dict[str, str] = {}
    for line in md.splitlines():
        m = re.match(r"^\|\s*(.+?)\s*\|\s*(.+?)\s*\|$", line.strip())
        if not m:
            continue
        label, value = m.group(1), m.group(2)
        if set(label) <= {"-", " "} or label.lower() in ("metric", "field"):
            continue
        clean = lambda s: s.replace("**", "").replace("`", "").strip()
        pairs[clean(label)] = clean(value)
    return pairs or None


def _parse_alerts(md: str) -> dict | None:
    """Parse format_business_alerts output into structured alerts."""
    total_m = re.search(r"\*\*Total Alerts:\*\*\s*(\d+)", md)
    sections = re.split(r"^###\s+", md, flags=re.M)[1:]
    if not sections:
        return None
    alerts = []
    for sec in sections:
        lines = sec.splitlines()
        head = re.match(r"\d+\.\s*\[(\w+)\]\s*(.+)", lines[0].strip())
        if not head:
            return None
        risk, title = head.group(1), head.group(2)
        type_m = re.search(r"\*\*Type:\*\*\s*(.+)", sec)
        action_m = re.search(r"\*\*Recommended Action:\*\*\s*(.+)", sec)
        details = [ln.strip()[2:].strip() for ln in lines if ln.strip().startswith("- ")]
        alerts.append({
            "risk": risk, "title": title,
            "type": type_m.group(1).strip() if type_m else "",
            "action": action_m.group(1).strip() if action_m else "",
            "details": details,
        })
    return {"total": total_m.group(1) if total_m else str(len(alerts)), "alerts": alerts}


# ── HTML renderers for tool results (Stitch layouts) ─────────────────────────
_SEV_CLASSES = {"critical": "critical", "high": "high", "medium": "medium", "low": "low"}


def _alerts_html(md: str) -> str | None:
    parsed = _parse_alerts(md)
    if not parsed:
        return None
    out = [
        '<div class="xi-sect" style="margin-top:0.2rem">'
        '<span class="t">Intelligent Business Alerts</span>'
        f'<span class="xi-chip err">{_esc(parsed["total"])} ACTIVE</span></div>',
        '<div class="xi-alert-grid">',
    ]
    for i, a in enumerate(parsed["alerts"]):
        sev = _SEV_CLASSES.get(a["risk"].lower(), "low")
        wide = " wide" if i == 0 else ""
        stats, notes = [], []
        for d in a["details"]:
            if ":" in d:
                label, _, value = d.partition(":")
                stats.append(
                    f'<div class="xi-statbox"><div class="xcaps dim">{_esc(label)}</div>'
                    f'<div class="v">{_esc(value.strip())}</div></div>'
                )
            else:
                notes.append(f'<div style="font-size:0.84rem;margin:0.3rem 0">{_esc(d)}</div>')
        action = (
            f'<div class="xi-action-box">{_ms("psychology")}<div>'
            f'<div class="xcaps pri" style="margin-bottom:2px">AI Recommended Action</div>'
            f'<div class="txt">&ldquo;{_esc(a["action"])}&rdquo;</div></div></div>'
            if a["action"] else ""
        )
        out.append(
            f'<div class="xi-acard{wide}"><div class="xi-strip {sev}"></div><div class="body">'
            f'<div class="toprow"><div><span class="xi-sev {sev}">{_esc(a["risk"])}</span>'
            f'<div class="title">{_esc(a["title"])}</div></div>'
            f'<span class="xcaps dim">{_esc(a["type"])}</span></div>'
            f'<div class="xi-statgrid">{"".join(stats)}</div>{"".join(notes)}{action}'
            f'</div></div>'
        )
    out.append("</div>")
    return "".join(out)


def _customer_html(md: str) -> str | None:
    name_m = re.search(r"^##\s*Customer Insights:\s*(.+)$", md, flags=re.M)
    pairs = _md_table_pairs(md)
    if not name_m or not pairs:
        return None
    required = ("Lifetime Revenue", "Outstanding Balance", "Overdue Amount", "Risk Level")
    if any(k not in pairs for k in required):
        return None
    name = name_m.group(1).strip()
    risk = pairs["Risk Level"]
    risk_cls = _SEV_CLASSES.get(risk.lower(), "medium")
    overdue_is_zero = re.sub(r"[^\d.]", "", pairs["Overdue Amount"]) in ("", "0", "0.00")

    def kpi(label, value, icon, tile="", val_cls=""):
        return (
            f'<div class="xi-kpi"><div class="head"><span class="xcaps dim">{label}</span>'
            f'<span class="xi-tile {tile}" style="width:32px;height:32px">{_ms(icon, "sm")}</span></div>'
            f'<div class="val {val_cls}">{_esc(value)}</div></div>'
        )

    def metric(label, key):
        return (
            f'<div class="xi-metric"><div class="xcaps dim">{label}</div>'
            f'<div class="mv">{_esc(pairs.get(key, "—"))}</div></div>'
        )

    def datebox(label, key):
        return (
            f'<div class="xi-datebox"><div class="xcaps dim">{label}</div>'
            f'<div class="dv">{_esc(pairs.get(key, "—"))}</div></div>'
        )

    action_html = ""
    if pairs.get("Recommended Action"):
        action_html = (
            f'<div class="xi-action-box" style="margin-top:0.9rem">{_ms("auto_awesome")}<div>'
            f'<div class="xcaps pri" style="margin-bottom:2px">Recommended Action</div>'
            f'<div class="txt">{_esc(pairs["Recommended Action"])}</div></div></div>'
        )

    return (
        f'<div class="xi-cust-head"><div class="l">'
        f'<span class="xi-init" style="width:44px;height:44px;font-size:0.9rem">{_esc(_initials(name))}</span>'
        f'<div><div class="xcaps dim">Customers &rsaquo; Profile</div>'
        f'<div class="nm">{_esc(name)}</div></div></div>'
        f'<span class="xi-pill {risk_cls}">{_esc(risk)} risk</span></div>'
        f'<div class="xi-kpi-grid">'
        + kpi("Lifetime Revenue", pairs["Lifetime Revenue"], "payments")
        + kpi("Outstanding Balance", pairs["Outstanding Balance"], "account_balance_wallet", "sec")
        + kpi("Overdue Amount", pairs["Overdue Amount"], "warning", "err",
              "" if overdue_is_zero else "err")
        + kpi("Risk Level", risk, "verified_user", "",
              "pri" if risk_cls == "low" else ("err" if risk_cls in ("high", "critical") else ""))
        + "</div>"
        f'<div style="background:var(--surface-container-lowest);border:1px solid var(--outline-variant);'
        f'border-radius:12px;padding:1.1rem 1.3rem">'
        f'<div class="xi-card-h"><span class="t">Performance Metrics</span>'
        f'<span class="xcaps dim">Live ERP data</span></div>'
        f'<div class="xi-metrics">'
        + metric("Total Invoices", "Total Invoices")
        + metric("Total Payments", "Total Payments")
        + metric("Avg Order Value", "Average Order Value")
        + metric("Purchase Frequency", "Purchase Frequency")
        + "</div>"
        f'<div class="xi-dates">'
        + datebox("First Purchase Date", "First Purchase Date")
        + datebox("Last Purchase Date", "Last Purchase Date")
        + datebox("Days Since Last Purchase", "Days Since Last Purchase")
        + "</div></div>" + action_html
    )


def _dash_summary_html(md: str) -> str | None:
    pairs = _md_table_pairs(md)
    if not pairs:
        return None
    required = ("Total Revenue", "Outstanding Receivables", "Total Overdue")
    if any(k not in pairs for k in required):
        return None

    def kpi(label, value, icon, tile="", val_cls="", chip=""):
        return (
            f'<div class="xi-kpi"><div class="head">'
            f'<span class="xi-tile {tile}" style="width:34px;height:34px">{_ms(icon, "sm")}</span>{chip}</div>'
            f'<div class="xcaps dim" style="margin-bottom:3px">{label}</div>'
            f'<div class="val {val_cls}">{_esc(value)}</div></div>'
        )

    def slim(label, key, icon):
        return (
            f'<div class="xi-slim">{_ms(icon)}<div><div class="xcaps dim">{label}</div>'
            f'<div class="num">{_esc(pairs.get(key, "—"))}</div></div></div>'
        )

    overdue_zero = re.sub(r"[^\d.]", "", pairs["Total Overdue"]) in ("", "0", "0.00")
    chip = "" if overdue_zero else '<span class="xi-chip err">Critical</span>'
    rows = ""
    for label, icon in (("Top Debtor", "person_search"), ("Top Product", "stars")):
        if pairs.get(label):
            rows += (
                f'<div class="xi-listrow"><div class="l">'
                f'<span class="xi-init">{_ms(icon, "sm")}</span>'
                f'<div><div class="xcaps dim">{label}</div>'
                f'<div class="name">{_esc(pairs[label])}</div></div></div></div>'
            )
    return (
        '<div class="xi-sect" style="margin-top:0.2rem"><span class="t">Executive Dashboard</span>'
        '<span class="xcaps pri">Live Snapshot</span></div>'
        '<div class="xi-kpi-grid">'
        + kpi("Total Revenue", pairs["Total Revenue"], "payments")
        + kpi("Outstanding Receivables", pairs["Outstanding Receivables"], "account_balance_wallet", "sec")
        + kpi("Total Overdue", pairs["Total Overdue"], "priority_high", "err",
              "" if overdue_zero else "err", chip)
        + kpi("Avg Transaction", pairs.get("Avg. Transaction Value", "—"), "trending_up")
        + "</div><div class='xi-slim-grid'>"
        + slim("Open Invoices", "Open Invoices", "receipt_long")
        + slim("Overdue Invoices", "Overdue Invoices", "pending_actions")
        + slim("Customers", "Customers", "group")
        + slim("Products", "Products", "inventory_2")
        + "</div>" + rows
    )


# Friendly badge metadata per tool name (presentation-only mapping).
_TOOL_BADGES = {
    "get_customer_balance": ("payments", "Customer Balance", False),
    "get_customer_summary": ("person", "Customer Summary", False),
    "get_payment_history": ("receipt_long", "Payment History", False),
    "get_top_debtors": ("person_search", "Top Debtors", False),
    "get_customer_statement": ("description", "Customer Statement", False),
    "get_dashboard_summary": ("dashboard", "Executive Dashboard", False),
    "get_collection_priorities": ("checklist", "Collection Priorities", False),
    "get_customer_insights": ("query_stats", "Customer Insights", False),
    "get_product_insights": ("inventory_2", "Product Insights", False),
    "get_business_alerts": ("notifications_active", "Business Alerts", True),
    "get_unpaid_invoices": ("receipt", "Unpaid Invoices", False),
    "get_overdue_invoices": ("pending_actions", "Overdue Invoices", False),
    "get_top_selling_products": ("stars", "Top Products", False),
    "get_sales_summary": ("trending_up", "Sales Summary", False),
}


def _tool_badge_html(tool_name: str) -> str:
    icon, label, is_alert = _TOOL_BADGES.get(
        tool_name, ("build", tool_name.replace("get_", "").replace("_", " ").title(), False)
    )
    css_class = "xi-tool-badge xi-alert" if is_alert else "xi-tool-badge"
    return f'<span class="{css_class}">{_ms(icon, "sm")} {label}</span>'


def _render_assistant_result(tool_name: str, result: str, params: dict, key_prefix: str) -> None:
    """Render a tool result using the Stitch layout for known tools, else a card."""
    custom = None
    if tool_name == "get_business_alerts":
        custom = _alerts_html(result)
    elif tool_name == "get_customer_insights":
        custom = _customer_html(result)
    elif tool_name == "get_dashboard_summary":
        custom = _dash_summary_html(result)

    if custom:
        st.markdown(custom, unsafe_allow_html=True)
    else:
        with st.container(key=f"res_{key_prefix}"):
            st.markdown(result)
    if tool_name == "get_customer_statement" and params.get("customer_name"):
        _render_statement_downloads(params["customer_name"], key_prefix)


# ── Page config ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Executive Intelligence — Odoo BI Assistant",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)
_inject_theme()

# ── Static content maps ───────────────────────────────────────────────────────
NAV_ITEMS = [
    (":material/auto_awesome:", "AI Assistant", ("view", "assistant")),
    (":material/dashboard:", "Dashboard", ("view", "dashboard")),
    (":material/query_stats:", "Customer Insights", ("ask", "Customer insights for Apple Mart")),
    (":material/inventory_2:", "Product Insights", ("ask", "Product insights for Olive Oil")),
    (":material/notifications_active:", "Business Alerts", ("ask", "Show business alerts")),
    (":material/payments:", "Sales", ("ask", "Show sales summary")),
    (":material/group:", "Customers", ("ask", "Who owes us the most money?")),
    (":material/shopping_cart:", "Products", ("ask", "Show top selling products")),
    (":material/receipt_long:", "Invoices", ("ask", "Show unpaid invoices")),
    (":material/pending_actions:", "Overdue", ("ask", "Show overdue invoices")),
]

QUICK_ACTIONS = [
    {"icon": "dashboard", "tint": "", "title": "Dashboard Summary",
     "desc": "A high-level view of current KPIs and operational health.",
     "q": "Show dashboard summary"},
    {"icon": "query_stats", "tint": "sec", "title": "Customer Insights",
     "desc": "Financial and behavioral profile for a single account.",
     "q": "Customer insights for Apple Mart"},
    {"icon": "inventory_2", "tint": "", "title": "Product Insights",
     "desc": "Top performers, stock velocity, and margin tracking.",
     "q": "Product insights for Olive Oil"},
    {"icon": "notifications_active", "tint": "err", "title": "Business Alerts",
     "desc": "Critical notifications requiring executive attention now.",
     "q": "Show business alerts"},
    {"icon": "person_search", "tint": "neu", "title": "Top Debtors",
     "desc": "Identify accounts with significant outstanding balances.",
     "q": "Who owes us the most money?"},
    {"icon": "trending_up", "tint": "", "title": "Sales Summary",
     "desc": "Aggregate growth and period performance data.",
     "q": "Show sales summary"},
    {"icon": "receipt", "tint": "neu", "title": "Unpaid Invoices",
     "desc": "View all outstanding invoices waiting for clearance.",
     "q": "Show unpaid invoices"},
    {"icon": "pending_actions", "tint": "err", "title": "Overdue Invoices",
     "desc": "Priority collection list for aged receivables.",
     "q": "Show overdue invoices"},
    {"icon": "stars", "tint": "", "title": "Top Products",
     "desc": "Ranked list of highest revenue-generating stock items.",
     "q": "Show top selling products"},
]

# ── Session State ─────────────────────────────────────────────────────────────
if "messages" not in st.session_state:
    st.session_state.messages = []
st.session_state.setdefault("view", "assistant")
st.session_state.setdefault("nav_active", 0)

# Popped once, up-front: lets the empty-state landing block know a
# quick-question is about to be processed this run.
_pending_query = st.session_state.pop("_pending_query", None)
if _pending_query:
    st.session_state["view"] = "assistant"

_backend = os.getenv("DATA_BACKEND", "mock").lower()
_backend_label = "ODOO CONNECTED" if _backend == "odoo" else "MOCK DATA"

# ── Sidebar → Stitch SideNavBar ──────────────────────────────────────────────
with st.sidebar:
    st.markdown(
        '<div class="xi-brand"><h1>Executive<br>Intelligence</h1>'
        '<span class="xcaps pri">AI BI Assistant</span></div>',
        unsafe_allow_html=True,
    )
    st.markdown('<div style="height:0.9rem"></div>', unsafe_allow_html=True)

    for i, (icon, label, action) in enumerate(NAV_ITEMS):
        kind, target = action
        if kind == "view":
            st.button(f"{icon} {label}", key=f"nav_{i}", use_container_width=True,
                      on_click=_nav_view, args=(i, target))
        else:
            st.button(f"{icon} {label}", key=f"nav_{i}", use_container_width=True,
                      on_click=_nav_ask, args=(i, target))

    _active = st.session_state["nav_active"]
    st.markdown(
        f"<style>[class*='st-key-nav_{_active}'] button {{"
        f"background: var(--primary-container) !important; color: #06301f !important;"
        f"font-weight: 600 !important; }}"
        f"[class*='st-key-nav_{_active}'] button:hover {{ transform: none; }}"
        f"[class*='st-key-nav_{_active}'] button p {{ color: #06301f !important; }}</style>",
        unsafe_allow_html=True,
    )

    st.markdown(
        f'<div class="xi-side-foot">'
        f'<div class="row"><span class="msym">hub</span><span class="xcaps dim">{_backend_label}</span></div>'
        f'<div class="row"><span class="msym">lock</span><span class="xcaps dim">Read-Only Access</span></div>'
        f'<div class="row on"><span class="msym">check_circle</span><span class="xcaps">Connection Status</span></div>'
        f'<div class="row"><span class="msym">build</span>'
        f'<span class="xcaps dim">{len(TOOL_REGISTRY)} tools &middot; {date.today().strftime("%d %b %Y")}</span></div>'
        f'</div>',
        unsafe_allow_html=True,
    )
    if st.button("Clear conversation", key="clear_chat", use_container_width=True):
        st.session_state.messages = []
        st.rerun()

# ── Top bar ───────────────────────────────────────────────────────────────────
st.markdown(
    f'<div class="xi-topbar">'
    f'<span class="item"><span class="xi-dot"></span><span class="xcaps dim">Backend &middot; {_backend_label}</span></span>'
    f'<span class="item"><span class="msym sm" style="color:var(--outline)">lock</span><span class="xcaps dim">Read-Only</span></span>'
    f'<span class="item"><span class="msym sm" style="color:var(--primary)">check_circle</span><span class="xcaps pri">Operational</span></span>'
    f'</div>',
    unsafe_allow_html=True,
)


# ── Executive Dashboard view ──────────────────────────────────────────────────
def _render_dashboard_view() -> None:
    head_l, head_r = st.columns([4, 1])
    with head_l:
        st.markdown(
            '<div class="xi-sect" style="margin-bottom:0.2rem"><span class="t" style="font-size:1.7rem">'
            'Dashboard Overview</span></div>'
            '<div class="sub" style="color:var(--on-surface-variant);font-size:0.88rem">'
            'Real-time performance metrics from the ERP backend.</div>',
            unsafe_allow_html=True,
        )
    with head_r:
        if st.button(":material/refresh: Refresh", key="dash_refresh", type="primary",
                     use_container_width=True):
            _dashboard_data.clear()
            _dashboard_lists.clear()

    d = _dashboard_data()
    debtors, products = _dashboard_lists()

    overdue_zero = d["total_overdue"] == 0
    overdue_chip = "" if overdue_zero else '<span class="xi-chip err">Critical</span>'
    st.markdown(
        '<div style="height:1.1rem"></div>'
        '<div class="xi-kpi-grid">'
        # Total Revenue
        f'<div class="xi-kpi"><div class="head"><span class="xi-tile">{_ms("payments")}</span></div>'
        f'<div class="xcaps dim" style="margin-bottom:3px">Total Revenue</div>'
        f'<div class="val">{_esc(_fmt_qar(d["total_revenue"]))}</div>'
        f'<div class="sub">{d["customer_count"]} customers &middot; {d["product_count"]} products</div></div>'
        # Outstanding
        f'<div class="xi-kpi"><div class="head"><span class="xi-tile sec">{_ms("account_balance_wallet")}</span></div>'
        f'<div class="xcaps dim" style="margin-bottom:3px">Outstanding Balance</div>'
        f'<div class="val">{_esc(_fmt_qar(d["outstanding_receivables"]))}</div>'
        f'<div class="sub">{d["open_invoice_count"]} invoices pending</div></div>'
        # Overdue
        f'<div class="xi-kpi warn"><div class="head"><span class="xi-tile err">{_ms("priority_high")}</span>'
        f'{overdue_chip}</div>'
        f'<div class="xcaps dim" style="margin-bottom:3px">Overdue Balance</div>'
        f'<div class="val{"" if overdue_zero else " err"}">{_esc(_fmt_qar(d["total_overdue"]))}</div>'
        f'<div class="sub{"" if overdue_zero else " err"}">{d["overdue_invoice_count"]} invoices overdue</div></div>'
        # Avg txn
        f'<div class="xi-kpi"><div class="head"><span class="xi-tile">{_ms("trending_up")}</span></div>'
        f'<div class="xcaps dim" style="margin-bottom:3px">Avg Transaction</div>'
        f'<div class="val">{_esc(_fmt_qar(d["avg_transaction"]))}</div>'
        f'<div class="sub">Per sale average</div></div>'
        '</div>'
        # Slim row
        '<div class="xi-slim-grid">'
        f'<div class="xi-slim">{_ms("receipt_long")}<div><div class="xcaps dim">Open Invoices</div>'
        f'<div class="num">{d["open_invoice_count"]}</div></div></div>'
        f'<div class="xi-slim">{_ms("pending_actions")}<div><div class="xcaps dim">Overdue Invoices</div>'
        f'<div class="num">{d["overdue_invoice_count"]}</div></div></div>'
        f'<div class="xi-slim">{_ms("group")}<div><div class="xcaps dim">Customers</div>'
        f'<div class="num">{d["customer_count"]}</div></div></div>'
        f'<div class="xi-slim">{_ms("inventory_2")}<div><div class="xcaps dim">Products</div>'
        f'<div class="num">{d["product_count"]}</div></div></div>'
        '</div>',
        unsafe_allow_html=True,
    )

    # Charts row: Revenue by product (2/3) + Top debtors list (1/3)
    c1, c2 = st.columns([2, 1])
    with c1:
        with st.container(key="chart_products"):
            st.markdown(
                '<div class="xi-card-h"><div><span class="t">Revenue by Product</span></div>'
                '<span class="xcaps"><span class="xi-dot" style="margin-right:5px"></span>Top 5 · Revenue</span></div>',
                unsafe_allow_html=True,
            )
            products_df = pd.DataFrame(
                [(x["product_name"], x["total_revenue"]) for x in products],
                columns=["Product", "Revenue"],
            ).set_index("Product")
            st.bar_chart(products_df, color="#4EDEA3", height=300)
    with c2:
        rows = "".join(
            f'<div class="xi-listrow"><div class="l">'
            f'<span class="xi-init">{_esc(_initials(x["customer_name"]))}</span>'
            f'<div><div class="name">{_esc(x["customer_name"])}</div>'
            f'<div class="xcaps dim">Outstanding</div></div></div>'
            f'<div class="amt">{_esc(_fmt_qar(x["outstanding_balance"]))}</div></div>'
            for x in debtors
        )
        st.markdown(
            f'<div style="background:var(--surface-container-lowest);border:1px solid var(--outline-variant);'
            f'border-radius:12px;padding:1.2rem 1.3rem;height:100%">'
            f'<div class="xi-card-h"><div><span class="t">Top Debtors</span></div>'
            f'<span class="xcaps dim">High exposure</span></div>{rows}</div>',
            unsafe_allow_html=True,
        )

    # Second charts row: receivables by customer
    with st.container(key="chart_debtors"):
        st.markdown(
            '<div class="xi-card-h"><div><span class="t">Receivables by Customer</span></div>'
            '<span class="xcaps"><span class="xi-dot" style="margin-right:5px"></span>Top 5 · Outstanding</span></div>',
            unsafe_allow_html=True,
        )
        debtors_df = pd.DataFrame(
            [(x["customer_name"], x["outstanding_balance"]) for x in debtors],
            columns=["Customer", "Outstanding"],
        ).set_index("Customer")
        st.bar_chart(debtors_df, color="#4EDEA3", height=280)


# ── Assistant view ────────────────────────────────────────────────────────────
def _render_hero_and_actions() -> None:
    hour = datetime.now().hour
    greet = "Good Morning" if hour < 12 else ("Good Afternoon" if hour < 18 else "Good Evening")
    st.markdown(
        f'<div class="xi-hero"><span class="xcaps pri">Executive Intelligence &middot; AI BI Assistant</span>'
        f'<div class="headline">{greet}. What would you like to know about your business today?</div>'
        f'<div class="xcaps dim" style="margin-top:0.9rem">Ask in the command bar below &middot; or run a quick action</div>'
        f'</div>',
        unsafe_allow_html=True,
    )
    st.markdown(
        '<div class="xi-sect"><span class="t">Quick Intelligence Actions</span>'
        '<span class="xcaps pri">9 Live Queries</span></div>',
        unsafe_allow_html=True,
    )
    cols = st.columns(3)
    for i, qa in enumerate(QUICK_ACTIONS):
        with cols[i % 3]:
            with st.container(key=f"qa_{i}"):
                st.markdown(
                    f'<div class="xi-qhead"><span class="xi-tile {qa["tint"]}">{_ms(qa["icon"])}</span>'
                    f'<span class="msym arr">arrow_forward</span></div>'
                    f'<div class="xi-qtitle">{qa["title"]}</div>'
                    f'<div class="xi-qdesc">{qa["desc"]}</div>',
                    unsafe_allow_html=True,
                )
                st.button("Run query →", key=f"qab_{i}", use_container_width=True,
                          on_click=_ask, args=(qa["q"],))


def _render_history() -> None:
    for idx, msg in enumerate(st.session_state.messages):
        if msg["role"] == "user":
            st.markdown(
                f'<div class="xi-userq">{_ms("person", "sm")} {_esc(msg["content"])}</div>',
                unsafe_allow_html=True,
            )
        else:
            tool = msg.get("tool")
            if tool and tool not in ("assistant", "unknown"):
                st.markdown(_tool_badge_html(tool), unsafe_allow_html=True)
                _render_assistant_result(tool, msg["content"],
                                         {"customer_name": msg.get("customer_name")}, f"hist_{idx}")
            else:
                with st.container(key=f"res_hist_{idx}"):
                    st.markdown(msg["content"])


# ── View dispatch ─────────────────────────────────────────────────────────────
_view_was_dashboard = st.session_state["view"] == "dashboard"
if _view_was_dashboard:
    _render_dashboard_view()
else:
    if not st.session_state.messages and not _pending_query:
        _render_hero_and_actions()
    else:
        _render_history()

# ── Command bar (docked) ─────────────────────────────────────────────────────
typed_input = st.chat_input("Ask anything about your business...")
user_input = typed_input or _pending_query

if user_input:
    st.session_state["view"] = "assistant"
    st.session_state["nav_active"] = 0
    st.session_state.messages.append({"role": "user", "content": user_input})

    st.markdown(
        f'<div class="xi-userq">{_ms("person", "sm")} {_esc(user_input)}</div>',
        unsafe_allow_html=True,
    )

    tool_name = "unknown"
    params: dict = {}
    result = ""
    had_error = False

    with st.status("Analyzing…", expanded=False) as status:
        try:
            status.update(label="Calling tools & generating response…", state="running")
            # Pass prior turns only (exclude the just-appended current message).
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
        if tool_name and tool_name not in ("assistant", None, "unknown"):
            st.markdown(_tool_badge_html(tool_name), unsafe_allow_html=True)
        param_str = " · ".join(f"{k}: {v}" for k, v in params.items() if v is not None)
        if param_str:
            st.markdown(f'<div class="xi-params">{_esc(param_str)}</div>', unsafe_allow_html=True)
        _render_assistant_result(tool_name, result, params,
                                 f"cur_{len(st.session_state.messages)}")

    st.session_state.messages.append({
        "role": "assistant",
        "content": result,
        "tool": tool_name,
        "customer_name": params.get("customer_name") if tool_name == "get_customer_statement" else None,
    })
    if _view_was_dashboard:
        st.rerun()
