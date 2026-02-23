# Wrapper Dockerfile for Railway deployment
# Adds CMD to the GHCR image since Railway doesn't support docker-compose "command"

FROM ghcr.io/agenta-ai/agenta-api:latest

# Runtime defaults for template consumers
ENV AGENTA_LICENSE=oss
ENV PORT=8000
ENV SCRIPT_NAME=/api
ENV REDIS_URI=redis://redis.railway.internal:6379/0
ENV REDIS_URI_VOLATILE=redis://redis.railway.internal:6379/0
ENV REDIS_URI_DURABLE=redis://redis.railway.internal:6379/0
ENV SUPERTOKENS_CONNECTION_URI=http://supertokens.railway.internal:3567

# Start gunicorn with uvicorn workers
CMD ["gunicorn", "entrypoints.routers:app", "--bind", "0.0.0.0:8000", "--worker-class", "uvicorn.workers.UvicornWorker", "--workers", "2", "--max-requests", "10000", "--max-requests-jitter", "1000", "--timeout", "60", "--graceful-timeout", "60", "--log-level", "info", "--access-logfile", "-", "--error-logfile", "-"]
