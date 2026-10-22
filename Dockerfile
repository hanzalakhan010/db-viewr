# ── Stage 1: dependency build ─────────────────────────────────────────────────
FROM python:3.12-slim AS deps

WORKDIR /build

# Install OS-level libs needed by psycopg2-binary (already bundled, but
# the slim image still needs libpq for runtime linking)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM python:3.12-slim

LABEL org.opencontainers.image.title="db-viewr" \
      org.opencontainers.image.description="Lightweight Flask-powered database client" \
      org.opencontainers.image.source="https://github.com/your-org/db-viewr"

# Runtime OS libs only (libgl1/libglib2.0-0 are needed by opencv, which
# rapidocr-onnxruntime uses for the OCR tool)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages from build stage
COPY --from=deps /install /usr/local

WORKDIR /app

# Copy application source
COPY adapters/ ./adapters/
COPY static/    ./static/
COPY app.py     .
COPY storage.py .
COPY ocr.py     .

# Create data directory for connections.json persistence
# (can be overridden by mounting a volume at /data)
RUN mkdir -p /data

# Run as non-root for security
RUN useradd --no-create-home --shell /bin/false appuser \
    && chown -R appuser:appuser /app /data
USER appuser

EXPOSE 5000

# Single-worker + 4 threads: safe for concurrent requests without file-write
# races on connections.json.  For a local dev tool this is plenty.
ENV CONNECTIONS_FILE=/data/connections.json \
    PYTHONUNBUFFERED=1

CMD ["gunicorn", \
     "--bind",    "0.0.0.0:5000", \
     "--workers", "1", \
     "--threads", "4", \
     "--timeout", "60", \
     "app:app"]
