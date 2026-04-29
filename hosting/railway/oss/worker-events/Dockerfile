FROM ghcr.io/agenta-ai/agenta-api:latest

ENV AGENTA_LICENSE=oss
ENV AGENTA_API_URL=http://api.railway.internal:8000/api
ENV AGENTA_API_INTERNAL_URL=http://api.railway.internal:8000/api
ENV REDIS_URI=redis://redis.railway.internal:6379/0
ENV REDIS_URI_VOLATILE=redis://redis.railway.internal:6379/0
ENV REDIS_URI_DURABLE=redis://redis.railway.internal:6379/0
ENV SUPERTOKENS_CONNECTION_URI=http://supertokens.railway.internal:3567
ENV ALEMBIC_CFG_PATH_CORE=/api/oss/databases/postgres/migrations/core/alembic.ini
ENV ALEMBIC_CFG_PATH_TRACING=/api/oss/databases/postgres/migrations/tracing/alembic.ini

# Background worker for asynchronous event stream processing
CMD ["python", "-m", "entrypoints.worker_events"]
