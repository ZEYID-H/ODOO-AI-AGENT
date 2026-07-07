# Odoo Business Intelligence Assistant — production container image.
# Build:  docker build -t odoo-bi-assistant .
# Run:    docker run --env-file .env -p 8501:8501 odoo-bi-assistant

FROM python:3.11-slim

WORKDIR /app

# Install dependencies first for better layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code only (see .dockerignore for exclusions: venv, tests,
# secrets, local artifacts).
COPY . .

# Don't run as root (Phase 9 audit finding — no Dockerfile in this repo had
# a USER directive). --create-home gives appuser a writable $HOME so
# Streamlit's own config/credential cache (~/.streamlit/) has somewhere to
# go. Only the /app directory entry itself is chowned (not recursively —
# see apps/web/Dockerfile's note on why `chown -R` over a large COPY'd
# tree is avoided) so security_audit.log can still be created at runtime
# when DATA_BACKEND=odoo; appuser only needs read access to the rest of
# /app, which default permissions already provide.
RUN useradd --create-home --uid 1000 appuser && chown appuser:appuser /app
USER appuser

EXPOSE 8501

# Streamlit's own health endpoint — no extra OS packages required.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8501/_stcore/health').status==200 else 1)"

ENTRYPOINT ["streamlit", "run", "app.py", \
            "--server.port=8501", \
            "--server.address=0.0.0.0", \
            "--server.headless=true"]
