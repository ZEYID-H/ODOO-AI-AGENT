#!/bin/sh
set -e

# Waits for the API over Docker Compose's internal service network. `api`
# is only resolvable here, inside the compose network — not from the host
# or the browser (see docker-compose.saas.yml's networking comments: the
# browser instead reaches the API via its published host port, baked into
# the client bundle as NEXT_PUBLIC_API_BASE_URL at build time).
API_INTERNAL_URL="${API_INTERNAL_URL:-http://api:8000}"
echo "Waiting for API at $API_INTERNAL_URL/health (internal Docker network)..."
until node -e "fetch('$API_INTERNAL_URL/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" 2>/dev/null; do
  sleep 2
done
echo "API is reachable via internal Docker networking."

# Applies any pending migrations to whatever DATABASE_URL points at (the
# mounted volume in docker-compose.saas.yml) before the server starts.
# Idempotent — prints "No pending migrations to apply" on every restart
# after the first, so this is safe to run on every container start.
npx prisma migrate deploy

# Provisions the D1 accounts (admin + drivers) from SEED_* env vars — the
# only account-creation mechanism (no user-management UI, by design; see
# docs/DELIVERY_MANAGEMENT_PLAN.md). Idempotent: accounts whose env var is
# unset are skipped, existing accounts are updated to match the env, so
# this too is safe on every container start.
npx tsx scripts/seed-users.ts

exec "$@"
