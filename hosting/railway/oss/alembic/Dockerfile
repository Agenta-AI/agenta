# Migration runner - runs once and exits
FROM ghcr.io/agenta-ai/agenta-api:latest

ENV AGENTA_LICENSE=oss

COPY create_databases.py /tmp/create_databases.py

# Create required databases, then run migrations
CMD ["sh", "-lc", "/opt/venv/bin/python /tmp/create_databases.py && /opt/venv/bin/python -m ee.databases.postgres.migrations.runner"]
