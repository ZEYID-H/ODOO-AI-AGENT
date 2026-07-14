"""Layer A (deterministic, no network) — validates that every case's `history`
fixture in agent_cases.json already conforms to the SAME lightweight,
text-only conversation-memory contract apps/web and apps/api independently
enforce, using their own real detection logic (imported directly, not
re-implemented here, so the two can never silently drift apart).
"""

import json
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

import pytest  # noqa: E402

from apps.api.main import _looks_like_tool_output  # noqa: E402
from src.agent.router import _rule_based_route  # noqa: E402
from tests.evals.evaluation_runner import DATASET_PATH  # noqa: E402


@pytest.fixture(scope="module")
def dataset() -> list[dict]:
    with DATASET_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def test_every_history_turn_has_the_lightweight_shape(dataset):
    for case in dataset:
        for turn in case["history"]:
            assert set(turn.keys()) <= {"role", "content"}, (
                f"{case['id']}: history turn has extra keys {set(turn.keys()) - {'role', 'content'}} "
                f"— only {{role, content}} may ever be sent to route_query(), per "
                f"apps/web/lib/history.ts::HistoryMessage and apps/api/schemas.py::ChatMessage."
            )
            assert turn.get("role") in ("user", "assistant"), (
                f"{case['id']}: history turn role must be 'user' or 'assistant', got {turn.get('role')!r}"
            )
            assert isinstance(turn.get("content"), str) and turn["content"], (
                f"{case['id']}: history turn content must be a non-empty string"
            )


def test_no_history_turn_looks_like_a_raw_tool_output_table(dataset):
    """Uses apps/api/main.py's OWN _looks_like_tool_output() — the exact function
    apps/api applies server-side to every inbound history turn — so this test can never
    drift out of sync with the real contract it is checking against."""
    for case in dataset:
        for turn in case["history"]:
            assert not _looks_like_tool_output(turn["content"]), (
                f"{case['id']}: history turn content would be collapsed by apps/api's "
                f"filter_history() (>= 3 pipes or > 300 chars) — fixtures must already be in "
                f"the POST-FILTER lightweight shape, e.g. '(Provided <tool> results.)', not a "
                f"raw markdown table or a long formatted result."
            )


def test_cases_with_history_are_not_expected_to_pass_via_the_rule_based_fallback(dataset):
    """_rule_based_route() takes no history argument (verified in
    test_registry_coverage.py::test_rule_based_fallback_has_no_history_parameter) — so any
    case that supplies history can only be resolved by the OpenAI path. This is a structural
    fact about the current architecture, not a live measurement, and is asserted here so a
    future contributor cannot accidentally add a history-dependent case and expect the
    rule-based fallback to ever satisfy it."""
    import inspect

    sig = inspect.signature(_rule_based_route)
    for case in dataset:
        if case["history"]:
            assert "history" not in sig.parameters


def test_followup_cases_exist_and_use_non_empty_history(dataset):
    followups = [c for c in dataset if c["category"] == "followup_with_history"]
    assert len(followups) >= 2, "Expected at least 2 follow-up-with-history cases per the AG1 coverage matrix."
    for case in followups:
        assert len(case["history"]) >= 1, f"{case['id']}: a follow-up case must actually supply history"
