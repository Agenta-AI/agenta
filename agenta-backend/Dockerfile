# Dockerfile
FROM python:3.9-slim-buster

WORKDIR /app

# Install git and clone the necessary repository
RUN apt-get update -y \
    && apt-get install -y git

# Ensure pip and poetry are up to date
RUN pip install --upgrade pip \
    && pip install poetry

# Copy only requirements and alembic configuration file
# to cache them in docker layer
COPY pyproject.toml poetry.lock* alembic.* README.md /app/

# This is a hack to create a dummy module so that poetry install doesn't fail
RUN mkdir -p /app/agenta_backend
RUN touch /app/agenta_backend/__init__.py

# Copy migrations folder
RUN mkdir -p /app/agenta_backend/migrations/postgres
COPY agenta_backend/migrations/postgres /app/agenta_backend/migrations/postgres

# Project initialization:
RUN poetry config virtualenvs.create false \
    && poetry install --no-interaction --no-ansi

# remove dummy module
RUN rm -r /app/agenta_backend
EXPOSE 8000