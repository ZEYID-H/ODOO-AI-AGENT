"""Layer 5 — security verification.

Proves the read-only guard holds and is designed to FAIL if any write ever
becomes possible. Runs standalone (no pytest, no live Odoo required):

    python tests/test_security.py

Also importable by pytest (functions are named test_*).
"""

import os
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.services import odoo_security
from src.services.odoo_security import (
    enforce_read_only,
    assert_read_only_mode,
    SecurityException,
    READ_ONLY_MODE,
    SESSION_ID,
    ALLOWED_METHODS,
)
from src.services.odoo_config import validate_startup, EXPECTED_ODOO_USER, REQUIRED_VARS

ALLOWED = ["search", "search_read", "read"]
FORBIDDEN = [
    "create", "write", "unlink", "copy",
    "action_post", "action_confirm", "button_validate", "reconcile",
]

# Files under src/ permitted to perform raw XML-RPC. The single approved gateway.
_APPROVED_XMLRPC_FILES = {"odoo_service.py"}
_XMLRPC_MARKERS = ("execute_kw", "ServerProxy")


def test_reads_allowed():
    for method in ALLOWED:
        enforce_read_only("res.partner", method, [[("customer_rank", ">", 0)]])
    assert ALLOWED_METHODS == frozenset(ALLOWED)


def test_writes_blocked():
    for method in FORBIDDEN:
        raised = False
        try:
            enforce_read_only("account.move", method, [[1], {"state": "posted"}])
        except SecurityException:
            raised = True
        assert raised, f"SECURITY FAILURE: '{method}' was not blocked"


def test_read_only_mode_true():
    assert READ_ONLY_MODE is True


def test_startup_refuses_when_mode_disabled():
    original = odoo_security.READ_ONLY_MODE
    try:
        odoo_security.READ_ONLY_MODE = False
        for call in (assert_read_only_mode,
                     lambda: enforce_read_only("res.partner", "read", [[1]])):
            raised = False
            try:
                call()
            except SecurityException:
                raised = True
            assert raised, "SECURITY FAILURE: writable mode was not refused"
    finally:
        odoo_security.READ_ONLY_MODE = original


def test_audit_log_has_required_fields():
    enforce_read_only("res.partner", "search_read", [[("id", "=", 1)]])
    try:
        enforce_read_only("account.move", "write", [[1], {"state": "posted"}])
    except SecurityException:
        pass

    log_path = _PROJECT_ROOT / "security_audit.log"
    assert log_path.exists(), "audit log was not created"
    tail = log_path.read_text(encoding="utf-8").splitlines()[-2:]
    blob = "\n".join(tail)
    for field in ("user=", f"session={SESSION_ID}", "params=", "ALLOWED", "BLOCKED"):
        assert field in blob, f"audit log missing required field: {field}"
    assert "res.partner.search_read" in blob
    assert "account.move.write" in blob


def test_no_direct_xmlrpc_outside_gateway():
    src_dir = _PROJECT_ROOT / "src"
    offenders = []
    for py_file in src_dir.rglob("*.py"):
        text = py_file.read_text(encoding="utf-8")
        if any(marker in text for marker in _XMLRPC_MARKERS):
            if py_file.name not in _APPROVED_XMLRPC_FILES:
                offenders.append(str(py_file.relative_to(_PROJECT_ROOT)))
    assert not offenders, (
        "Direct XML-RPC found outside the approved gateway "
        f"{_APPROVED_XMLRPC_FILES}: {offenders}"
    )


def _set_odoo_env(url="http://localhost:8069", db="prod",
                  user=EXPECTED_ODOO_USER, password="secret"):
    saved = {v: os.environ.get(v) for v in REQUIRED_VARS}
    values = {"ODOO_URL": url, "ODOO_DB": db,
              "ODOO_USERNAME": user, "ODOO_PASSWORD": password}
    for v, val in values.items():
        if val is None:
            os.environ.pop(v, None)
        else:
            os.environ[v] = val
    return saved


def _restore_env(saved):
    for v, val in saved.items():
        if val is None:
            os.environ.pop(v, None)
        else:
            os.environ[v] = val


def _assert_security_raises(call, message):
    raised = False
    try:
        call()
    except SecurityException:
        raised = True
    assert raised, message


def test_startup_valid_config_passes():
    saved = _set_odoo_env()
    try:
        cfg = validate_startup()
        assert cfg["ODOO_USERNAME"] == EXPECTED_ODOO_USER
    finally:
        _restore_env(saved)


def test_startup_fails_on_missing_credentials():
    saved = _set_odoo_env(password=None)
    try:
        _assert_security_raises(validate_startup, "missing credentials not rejected")
    finally:
        _restore_env(saved)


def test_startup_fails_on_wrong_user():
    saved = _set_odoo_env(user="admin")
    try:
        _assert_security_raises(validate_startup, "non-dedicated user not rejected")
    finally:
        _restore_env(saved)


def test_startup_fails_when_read_only_disabled():
    saved = _set_odoo_env()
    original = odoo_security.READ_ONLY_MODE
    try:
        odoo_security.READ_ONLY_MODE = False
        _assert_security_raises(validate_startup, "writable mode not rejected at startup")
    finally:
        odoo_security.READ_ONLY_MODE = original
        _restore_env(saved)


def _run_all():
    tests = [
        test_reads_allowed,
        test_writes_blocked,
        test_read_only_mode_true,
        test_startup_refuses_when_mode_disabled,
        test_audit_log_has_required_fields,
        test_no_direct_xmlrpc_outside_gateway,
        test_startup_valid_config_passes,
        test_startup_fails_on_missing_credentials,
        test_startup_fails_on_wrong_user,
        test_startup_fails_when_read_only_disabled,
    ]
    failures = 0
    print("=" * 60)
    print("SECURITY VERIFICATION — Odoo Read-Only Guard")
    print("=" * 60)
    for t in tests:
        try:
            t()
            print(f"PASS  {t.__name__}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL  {t.__name__}: {e}")
    print("=" * 60)
    if failures:
        print(f"{failures} test(s) FAILED.")
        return 1
    print("All security tests passed. Writes are technically impossible.")
    return 0


if __name__ == "__main__":
    raise SystemExit(_run_all())
