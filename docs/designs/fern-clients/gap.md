# Fern Client Gap Analysis

## Missing Pieces

- The Python generator script exists, but the generated output is still effectively tied to the current repo layout until the move is completed.
- Dockerfiles still copy `/sdk` only.
- Package metadata for split Python and TypeScript distributions is not yet defined.
- CI does not yet validate client regeneration from a local OpenAPI file.

## Technical Gaps

- The SDK still has imports that assume the generated client sits under the legacy path.
- The new `agenta_client` boundary needs to become the canonical import target inside the SDK.
- The TypeScript Fern scaffold still needs a first real generation pass to validate the chosen generator and output shape against Agenta's OpenAPI.

## Operational Gaps

- There is no documented release flow for the client packages.
- There is no explicit local-development contract for rebuilding clients from a running API server.
- There is no Docker build contract for installing the client package alongside the SDK package.
