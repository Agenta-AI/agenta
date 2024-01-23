# Dockerfile
FROM python:3.9-slim-buster

WORKDIR /app

# Install git and clone the necessary repository
RUN apt-get update -y \
    && apt-get install -y git

# Ensure pip and poetry are up to date
RUN pip install --upgrade pip \
    && pip install poetry

# Copy only requirements to cache them in docker layer
COPY pyproject.toml poetry.lock* README.md /app/

# This is a hack to create a dummy module so that poetry install doesn't fail 
RUN mkdir -p /app/agenta_backend
RUN touch /app/agenta_backend/__init__.py

# Project initialization:
RUN poetry config virtualenvs.create false \
    && poetry install --no-interaction --no-ansi

RUN apt-get update -y \
    && apt-get install -y git \
    && git clone https://github.com/mmabrouk/beanie /tmp/beanie \
    && python -m venv /beanie_venv \
    && /beanie_venv/bin/pip install --upgrade pip \
    && /beanie_venv/bin/pip install /tmp/beanie \
    && rm -rf /tmp/beanie \
    && apt-get remove -y git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# remove dummy module
RUN rm -r /app/agenta_backend
EXPOSE 8000