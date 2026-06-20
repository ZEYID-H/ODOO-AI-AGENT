"""Startup/bootstrap validation for the Odoo connection (secondary security layer).

This module does NOT connect to Odoo. It validates configuration *before* any
connection is attempted, so the app refuses to start in an unsafe posture:

    - READ_ONLY_MODE must be True (delegated to odoo_security).
    - All Odoo credentials must be present.
    - The configured user must be the dedicated read-only account
      (EXPECTED_ODOO_USER, default "AI_AGENT_READONLY").

The dedicated Odoo user remains the PRIMARY protection (its ACLs forbid writes
server-side). This check is a secondary tripwire: it can confirm the username
string, but the true read-only guarantee is the Odoo-side ACL configuration
documented in docs/ODOO_READONLY_USER.md.

Only the Odoo backend calls validate_startup(); mock/offline mode never does,
so tests and offline development need no credentials.
"""

import os

from src.services.odoo_security import SecurityException, assert_read_only_mode

# Load .env if python-dotenv is available; the module still works without it
# (env vars are read straight from the environment).
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

REQUIRED_VARS = ("ODOO_URL", "ODOO_DB", "ODOO_USERNAME", "ODOO_PASSWORD")

# The only Odoo user this agent is permitted to authenticate as.
EXPECTED_ODOO_USER = os.getenv("EXPECTED_ODOO_USER", "AI_AGENT_READONLY")


def get_config() -> dict:
    """Return the current Odoo connection settings from the environment."""
    return {var: os.getenv(var) for var in REQUIRED_VARS}


def validate_startup() -> dict:
    """Fail-closed startup check. Returns the validated config or raises.

    Raises:
        SecurityException: if read-only mode is off, credentials are missing, or
        the configured user is not the dedicated read-only account.
    """
    # 1) Read-only mode must be on.
    assert_read_only_mode()

    # 2) All credentials must be present and non-empty.
    config = get_config()
    missing = [var for var in REQUIRED_VARS if not config.get(var)]
    if missing:
        raise SecurityException(
            f"Missing required Odoo credentials: {missing}. Refusing to start."
        )

    # 3) The configured user must be the dedicated read-only account.
    if config["ODOO_USERNAME"] != EXPECTED_ODOO_USER:
        raise SecurityException(
            f"Configured ODOO_USERNAME '{config['ODOO_USERNAME']}' is not the "
            f"dedicated read-only user '{EXPECTED_ODOO_USER}'. Refusing to start."
        )

    return config
