"""Single source of truth for tool execution.

`TOOL_REGISTRY` is the ONLY place the OpenAI layer is allowed to obtain a
callable. The model emits a tool name as a string; `execute_tool` resolves it
through a plain dictionary lookup and runs the registered function.

Security contract (mandatory now and for Phase 3 live Odoo data):
    - No eval(), no getattr() on model output, no dynamic imports.
    - Only functions explicitly listed in TOOL_REGISTRY can be executed.

Consistency is enforced at import time: TOOL_REGISTRY and tool_schemas must
describe exactly the same set of tools, or the application fails to start.
"""

from src.agent.tool_schemas import tool_names

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


TOOL_REGISTRY = {
    "get_customer_balance": {
        "function": get_customer_balance,
        "formatter": format_customer_balance,
    },
    "get_customer_summary": {
        "function": get_customer_summary,
        "formatter": format_customer_summary,
    },
    "get_payment_history": {
        "function": get_payment_history,
        "formatter": format_payment_history,
    },
    "get_top_debtors": {
        "function": get_top_debtors,
        "formatter": format_top_debtors,
    },
    "get_customer_statement": {
        "function": get_customer_statement,
        "formatter": format_customer_statement,
    },
    "get_dashboard_summary": {
        "function": get_dashboard_summary,
        "formatter": format_dashboard_summary,
    },
    "get_collection_priorities": {
        "function": get_collection_priorities,
        "formatter": format_collection_priorities,
    },
    "get_customer_insights": {
        "function": get_customer_insights,
        "formatter": format_customer_insights,
    },
    "get_product_insights": {
        "function": get_product_insights,
        "formatter": format_product_insights,
    },
    "get_unpaid_invoices": {
        "function": get_unpaid_invoices,
        "formatter": format_unpaid_invoices,
    },
    "get_overdue_invoices": {
        "function": get_overdue_invoices,
        "formatter": format_overdue_invoices,
    },
    "get_top_selling_products": {
        "function": get_top_selling_products,
        "formatter": format_top_products,
    },
    "get_sales_summary": {
        "function": get_sales_summary,
        "formatter": format_sales_summary,
    },
}


def _validate_registry() -> None:
    """Fail fast at startup if schemas and registry describe different tools."""
    schema_names = tool_names()
    registry_names = set(TOOL_REGISTRY)

    missing_in_registry = schema_names - registry_names
    missing_in_schemas = registry_names - schema_names

    if missing_in_registry:
        raise RuntimeError(
            f"Tool schema(s) without a registry entry: {sorted(missing_in_registry)}"
        )
    if missing_in_schemas:
        raise RuntimeError(
            f"Registry entr(ies) without a tool schema: {sorted(missing_in_schemas)}"
        )


def execute_tool(name: str, arguments: dict) -> tuple[dict, str]:
    """Run a registered tool and format its result.

    Returns (raw_result, formatted_markdown):
        - raw_result: the tool's dict output, used as the factual basis for the
          model's short insight.
        - formatted_markdown: the authoritative, user-facing output.

    Resolution is a plain dict lookup — no dynamic function resolution. An
    unregistered name raises KeyError instead of executing anything.
    """
    if name not in TOOL_REGISTRY:
        raise KeyError(f"Unknown tool '{name}' is not registered and cannot be executed.")

    entry = TOOL_REGISTRY[name]
    raw_result = entry["function"](**arguments)
    formatted = entry["formatter"](raw_result)
    return raw_result, formatted


_validate_registry()
