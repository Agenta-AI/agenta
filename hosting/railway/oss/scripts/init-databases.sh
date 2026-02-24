#!/usr/bin/env bash

set -euo pipefail

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-agenta-oss-railway}"
ENV_NAME="${RAILWAY_ENVIRONMENT_NAME:-staging}"
POSTGRES_SERVICE="${RAILWAY_POSTGRES_SERVICE:-Postgres}"

if ! command -v railway >/dev/null 2>&1; then
    printf "Missing required command: railway\n" >&2
    exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
    printf "Missing required command: uv\n" >&2
    exit 1
fi

if [ -z "${RAILWAY_API_TOKEN:-}" ] && [ -z "${RAILWAY_TOKEN:-}" ]; then
    railway whoami >/dev/null 2>&1 || {
        printf "Railway authentication is required. Set RAILWAY_API_TOKEN or run railway login.\n" >&2
        exit 1
    }
fi

railway link --project "$PROJECT_NAME" --environment "$ENV_NAME" --json >/dev/null

export RAILWAY_POSTGRES_SERVICE="$POSTGRES_SERVICE"

uv run --with psycopg[binary] python - <<'PY'
import os
import subprocess
import psycopg

SERVICE = os.environ["RAILWAY_POSTGRES_SERVICE"]

out = subprocess.check_output(
    ["railway", "variable", "list", "-k", "--service", SERVICE],
    text=True,
)
vals = dict(
    line.split("=", 1)
    for line in out.strip().splitlines()
    if "=" in line
)

dsn = vals.get("DATABASE_PUBLIC_URL") or vals.get("DATABASE_URL")
if not dsn:
    user = vals.get("POSTGRES_USER") or vals.get("PGUSER")
    password = vals.get("POSTGRES_PASSWORD") or vals.get("PGPASSWORD")
    host = vals.get("PGHOST") or "postgres.railway.internal"
    port = vals.get("PGPORT") or "5432"
    database = vals.get("POSTGRES_DB") or vals.get("PGDATABASE") or "railway"

    if not user or not password:
        raise SystemExit("Postgres credentials are missing. Set POSTGRES_USER and POSTGRES_PASSWORD on Postgres service")

    dsn = f"postgresql://{user}:{password}@{host}:{port}/{database}"

dbs = ["agenta_oss_core", "agenta_oss_tracing", "agenta_oss_supertokens"]

with psycopg.connect(dsn, autocommit=True) as conn:
    with conn.cursor() as cur:
        for db in dbs:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db,))
            if cur.fetchone() is None:
                cur.execute(f'CREATE DATABASE "{db}"')
                print(f"created:{db}")
            else:
                print(f"exists:{db}")
PY

printf "Databases initialized for '%s' (%s)\n" "$PROJECT_NAME" "$ENV_NAME"
