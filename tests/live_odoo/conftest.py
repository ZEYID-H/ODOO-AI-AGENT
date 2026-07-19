"""AG4 live-Odoo validation harness — session gating (opt-in, fail-loud).

Rules (docs/AG4_LIVE_ODOO_VALIDATION.md):
  - The suite NEVER runs implicitly: without RUN_LIVE_ODOO=1 every test is
    skipped with a clear reason. Normal CI/dev runs stay offline.
  - When live mode IS requested, missing credentials or a failed
    authentication are hard ERRORS, never skips and never a silent fall
    back to mock data — a green run must mean "validated against real Odoo".
  - Transport is exclusively the read-only gateway (search/search_read/read,
    enforced by src/services/odoo_security.py). No write method exists here.
  - Nothing in this harness prints secret values; only variable names and
    outcomes are reported.
"""

import os
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

import pytest  # noqa: E402

_REQUIRED_VARS = ("ODOO_URL", "ODOO_DB", "ODOO_USERNAME", "ODOO_PASSWORD")

_LIVE_REQUESTED = os.getenv("RUN_LIVE_ODOO") == "1"


def pytest_collection_modifyitems(config, items):
    """Mark every test in this package `live_odoo`; skip all unless requested."""
    skip_marker = pytest.mark.skip(
        reason="live Odoo suite is opt-in: set RUN_LIVE_ODOO=1 (requires real "
               "read-only Odoo credentials in the environment)"
    )
    for item in items:
        if "live_odoo" in str(item.fspath):
            item.add_marker(pytest.mark.live_odoo)
            if not _LIVE_REQUESTED:
                item.add_marker(skip_marker)


@pytest.fixture(scope="session")
def odoo_live():
    """Authenticated, read-only gateway session. Errors loudly, never skips.

    Returns the src.services.odoo_service module itself — the suite's ONLY
    transport. Reference calculations import raw records through it and
    re-aggregate independently (tests/live_odoo/reference.py); they never
    reuse src/tools or src/data/provider aggregation logic.
    """
    if not _LIVE_REQUESTED:
        pytest.skip("RUN_LIVE_ODOO=1 not set")

    # dotenv, same loading mechanism the app itself uses.
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    missing = [v for v in _REQUIRED_VARS if not os.getenv(v)]
    if missing:
        pytest.fail(
            f"Live Odoo validation was requested (RUN_LIVE_ODOO=1) but these "
            f"environment variables are missing: {missing}. Refusing to skip "
            f"or fall back to mock — provide credentials or unset RUN_LIVE_ODOO.",
            pytrace=False,
        )

    from src.services import odoo_service
    try:
        # First real (read-only) call authenticates through the gateway's own
        # fail-closed startup validation.
        odoo_service.search_read("res.users", [("login", "=", os.getenv("ODOO_USERNAME"))],
                                 ["id", "login"], limit=1)
    except Exception as exc:  # noqa: BLE001 — any failure here must be loud and clear
        pytest.fail(
            f"Live Odoo validation was requested but authentication/connection "
            f"FAILED: {type(exc).__name__}: {str(exc)[:200]}. The suite never "
            f"falls back to mock data.",
            pytrace=False,
        )
    return odoo_service


@pytest.fixture(scope="session")
def live_backend_env(odoo_live):
    """Force the production provider path onto the live backend for the whole
    session — the tool-under-test must go through the REAL provider code."""
    old = os.environ.get("DATA_BACKEND")
    os.environ["DATA_BACKEND"] = "odoo"
    yield
    if old is None:
        os.environ.pop("DATA_BACKEND", None)
    else:
        os.environ["DATA_BACKEND"] = old


@pytest.fixture(scope="session")
def instance_identity(odoo_live):
    """Sanitized identity of the instance under test (no secrets):
    server version + company name only, for the evidence record."""
    import xmlrpc.client
    from src.services.odoo_config import get_config
    url = get_config()["ODOO_URL"]
    version = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/common").version()
    companies = odoo_live.search_read("res.company", [], ["name"], limit=1)
    return {
        "server_version": version.get("server_version"),
        "company": companies[0]["name"] if companies else "(none visible)",
    }
