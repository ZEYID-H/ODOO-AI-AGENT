"""Layer A (deterministic, no network) — structural validation of
tests/evals/agent_cases.json against the REAL tool registry and schemas.

Every assertion here reads live source (TOOL_REGISTRY, TOOL_SCHEMAS,
mock_data) rather than trusting hardcoded expectations, so the dataset
cannot silently drift out of sync with the tools it describes.
"""

import inspect
import json
import sys
from collections import Counter
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

import pytest  # noqa: E402

from src.agent.tool_registry import TOOL_REGISTRY  # noqa: E402
from src.agent.tool_schemas import TOOL_SCHEMAS  # noqa: E402
from src.data.mock_data import CUSTOMERS  # noqa: E402
from tests.evals.evaluation_runner import ASSERTION_HANDLERS, DATASET_PATH  # noqa: E402

_REQUIRED_FIELDS = {
    "id", "category", "language", "query", "history", "expectedTool", "targetTool",
    "expectedParameters", "parameterAssertions", "requiredFacts", "prohibitedClaims",
    "expectedErrorBehavior", "dataMode", "notes", "currentStatus",
}
_ALLOWED_STATUSES = {"NOT_RUN", "PASS", "FAIL", "EXPECTED_FAIL", "BLOCKED"}
_ALLOWED_LANGUAGES = {"en", "ar", "n/a"}
_MIN_CASES_PER_TOOL = 4
_MIN_TOTAL_CASES = 60
_KNOWN_CUSTOMER_NAMES = {c["name"].upper() for c in CUSTOMERS}


@pytest.fixture(scope="module")
def dataset() -> list[dict]:
    assert DATASET_PATH.exists(), f"Dataset file missing: {DATASET_PATH}"
    with DATASET_PATH.open(encoding="utf-8") as f:
        data = json.load(f)
    assert isinstance(data, list), "agent_cases.json must be a JSON array of case objects"
    return data


def test_dataset_is_non_trivial(dataset):
    assert len(dataset) >= _MIN_TOTAL_CASES, (
        f"Expected at least {_MIN_TOTAL_CASES} cases, found {len(dataset)}."
    )


def test_every_case_has_required_fields_and_types(dataset):
    for case in dataset:
        missing = _REQUIRED_FIELDS - set(case.keys())
        assert not missing, f"{case.get('id', '?')} is missing fields: {missing}"
        assert isinstance(case["id"], str) and case["id"], "id must be a non-empty string"
        assert isinstance(case["category"], str) and case["category"]
        assert case["language"] in _ALLOWED_LANGUAGES, f"{case['id']}: bad language {case['language']!r}"
        assert isinstance(case["query"], str) and case["query"]
        assert isinstance(case["history"], list)
        assert isinstance(case["expectedTool"], str) and case["expectedTool"]
        assert isinstance(case["expectedParameters"], dict)
        assert isinstance(case["parameterAssertions"], dict)
        assert isinstance(case["requiredFacts"], list)
        assert isinstance(case["prohibitedClaims"], list)
        assert isinstance(case["dataMode"], str) and case["dataMode"]
        assert isinstance(case["notes"], str)
        assert case["currentStatus"] in _ALLOWED_STATUSES, (
            f"{case['id']}: currentStatus {case['currentStatus']!r} not in {_ALLOWED_STATUSES}"
        )


def test_case_ids_are_unique(dataset):
    ids = [c["id"] for c in dataset]
    dupes = [i for i, n in Counter(ids).items() if n > 1]
    assert not dupes, f"Duplicate case ids: {dupes}"


def test_expected_tool_is_a_real_tool_or_a_documented_special_value(dataset):
    special = {"assistant", "unknown", "n/a"}
    real_tools = set(TOOL_REGISTRY)
    for case in dataset:
        assert case["expectedTool"] in real_tools | special, (
            f"{case['id']}: expectedTool {case['expectedTool']!r} is neither a registered tool "
            f"nor one of {special}"
        )


def test_target_tool_is_a_real_registered_tool_when_set(dataset):
    real_tools = set(TOOL_REGISTRY)
    for case in dataset:
        target = case["targetTool"]
        if target is not None:
            assert target in real_tools, f"{case['id']}: targetTool {target!r} is not in TOOL_REGISTRY"


def test_every_registered_tool_has_minimum_case_coverage(dataset):
    counts = Counter(c["targetTool"] for c in dataset if c["targetTool"])
    under_covered = {t: counts.get(t, 0) for t in TOOL_REGISTRY if counts.get(t, 0) < _MIN_CASES_PER_TOOL}
    assert not under_covered, (
        f"Tools below the {_MIN_CASES_PER_TOOL}-case minimum: {under_covered}. "
        f"TOOL_REGISTRY has {len(TOOL_REGISTRY)} tools; every one must reach the minimum."
    )
    # Every one of the (verified) 14 registered tools must appear at all.
    assert set(counts) == set(TOOL_REGISTRY), (
        f"Tools with zero dataset coverage: {set(TOOL_REGISTRY) - set(counts)}"
    )


def test_dataset_includes_both_languages(dataset):
    langs = {c["language"] for c in dataset}
    assert "en" in langs and "ar" in langs, f"Expected both en and ar coverage, found {langs}"


def test_parameter_assertion_types_are_all_known(dataset):
    for case in dataset:
        for key, spec in case["parameterAssertions"].items():
            assert "type" in spec, f"{case['id']}: parameterAssertions[{key!r}] missing 'type'"
            assert spec["type"] in ASSERTION_HANDLERS, (
                f"{case['id']}: parameterAssertions[{key!r}] has unknown type {spec['type']!r}; "
                f"known types are {sorted(ASSERTION_HANDLERS)}"
            )


def test_case_insensitive_equals_customer_names_reference_real_or_deliberately_unknown_customers(dataset):
    """A customer_name asserted via case_insensitive_equals must either be one of the
    5 real mock customers, or the case must be explicitly categorized as testing an
    unknown-customer scenario — catches accidental typos in customer names."""
    for case in dataset:
        spec = case["parameterAssertions"].get("customer_name")
        if not spec or spec.get("type") != "case_insensitive_equals":
            continue
        name = str(spec["value"]).upper()
        is_deliberately_unknown = case["category"] in ("unknown_customer",)
        assert name in _KNOWN_CUSTOMER_NAMES or is_deliberately_unknown, (
            f"{case['id']}: customer_name {spec['value']!r} is not a real mock customer "
            f"(src/data/mock_data.py CUSTOMERS) and the case is not categorized 'unknown_customer'. "
            f"Real customers: {sorted(_KNOWN_CUSTOMER_NAMES)}"
        )


def test_tool_registry_and_schemas_agree_with_14_verified_tools(dataset):
    """Re-verification, independent of tool_registry._validate_registry()'s own
    import-time check: confirms the exact count and name set this whole dataset
    was authored against still holds."""
    expected_names = {
        "get_business_alerts", "get_collection_priorities", "get_customer_balance",
        "get_customer_insights", "get_customer_statement", "get_customer_summary",
        "get_dashboard_summary", "get_overdue_invoices", "get_payment_history",
        "get_product_insights", "get_sales_summary", "get_top_debtors",
        "get_top_selling_products", "get_unpaid_invoices",
    }
    assert set(TOOL_REGISTRY) == expected_names, (
        f"Live TOOL_REGISTRY no longer matches the 14-tool inventory this dataset was authored against. "
        f"Live: {sorted(TOOL_REGISTRY)}"
    )
    assert len(TOOL_REGISTRY) == 14
    schema_names = {s["function"]["name"] for s in TOOL_SCHEMAS}
    assert schema_names == set(TOOL_REGISTRY)


def test_required_parameters_are_present_in_every_happy_path_case(dataset):
    """For each targetTool, every case in category in-scope for that tool must supply
    (via parameterAssertions or expectedParameters) every REQUIRED parameter the real
    function signature demands — unless the case deliberately omits it to test
    missing-parameter/error handling."""
    omission_categories = {"missing_param", "unknown_customer", "unknown_product"}
    for case in dataset:
        target = case["targetTool"]
        if not target or case["category"] in omission_categories:
            continue
        fn = TOOL_REGISTRY[target]["function"]
        sig = inspect.signature(fn)
        required_params = [
            name for name, p in sig.parameters.items()
            if p.default is inspect.Parameter.empty
        ]
        supplied_keys = set(case["parameterAssertions"]) | set(case["expectedParameters"])
        for req in required_params:
            assert req in supplied_keys, (
                f"{case['id']} (targetTool={target}) does not assert/supply required "
                f"parameter '{req}' (signature: {sig}), and is not in an omission category."
            )
