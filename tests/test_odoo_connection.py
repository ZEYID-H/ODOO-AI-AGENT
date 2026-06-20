"""Odoo read-only connection verification (pre-gateway).

Proves the real AI_AGENT_READONLY account can authenticate and READ. This makes
a LIVE XML-RPC call, so it is NOT part of the offline security suite. Run it
manually after the Odoo .env block is populated:

    python tests/test_odoo_connection.py

Read-only by construction:
    - Only `search_read` is used (a whitelisted method).
    - Every call is gated by `enforce_read_only()` first.
    - No create/write/unlink/post/reconcile anywhere; no write probe.
"""

import sys
import xmlrpc.client
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.services.odoo_config import validate_startup
from src.services.odoo_security import enforce_read_only


def _connect(config):
    common = xmlrpc.client.ServerProxy(f"{config['ODOO_URL']}/xmlrpc/2/common")
    uid = common.authenticate(
        config["ODOO_DB"], config["ODOO_USERNAME"], config["ODOO_PASSWORD"], {}
    )
    if not uid:
        raise SystemExit("Authentication FAILED — check ODOO_* credentials / user.")
    models = xmlrpc.client.ServerProxy(f"{config['ODOO_URL']}/xmlrpc/2/object")
    return uid, models


def _read(models, config, uid, model, domain, fields, limit):
    # Gate every call exactly as the future gateway will. search_read is whitelisted.
    enforce_read_only(model, "search_read",
                      {"domain": domain, "fields": fields, "limit": limit})
    return models.execute_kw(
        config["ODOO_DB"], uid, config["ODOO_PASSWORD"],
        model, "search_read",
        [domain],
        {"fields": fields, "limit": limit},
    )


def main():
    print("=" * 60)
    print("ODOO READ-ONLY CONNECTION VERIFICATION")
    print("=" * 60)

    # 1) Fail-closed startup validation: read-only mode + creds + dedicated user.
    config = validate_startup()
    print("validate_startup() OK — read-only mode, creds present, dedicated user.")

    # 2) Authenticate as the read-only user.
    uid, models = _connect(config)
    print(f"Authenticated as {config['ODOO_USERNAME']} (uid={uid}).")

    # 3) res.partner.search_read — minimal fields, small limit.
    partners = _read(models, config, uid,
                     "res.partner", [("customer_rank", ">", 0)],
                     ["id", "name"], limit=5)
    print(f"res.partner.search_read OK — {len(partners)} customer(s) read.")

    # 4) account.move.search_read — customer invoices, small limit.
    invoices = _read(models, config, uid,
                     "account.move", [("move_type", "=", "out_invoice")],
                     ["id", "name", "amount_total", "payment_state"], limit=5)
    print(f"account.move.search_read OK — {len(invoices)} invoice(s) read.")

    print("=" * 60)
    print("READ-ONLY CONNECTION VERIFIED. No write method was called.")
    print("=" * 60)


if __name__ == "__main__":
    main()
