FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Copy requirements first (for better Docker layer caching)
COPY requirements.txt .

# Install system dependencies for image processing, PDF support, and PostgreSQL tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    libopenjp2-7 \
    libtiff-dev \
    libjpeg-dev \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . /app

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')" || exit 1

# Expose port
EXPOSE 8000

# Run with initialization script that creates directories and waits for DB
CMD ["sh", "-c", "mkdir -p /app/previews /app/uploads && while ! pg_isready -h db -p 5432 -U briefing; do echo 'Waiting for PostgreSQL...'; sleep 1; done; uvicorn main:app --host 0.0.0.0 --port 8000"]
