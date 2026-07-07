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

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)"

CMD ["uvicorn", "apps.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
