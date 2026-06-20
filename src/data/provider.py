"""Data provider: selects the data backend (mock or odoo) for the tools.

Tools call these functions instead of importing mock_data constants or
odoo_service directly. Tool signatures and formatters stay unchanged while the
underlying source switches via the DATA_BACKEND environment variable:

    DATA_BACKEND=mock  (default) -> src/data/mock_data lists  (offline, tests)
    DATA_BACKEND=odoo            -> src/services/odoo_service  (live, read-only)

In odoo mode, Odoo records are normalized to the SAME dict schema the mock data
uses, so nothing downstream changes. All Odoo access goes through the read-only
gateway (this module performs no raw XML-RPC itself).
"""

import os
from datetime import date

from src.data import mock_data
from src.services import odoo_service

# Page size for paginated Odoo reads. Pages are accumulated until a short page
# is returned, so there is no upper bound on total records fetched per entity.
_PAGE_SIZE = 500


def _backend() -> str:
    return os.getenv("DATA_BACKEND", "mock").strip().lower()


# ── Odoo value helpers ───────────────────────────────────────────────────────

def _name(value) -> str:
    """Extract the display name from a many2one [id, name] (or '' if empty)."""
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return value[1]
    return ""


def _text(value) -> str:
    """Odoo returns False for empty char/text fields; normalize to ''."""
    return value if isinstance(value, str) else ""


def _search_read_all(model: str, domain: list, fields: list) -> list:
    """Read every matching record via offset pagination (no upper bound).

    Pages through search_read until a page returns fewer rows than the page
    size. Uses only the read-only gateway; introduces no new permissions.
    """
    rows: list = []
    offset = 0
    while True:
        page = odoo_service.search_read(
            model, domain, fields, limit=_PAGE_SIZE, offset=offset
        )
        rows.extend(page)
        if len(page) < _PAGE_SIZE:
            break
        offset += _PAGE_SIZE
    return rows


# ── Odoo backends (normalize to the mock schema) ─────────────────────────────

def _odoo_customers() -> list[dict]:
    fields = ["name", "email", "phone", "credit_limit"]
    try:
        rows = _search_read_all("res.partner", [("customer_rank", ">", 0)], fields)
    except Exception:
        # credit_limit is version-sensitive; retry without it.
        rows = _search_read_all(
            "res.partner", [("customer_rank", ">", 0)], ["name", "email", "phone"]
        )
    return [
        {
            "id": r.get("id"),
            "name": _text(r.get("name")),
            "email": _text(r.get("email")),
            "phone": _text(r.get("phone")),
            "credit_limit": r.get("credit_limit") or 0.0,
            "currency": "USD",
        }
        for r in rows
    ]


def _odoo_invoices() -> list[dict]:
    today = date.today().isoformat()
    rows = _search_read_all(
        "account.move",
        [("move_type", "=", "out_invoice"), ("state", "=", "posted")],
        ["name", "partner_id", "amount_total", "amount_residual",
         "invoice_date", "invoice_date_due", "payment_state", "invoice_origin", "ref"],
    )
    result = []
    for r in rows:
        total = r.get("amount_total") or 0.0
        residual = r.get("amount_residual") or 0.0
        due = _text(r.get("invoice_date_due"))
        payment_state = r.get("payment_state")
        if payment_state in ("paid", "in_payment", "reversed"):
            status = "paid"
        elif residual > 0 and due and due < today:
            status = "overdue"
        else:
            status = "unpaid"
        result.append({
            "id": _text(r.get("name")),
            "customer_name": _name(r.get("partner_id")),
            "amount": total,
            "paid_amount": total - residual,
            "status": status,
            "issue_date": _text(r.get("invoice_date")),
            "due_date": due,
            "description": (_text(r.get("invoice_origin"))
                           or _text(r.get("ref"))
                           or _text(r.get("name"))),
        })
    return result


def _odoo_payments() -> list[dict]:
    base_fields = ["name", "partner_id", "amount", "date", "journal_id"]
    domain = [("partner_type", "=", "customer"), ("payment_type", "=", "inbound")]
    try:
        rows = _search_read_all("account.payment", domain, base_fields + ["ref"])
    except Exception:
        # 'ref' is not exposed on account.payment in some Odoo versions (SaaS).
        rows = _search_read_all("account.payment", domain, base_fields)
    return [
        {
            "id": _text(r.get("name")),
            "customer_name": _name(r.get("partner_id")),
            "amount": r.get("amount") or 0.0,
            "date": _text(r.get("date")),
            "method": _name(r.get("journal_id")),
            "reference": _text(r.get("ref")) or _text(r.get("name")),
        }
        for r in rows
    ]


def _odoo_products() -> list[dict]:
    rows = _search_read_all("product.product", [], ["name", "categ_id"])
    return [
        {
            "id": r.get("id"),
            "name": _text(r.get("name")),
            "category": _name(r.get("categ_id")),
        }
        for r in rows
    ]


def _odoo_sales() -> list[dict]:
    lines = _search_read_all(
        "sale.order.line",
        [("order_id.state", "in", ["sale", "done"])],
        ["product_id", "product_uom_qty", "price_unit", "price_subtotal", "order_id"],
    )
    order_ids = list({l["order_id"][0] for l in lines if l.get("order_id")})
    orders = (
        _search_read_all(
            "sale.order", [("id", "in", order_ids)],
            ["date_order", "partner_id"],
        )
        if order_ids else []
    )
    order_map = {o["id"]: o for o in orders}

    result = []
    for l in lines:
        oid = l["order_id"][0] if l.get("order_id") else None
        order = order_map.get(oid, {})
        result.append({
            "id": l.get("id"),
            "date": _text(order.get("date_order"))[:10],
            "customer_name": _name(order.get("partner_id")),
            "product_id": l["product_id"][0] if l.get("product_id") else None,
            "product_name": _name(l.get("product_id")),
            "quantity": l.get("product_uom_qty") or 0,
            "unit_price": l.get("price_unit") or 0.0,
            "total": l.get("price_subtotal") or 0.0,
        })
    return result


# ── Public API (used by the tools) ───────────────────────────────────────────

def get_customers() -> list[dict]:
    return mock_data.CUSTOMERS if _backend() == "mock" else _odoo_customers()


def get_invoices() -> list[dict]:
    return mock_data.INVOICES if _backend() == "mock" else _odoo_invoices()


def get_payments() -> list[dict]:
    return mock_data.PAYMENTS if _backend() == "mock" else _odoo_payments()


def get_products() -> list[dict]:
    return mock_data.PRODUCTS if _backend() == "mock" else _odoo_products()


def get_sales() -> list[dict]:
    return mock_data.SALES if _backend() == "mock" else _odoo_sales()


# ── Manual verification ──────────────────────────────────────────────────────

def verify() -> None:
    """Print per-entity counts for the active backend (mock or odoo)."""
    print(f"DATA_BACKEND = {_backend()}")
    print(f"  customers: {len(get_customers())}")
    print(f"  invoices : {len(get_invoices())}")
    print(f"  payments : {len(get_payments())}")
    print(f"  products : {len(get_products())}")
    print(f"  sales    : {len(get_sales())}")


if __name__ == "__main__":
    verify()
