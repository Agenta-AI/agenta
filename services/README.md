# Agenta Services

This directory contains various versions of Agenta's LLM services, each offering distinct capabilities and interfaces for language model interactions.

# Set up

- Modify the openapi environment variable in the docker compose files for the services you want to use.

## Service Overview

### New Services
All services with "new-sdk" utilize the modified SDK, which includes these changes:
- Configuration is now nested under `agenta_config` in the request body (no longer flattened)
- Implements the stateless SDK (no interface changes, but may introduce future issues in cloud deployment due to lack of testing)

## Service Components

Each service includes:
- Docker configuration (`docker-compose.yml`)
- REST API documentation (`.rest` files)
- Implementation code (`_app.py`)

## Usage

For usage examples and API details, refer to the `.rest` files in each service's directory.
