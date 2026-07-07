# FastAPI backend (apps/api) — thin HTTP wrapper around the existing src/
# business logic. Build context is the REPO ROOT (not apps/api/), because
# this image needs `src/` alongside `apps/api/`.
#
# Build:  docker build -f apps/api/Dockerfile -t odoo-bi-api .
# Run:    docker run --env-file .env -p 8000:8000 odoo-bi-api
#
# See docker-compose.saas.yml for the normal way to run this alongside the
# web frontend.

FROM python:3.11-slim

WORKDIR /app

# Install dependencies first for better layer caching.
COPY requirements.txt requirements-api.txt ./
RUN pip install --no-cache-dir -r requirements-api.txt

# Only what route_query() and the API layer actually need — no apps/web, no
# Streamlit-only assets, no tests/venv (see .dockerignore).
COPY src/ ./src/
COPY apps/api/ ./apps/api/

# Don't run as root (Phase 9 audit finding — no Dockerfile in this repo had
# a USER directive). Only the /app directory entry itself needs to be
# writable by appuser (not recursively — appuser only ever needs to
# *create* one new file directly in /app at runtime, odoo_security.py's
# audit log, when DATA_BACKEND=odoo; it only needs read access to the
# already-COPY'd src/ and apps/api/, which default permissions provide).
# A non-recursive chown avoids the layer-duplication cost `chown -R` has
# on a large tree (see apps/web/Dockerfile's note — not an issue for this
# image's small source tree, but kept consistent regardless).
RUN useradd --create-home --uid 1000 appuser && chown appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)"

CMD ["uvicorn", "apps.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
