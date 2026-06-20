"""Provider mock-mode verification.

Proves the data provider in mock mode is byte-identical to the mock data and is
the default backend. Runs completely offline (no Odoo connection, no OpenAI):

    python tests/test_provider.py

Also importable by pytest (functions are named test_*).
"""

import os
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.data import provider, mock_data

EXPECTED_COUNTS = {
    "customers": 5,
    "invoices": 12,
    "payments": 8,
    "products": 10,
    "sales": 32,
}

REQUIRED_KEYS = {
    "customers": {"id", "name", "email", "phone", "credit_limit", "currency"},
    "invoices": {"id", "customer_name", "amount", "paid_amount", "status",
                 "issue_date", "due_date", "description"},
    "payments": {"id", "customer_name", "amount", "date", "method", "reference"},
    "products": {"name", "category"},
    "sales": {"id", "date", "customer_name", "product_name",
              "quantity", "unit_price", "total"},
}


def _force_mock():
    saved = os.environ.get("DATA_BACKEND")
    os.environ["DATA_BACKEND"] = "mock"
    return saved


def _restore(saved):
    if saved is None:
        os.environ.pop("DATA_BACKEND", None)
    else:
        os.environ["DATA_BACKEND"] = saved


def test_default_backend_is_mock():
    saved = os.environ.pop("DATA_BACKEND", None)
    try:
        assert provider._backend() == "mock"
    finally:
        if saved is not None:
            os.environ["DATA_BACKEND"] = saved


def test_counts():
    saved = _force_mock()
    try:
        assert len(provider.get_customers()) == EXPECTED_COUNTS["customers"]
        assert len(provider.get_invoices()) == EXPECTED_COUNTS["invoices"]
        assert len(provider.get_payments()) == EXPECTED_COUNTS["payments"]
        assert len(provider.get_products()) == EXPECTED_COUNTS["products"]
        assert len(provider.get_sales()) == EXPECTED_COUNTS["sales"]
    finally:
        _restore(saved)


def test_schema_keys():
    saved = _force_mock()
    try:
        assert REQUIRED_KEYS["customers"] <= set(provider.get_customers()[0])
        assert REQUIRED_KEYS["invoices"] <= set(provider.get_invoices()[0])
        assert REQUIRED_KEYS["payments"] <= set(provider.get_payments()[0])
        assert REQUIRED_KEYS["products"] <= set(provider.get_products()[0])
        assert REQUIRED_KEYS["sales"] <= set(provider.get_sales()[0])
    finally:
        _restore(saved)


def test_returns_exact_mock_objects():
    saved = _force_mock()
    try:
        assert provider.get_customers() is mock_data.CUSTOMERS
        assert provider.get_invoices() is mock_data.INVOICES
        assert provider.get_payments() is mock_data.PAYMENTS
        assert provider.get_products() is mock_data.PRODUCTS
        assert provider.get_sales() is mock_data.SALES
    finally:
        _restore(saved)


def _run_all():
    tests = [
        test_default_backend_is_mock,
        test_counts,
        test_schema_keys,
        test_returns_exact_mock_objects,
    ]
    failures = 0
    print("=" * 60)
    print("PROVIDER VERIFICATION — mock backend")
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
    print("All provider tests passed. Mock mode is unchanged.")
    return 0


if __name__ == "__main__":
    raise SystemExit(_run_all())
