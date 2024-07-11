#!/bin/sh
set -e


echo "Running database migrations..."
alembic upgrade head
echo "Database migrations completed."


exec uvicorn agenta_backend.main:app --host 0.0.0.0 --port 8000 --reload --log-level info --root-path /api