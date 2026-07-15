"""AG2 — error contract: failures are safe, categorized, readable, and never
leak internals. Documents the error taxonomy (docs/AI_AGENT_TOOL_CONTRACTS.md
§9) by proving each category's real behavior at its real boundary. Offline.
"""

import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

import pytest  # noqa: E402

from src.agent.tool_registry import TOOL_REGISTRY, execute_tool  # noqa: E402
from src.data import provider  # noqa: E402


# ── ENTITY_NOT_FOUND: {"error": ...} result + '**Error:**' presentation ─────

def test_entity_not_found_errors_are_uniform_across_all_entity_scoped_tools():
    error_results = [
        TOOL_REGISTRY["get_customer_balance"]["function"](customer_name="NOBODY INC"),
        TOOL_REGISTRY["get_customer_summary"]["function"](customer_name="NOBODY INC"),
        TOOL_REGISTRY["get_payment_history"]["function"](customer_name="NOBODY INC"),
        TOOL_REGISTRY["get_customer_statement"]["function"](customer_name="NOBODY INC"),
        TOOL_REGISTRY["get_customer_insights"]["function"](customer_name="NOBODY INC"),
        TOOL_REGISTRY["get_unpaid_invoices"]["function"](customer_name="NOBODY INC"),
        TOOL_REGISTRY["get_product_insights"]["function"](product_name="NO SUCH PRODUCT"),
    ]
    for raw in error_results:
        assert "error" in raw
        msg = raw["error"]
        assert "not found" in msg.lower() or "no product found" in msg.lower()
        # Readable, single-sentence, no internals.
        assert "Traceback" not in msg and "Exception" not in msg


def test_error_results_format_with_the_uniform_error_prefix():
    for tool, kwargs in [
        ("get_customer_balance", {"customer_name": "NOBODY INC"}),
        ("get_unpaid_invoices", {"customer_name": "NOBODY INC"}),
        ("get_product_insights", {"product_name": "NO SUCH PRODUCT"}),
    ]:
        raw = TOOL_REGISTRY[tool]["function"](**kwargs)
        formatted = TOOL_REGISTRY[tool]["formatter"](raw)
        assert formatted.startswith("**Error:**"), f"{tool}: nonuniform error presentation"


# ── VALIDATION_ERROR: missing/invalid arguments fail before execution ───────

def test_missing_required_parameter_raises_before_any_business_logic():
    with pytest.raises(TypeError):
        execute_tool("get_customer_balance", {})


def test_empty_product_query_is_a_validation_error_not_a_crash():
    raw = TOOL_REGISTRY["get_product_insights"]["function"](product_name="   ")
    assert raw["mode"] == "no_match" and "error" in raw


# ── TOOL_EXECUTION_ERROR: implementation exceptions stay exceptions ─────────
# (sanitization happens at the boundaries: route_query() falls back to the
# rule-based router; apps/api/main.py returns success=false with a generic
# message and logs server-side — both proven by existing tests.)

def test_provider_failure_propagates_as_an_exception_for_the_boundary_to_sanitize(monkeypatch):
    def boom():
        raise ConnectionError("odoo gateway unreachable")
    monkeypatch.setattr(provider, "get_invoices", boom)
    with pytest.raises(ConnectionError):
        execute_tool("get_overdue_invoices", {})


def test_route_query_sanitizes_openai_path_failures_via_fallback(monkeypatch):
    """DATA_SOURCE / OPENAI failures inside the OpenAI path degrade to the
    rule-based fallback — the user gets an answer, never a stack trace."""
    import src.agent.router as router
    if not router._OPENAI_IMPORTED:
        pytest.skip("openai SDK not imported in this environment")

    monkeypatch.setattr(router, "is_available", lambda: True)

    def exploding_run_agent(query, history=None):
        raise RuntimeError("simulated OpenAI outage")
    monkeypatch.setattr(router, "run_agent", exploding_run_agent)

    result = router.route_query("How much does APPLE MART owe us?")
    assert result["tool"] == "get_customer_balance", "fallback did not engage"
    assert "Traceback" not in result["result"]
    assert "simulated OpenAI outage" not in result["result"], "internal detail leaked"


# ── No secrets in any error surface ──────────────────────────────────────────

def test_error_messages_never_echo_environment_secrets(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-THIS-MUST-NEVER-APPEAR")
    for tool, kwargs in [
        ("get_customer_balance", {"customer_name": "NOBODY INC"}),
        ("get_product_insights", {"product_name": "NO SUCH PRODUCT"}),
    ]:
        raw = TOOL_REGISTRY[tool]["function"](**kwargs)
        formatted = TOOL_REGISTRY[tool]["formatter"](raw)
        assert "sk-THIS-MUST-NEVER-APPEAR" not in formatted


# ── Empty result ≠ failure: the two states are visibly distinct ─────────────

def test_empty_result_and_error_are_distinguishable_shapes(monkeypatch):
    from src.tools.invoice_tools import get_unpaid_invoices, format_unpaid_invoices

    empty = get_unpaid_invoices(customer_name="TECH SOLUTIONS CO")  # real customer
    error = get_unpaid_invoices(customer_name="NOBODY INC")

    if "error" not in empty:  # customer may legitimately have unpaid invoices
        monkeypatch.setattr(provider, "get_invoices", lambda: [])
        empty = get_unpaid_invoices(customer_name="TECH SOLUTIONS CO")

    assert "error" not in empty and "error" in error
    empty_text = format_unpaid_invoices(empty)
    error_text = format_unpaid_invoices(error)
    assert not empty_text.startswith("**Error:**"), "empty result presented as failure"
    assert error_text.startswith("**Error:**"), "failure presented as normal result"
