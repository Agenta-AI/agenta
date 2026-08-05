# Migration runner - runs once and exits
FROM ghcr.io/agenta-ai/agenta-api:latest

ENV AGENTA_LICENSE=oss
ENV ALEMBIC_CFG_PATH_CORE=/app/oss/databases/postgres/migrations/core/alembic.ini
ENV ALEMBIC_CFG_PATH_TRACING=/app/oss/databases/postgres/migrations/tracing/alembic.ini

COPY create_databases.py /tmp/create_databases.py

# Create required databases, then run migrations
CMD ["sh", "-lc", "/opt/venv/bin/python /tmp/create_databases.py && /opt/venv/bin/python -m oss.databases.postgres.migrations.runner"]
