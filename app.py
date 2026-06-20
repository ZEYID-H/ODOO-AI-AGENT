import streamlit as st
from src.agent.router import route_query


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


st.set_page_config(
    page_title="Odoo AI Agent",
    page_icon=None,
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Sidebar ──────────────────────────────────────────────────────────────────
with st.sidebar:
    st.title("Odoo AI Agent")
    st.caption("Business Intelligence & ERP Assistant")
    st.divider()

    st.markdown("**Phase 1** — Mock Data MVP")
    st.markdown("**Routing** — Rule-based intent detection")
    st.divider()

    st.markdown("**Available Customers**")
    customers = [
        "APPLE MART",
        "GOLDEN STAR TRADING",
        "BLUE OCEAN LLC",
        "TECH SOLUTIONS CO",
        "FAST DELIVERY INC",
    ]
    for c in customers:
        st.markdown(f"- {c}")

    st.divider()
    st.markdown("**Example Queries**")
    examples = [
        "How much does APPLE MART owe us?",
        "Show unpaid invoices for APPLE MART",
        "Which customers have overdue invoices?",
        "Top selling products this month",
        "Summarize sales for June 2026",
        "Payment history for GOLDEN STAR TRADING",
        "Customer summary for BLUE OCEAN LLC",
    ]
    for ex in examples:
        st.code(ex, language=None)

    if st.button("Clear Chat", use_container_width=True):
        st.session_state.messages = []
        st.rerun()

# ── Session State ─────────────────────────────────────────────────────────────
if "messages" not in st.session_state:
    st.session_state.messages = []

# ── Main Header ───────────────────────────────────────────────────────────────
st.markdown("## Odoo AI Agent")
st.markdown("Ask business questions in natural language. I will query your ERP data and return structured results.")
st.divider()

# ── Chat History ──────────────────────────────────────────────────────────────
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        if msg["role"] == "assistant" and "tool" in msg:
            st.caption(f"Tool called: `{msg['tool']}`")
        st.markdown(msg["content"])

# ── Chat Input ────────────────────────────────────────────────────────────────
user_input = st.chat_input("Ask a business question...")

if user_input:
    # Store and display user message
    st.session_state.messages.append({"role": "user", "content": user_input})
    with st.chat_message("user"):
        st.markdown(user_input)

    # Route and respond
    with st.chat_message("assistant"):
        with st.spinner("Processing..."):
            # Pass prior turns only (exclude the just-appended current message).
            # Memory is lightweight text; ERP data still comes from a fresh tool call.
            history = _build_history(st.session_state.messages[:-1])
            response = route_query(user_input, history)

        tool_name = response.get("tool", "unknown")
        params = response.get("parameters", {})
        result = response.get("result", "")

        st.caption(f"Tool called: `{tool_name}`")
        if params:
            param_str = " | ".join(f"`{k}`: {v}" for k, v in params.items() if v is not None)
            if param_str:
                st.caption(f"Parameters: {param_str}")

        st.markdown(result)

    st.session_state.messages.append({
        "role": "assistant",
        "content": result,
        "tool": tool_name,
    })
