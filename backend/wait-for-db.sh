#!/bin/sh
# Wait for PostgreSQL to be ready and create required directories

HOST=${DB_HOST:-db}
PORT=${DB_PORT:-5432}
USER=${DB_USER:-briefing}
PASSWORD=${DB_PASSWORD:-briefing123}
DB=${DB_NAME:-briefing_db}
MAX_ATTEMPTS=30
ATTEMPT=0

# Create required directories
mkdir -p /app/previews /app/uploads

echo "Waiting for PostgreSQL at $HOST:$PORT..."

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  if pg_isready -h "$HOST" -p "$PORT" -U "$USER" > /dev/null 2>&1; then
    echo "PostgreSQL is ready!"
    exec "$@"
  fi
  
  ATTEMPT=$((ATTEMPT + 1))
  echo "PostgreSQL not ready yet (attempt $ATTEMPT/$MAX_ATTEMPTS)..."
  sleep 1
done

echo "PostgreSQL failed to start after $MAX_ATTEMPTS attempts"
exit 1
