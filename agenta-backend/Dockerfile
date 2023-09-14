# Dockerfile
FROM python:3.9-slim-buster

WORKDIR /app

ARG http_proxy
ARG https_proxy
ARG HTTP_PROXY
ARG HTTPS_PROXY

ENV http_proxy=$http_proxy
ENV https_proxy=$https_proxy
ENV HTTP_PROXY=$HTTP_PROXY
ENV HTTPS_PROXY=$HTTPS_PROXY

# Ensure pip and poetry are up to date
RUN pip install --upgrade pip \
    && pip install poetry

# Copy only requirements to cache them in docker layer
COPY pyproject.toml poetry.lock* README.md sleep.py /app/

# This is a hack to create a dummy module so that poetry install doesn't fail 
RUN mkdir -p /app/agenta_backend
RUN touch /app/agenta_backend/__init__.py

# Project initialization:
RUN poetry config virtualenvs.create false \
    && poetry install --no-interaction --no-ansi
# remove dummy module
RUN rm -r /app/agenta_backend
EXPOSE 8000