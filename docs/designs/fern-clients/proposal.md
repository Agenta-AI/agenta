# Fern Client Proposal

## Goal

Split generated Fern clients from handwritten SDKs while keeping the SDK as the public user-facing entrypoint.

## Target Layout

```text
clients/
  python/
    src/agenta_client/
    scripts/
  typescript/
    src/
    scripts/

sdk/
  python/
  typescript/
```

## Package Boundaries

- `clients/python` owns the generated Python client.
- `sdk/python` owns handwritten Python helpers, managers, and facades.
- `clients/typescript` owns the generated TypeScript client.
- `sdk/typescript` owns handwritten TypeScript helpers and facades.

## Import Surface

- The SDK should continue to expose the client through stable public names such as `agenta.client`.
- The generated client should be available as a distinct lower-level package during development and CI.
- The SDK should import the client package, not the generated file tree directly.

## Regeneration Flow

- A single top-level clients script should dispatch generation by language.
- The script should run Fern in the client package directory.
- The script should support local regeneration from `openapi.json` produced by a running API server.
- Post-processing fixes, such as recursive type patching for Python, should run after generation.

## Transitional Strategy

- Keep a compatibility shim in the SDK while the client package is moved out.
- Move consumers to the client package import boundary gradually.
- Once the new package path is stable, update Docker and CI to install both packages explicitly.
