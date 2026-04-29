# Fern Client Tasks

- Introduce `agenta_client` as the canonical Python client boundary.
- Add a Python regeneration script that supports `--openapi-url` and `--openapi-file`.
- Keep `agenta.client` available through the SDK as a compatibility surface.
- Switch handwritten SDK imports to the new client boundary.
- Validate the first TypeScript Fern generation against Agenta's OpenAPI.
- Confirm the generated TypeScript client export shape and package name.
- Update Dockerfiles to install or copy both SDK and client packages.
- Make local development resolve the client package from the working tree.
- Add CI coverage for regenerating clients from a local OpenAPI artifact.
- Remove direct imports from the legacy embedded client path once migration is complete.
- Document the final package and import layout.
