"""AG2 — registry/schema structural contract (deterministic, offline).

Every check reads the LIVE TOOL_REGISTRY / TOOL_SCHEMAS and the real Python
signatures via inspect — nothing is hardcoded that could silently drift.
"""

import inspect
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.agent.tool_registry import TOOL_REGISTRY  # noqa: E402
from src.agent.tool_schemas import TOOL_SCHEMAS, tool_names  # noqa: E402

# The only JSON-Schema parameter types the OpenAI function-calling layer and
# our implementations actually exchange.
_SUPPORTED_PARAM_TYPES = {"string", "integer", "number", "boolean"}

_SCHEMAS_BY_NAME = {s["function"]["name"]: s["function"] for s in TOOL_SCHEMAS}


def test_registry_and_schemas_are_one_to_one():
    assert tool_names() == set(TOOL_REGISTRY)
    assert len(TOOL_SCHEMAS) == len(TOOL_REGISTRY), "duplicate schema names would hide here"


def test_no_duplicate_tool_names_in_schemas():
    names = [s["function"]["name"] for s in TOOL_SCHEMAS]
    assert len(names) == len(set(names))


def test_registered_function_and_formatter_are_callable():
    for name, entry in TOOL_REGISTRY.items():
        assert callable(entry["function"]), f"{name}: function not callable"
        assert callable(entry["formatter"]), f"{name}: formatter not callable"
        assert set(entry) == {"function", "formatter"}, f"{name}: unexpected registry keys"


def test_schemas_have_valid_function_calling_structure():
    for schema in TOOL_SCHEMAS:
        name = schema["function"]["name"]
        assert schema["type"] == "function", name
        fn = schema["function"]
        assert isinstance(fn["description"], str) and fn["description"].strip(), name
        params = fn["parameters"]
        assert params["type"] == "object", name
        assert isinstance(params["properties"], dict), name
        assert isinstance(params["required"], list), name


def test_required_fields_exist_in_properties():
    for name, fn in _SCHEMAS_BY_NAME.items():
        params = fn["parameters"]
        for req in params["required"]:
            assert req in params["properties"], f"{name}: required '{req}' not in properties"


def test_parameter_types_are_supported():
    for name, fn in _SCHEMAS_BY_NAME.items():
        for pname, spec in fn["parameters"]["properties"].items():
            assert spec.get("type") in _SUPPORTED_PARAM_TYPES, (
                f"{name}.{pname}: unsupported type {spec.get('type')!r}"
            )
            assert isinstance(spec.get("description"), str) and spec["description"].strip(), (
                f"{name}.{pname}: missing description"
            )


def test_every_schema_parameter_is_accepted_by_the_implementation():
    for name, fn in _SCHEMAS_BY_NAME.items():
        sig = inspect.signature(TOOL_REGISTRY[name]["function"])
        for pname in fn["parameters"]["properties"]:
            assert pname in sig.parameters, (
                f"{name}: schema parameter '{pname}' not accepted by implementation {sig}"
            )


def test_every_required_implementation_parameter_is_in_the_schema_and_required():
    for name, entry in TOOL_REGISTRY.items():
        fn_schema = _SCHEMAS_BY_NAME[name]
        sig = inspect.signature(entry["function"])
        for pname, p in sig.parameters.items():
            if p.default is inspect.Parameter.empty:
                assert pname in fn_schema["parameters"]["properties"], (
                    f"{name}: required implementation arg '{pname}' missing from schema"
                )
                assert pname in fn_schema["parameters"]["required"], (
                    f"{name}: implementation requires '{pname}' but schema marks it optional"
                )


def test_optional_implementation_parameters_are_never_schema_required():
    for name, entry in TOOL_REGISTRY.items():
        fn_schema = _SCHEMAS_BY_NAME[name]
        sig = inspect.signature(entry["function"])
        for req in fn_schema["parameters"]["required"]:
            p = sig.parameters[req]
            assert p.default is inspect.Parameter.empty, (
                f"{name}: schema requires '{req}' but the implementation has a default — "
                f"the schema is stricter than reality"
            )


def test_overdue_invoices_description_no_longer_contradicts_its_own_parameters():
    """AG2 fix D6: the description used to say 'Takes no arguments' while the
    schema defined an optional 'period' parameter."""
    fn = _SCHEMAS_BY_NAME["get_overdue_invoices"]
    assert "takes no arguments" not in fn["description"].lower()
    assert "period" in fn["parameters"]["properties"]


def test_top_selling_products_exposes_its_limit_parameter():
    """AG2 fix D7: the implementation always accepted limit (default 5) but the
    schema hid it, unlike the other three ranking tools."""
    for ranking_tool in ("get_top_debtors", "get_collection_priorities",
                         "get_business_alerts", "get_top_selling_products"):
        props = _SCHEMAS_BY_NAME[ranking_tool]["parameters"]["properties"]
        assert "limit" in props, f"{ranking_tool}: ranking tool without a schema limit"
        assert "limit" not in _SCHEMAS_BY_NAME[ranking_tool]["parameters"]["required"]
