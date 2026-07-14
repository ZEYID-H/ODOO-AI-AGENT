#!/usr/bin/env python
"""Thin CLI entry point for the AG1 model-assisted routing evaluation.

Delegates entirely to tests/evals/evaluation_runner.py — this file adds no
logic of its own so there is exactly one runner implementation, not two.

Examples:
    python scripts/run_agent_evaluation.py
    python scripts/run_agent_evaluation.py --tool get_customer_balance
    python scripts/run_agent_evaluation.py --language ar
    python scripts/run_agent_evaluation.py --case CB-EN-01
    python scripts/run_agent_evaluation.py --output tests/evals/results/run.json
    python scripts/run_agent_evaluation.py --update-dataset --fail-on-mismatch
"""

import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from tests.evals.evaluation_runner import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
