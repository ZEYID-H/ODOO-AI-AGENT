"""Single read-only gateway to Odoo via XML-RPC.

This is the ONLY module under src/ permitted to use xmlrpc.client.ServerProxy
and execute_kw. Enforced by tests/test_security.py::test_no_direct_xmlrpc_outside_gateway.

Guarantees:
    - validate_startup() runs before the first connection (read-only mode,
      credentials present, dedicated user).
    - Authenticates once; the uid and object proxy are cached and reused.
    - EVERY call passes through enforce_read_only(model, method, params).
    - Only search / search_read / read are reachable. There is no write helper,
      and the guard blocks any non-read method by exclusion.
"""

import xmlrpc.client

from src.services.odoo_config import validate_startup
from src.services.odoo_security import enforce_read_only

_connection = {"uid": None, "models": None, "config": None}


def _ensure_connected() -> dict:
    """Validate config, authenticate once, cache the uid/proxy. Reuse thereafter."""
    if _connection["uid"] is not None:
        return _connection

    # Fail-closed: read-only mode + credentials + dedicated user, BEFORE connecting.
    config = validate_startup()

    common = xmlrpc.client.ServerProxy(f"{config['ODOO_URL']}/xmlrpc/2/common")
    uid = common.authenticate(
        config["ODOO_DB"], config["ODOO_USERNAME"], config["ODOO_PASSWORD"], {}
    )
    if not uid:
        raise ConnectionError("Odoo authentication failed for the configured user.")

    models = xmlrpc.client.ServerProxy(f"{config['ODOO_URL']}/xmlrpc/2/object")
    _connection.update(uid=uid, models=models, config=config)
    return _connection


def _execute(model: str, method: str, args: list, kwargs: dict | None = None):
    """Single chokepoint: gate -> connect -> execute. Reads only.

    The guard runs first, so a forbidden method is blocked before any connection
    or RPC occurs.
    """
    kwargs = kwargs or {}
    enforce_read_only(model, method, {"args": args, "kwargs": kwargs})
    conn = _ensure_connected()
    return conn["models"].execute_kw(
        conn["config"]["ODOO_DB"], conn["uid"], conn["config"]["ODOO_PASSWORD"],
        model, method, args, kwargs,
    )


# ── Public read-only helpers ─────────────────────────────────────────────────

def search_read(model: str, domain: list | None = None,
                fields: list | None = None, limit: int = 20, offset: int = 0) -> list:
    return _execute(model, "search_read", [domain or []],
                    {"fields": fields or [], "limit": limit, "offset": offset})


def read(model: str, ids: list, fields: list | None = None) -> list:
    return _execute(model, "read", [ids], {"fields": fields or []})


def search(model: str, domain: list | None = None, limit: int = 20) -> list:
    return _execute(model, "search", [domain or []], {"limit": limit})


# ── Manual verification ──────────────────────────────────────────────────────

def verify() -> None:
    """Read 5 customers and 5 invoices through the gateway. Reads only."""
    print("=" * 60)
    print("ODOO GATEWAY VERIFICATION (read-only)")
    print("=" * 60)

    customers = search_read("res.partner", [("customer_rank", ">", 0)],
                            ["id", "name"], limit=5)
    print(f"res.partner: {len(customers)} customer(s)")
    for c in customers:
        print(f"  - {c.get('name')}")

    invoices = search_read("account.move", [("move_type", "=", "out_invoice")],
                           ["id", "name", "amount_total", "payment_state"], limit=5)
    print(f"account.move: {len(invoices)} invoice(s)")
    for inv in invoices:
        print(f"  - {inv.get('name')} | {inv.get('amount_total')} | {inv.get('payment_state')}")

    print("=" * 60)
    print("GATEWAY OK. No write method was called.")
    print("=" * 60)


if __name__ == "__main__":
    verify()
