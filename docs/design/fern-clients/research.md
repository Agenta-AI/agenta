# Fern Client Split Research

## Current State

- The Python SDK is a single Poetry package at `sdk/`.
- The generated Fern Python client currently lives inside the SDK tree at `sdk/agenta/client/backend/`.
- The handwritten SDK imports the generated client directly from `agenta.client`.
- Docker images copy `/sdk` into the runtime image and install the SDK from there.

## Observations

- The generated client is not a separate distributable package today.
- The SDK and generated client are coupled by package path, not just by API contract.
- A split is still possible without breaking the public `agenta.client` surface if the SDK owns a compatibility shim.
- The generated client needs a regeneration entrypoint that can read either:
  - a local OpenAPI file
  - a live OpenAPI URL from a locally running API

## Constraints

- Existing SDK imports should keep working during the migration.
- Local development must be able to regenerate client code without publishing artifacts.
- Docker builds must be able to install both layers once the split is complete.
- The TypeScript side should follow the same split, but it does not yet exist in this repo.

## Update

- `clients/typescript` now has a standalone Fern generation scaffold.
- The TypeScript client package remains outside `web/` so it can be consumed independently.
