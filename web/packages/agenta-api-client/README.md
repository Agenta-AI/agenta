# @agentaai/api-client

Fern-generated TypeScript client for the Agenta API. Workspace package consumed by `@agenta/sdk`, `@agenta/entities`, and the web apps.

## How this package is built

This package ships a **compiled `dist/`** — `package.json` points `main`, `module`, `types`, and `exports` at `./dist/index.js` / `./dist/index.d.ts`. The TypeScript source under `src/generated/` uses Fern's NodeNext-style imports (e.g. `from "./api/index.js"`); those `.js` extensions only resolve correctly against the compiled output, not against the raw `.ts` source. There is no Fern config knob to change this — Fern's TypeScript SDK generator emits `.js` extensions unconditionally, and its design assumes a `tsc` compile step.

The `dist/` is built automatically on `pnpm install` via the package's `prepare` lifecycle script. You rarely need to think about it. **However**: if the source changes — either because you ran the regeneration script, hand-edited a generated file, or pulled a branch where someone else regenerated — `dist/` is stale until rebuilt.

To rebuild after source changes:

```bash
pnpm install                              # easiest — re-runs prepare for every workspace package
pnpm --filter @agentaai/api-client build    # targeted — rebuilds just this package
```

`dist/` is gitignored (see [`.gitignore`](../../../.gitignore)). Don't commit it.

## Regenerate from the OpenAPI spec

Generation lives in [`clients/scripts/generate.sh`](../../../clients/scripts/generate.sh). Three modes:

```bash
# Local API (http://localhost/api/openapi.json — requires the dev API to be running)
bash ./clients/scripts/generate.sh --language typescript

# Live cloud API (https://eu.cloud.agenta.ai/api/openapi.json)
bash ./clients/scripts/generate.sh --language typescript --live

# Explicit OpenAPI file
bash ./clients/scripts/generate.sh --language typescript --file /path/to/openapi.json
```

After generating, run `pnpm install` (or `pnpm --filter @agentaai/api-client build`) so `dist/` reflects the new source.

The generator config sets several non-default options worth knowing about (Fern is unconfigured by default):

| Option | Why |
| --- | --- |
| `omitFernHeaders: true` | The Agenta API's CORS allow-list (`api/entrypoints/routers.py`) only whitelists `Content-Type` + supertokens headers. Fern's `X-Fern-*` identity headers fail browser preflight without this. |
| `includeCredentialsOnCrossOriginRequests: true` | Sends cookies cross-origin so the supertokens session works without a custom `fetch` wrapper. |
| `retainOriginalCasing: true` | Keeps wire-format `snake_case` field names — the backend, OpenAPI spec, and existing Zod schemas all use snake_case; camelCase conversion would break consumers. |
| `streamType: web`, `formDataSupport: Node18`, `fileResponseType: binary-response` | Prefer browser/web standards; reduces the surface that drags Node-only built-ins into the browser bundle. |
| `packageJson.browser: { fs/stream/buffer: false }` | Stubs Node built-ins for browser bundles when Fern's file-upload utilities reach for them. |
| `packageJson.devDependencies."@types/node"` | Required for `tsc` to compile the generated source standalone. |
| `noSerdeLayer: true` (default) | Serde-on emits ~200 codegen errors against our spec at fern-typescript-sdk@3.63.7 (broken `Record<string, T \| null>` handling, recursive type aliases, duplicate `createAccounts` admin/client method). The convenience `@agenta/sdk` layer uses Zod for runtime extras-passthrough instead. |

## Package consumers

- [`@agenta/sdk`](../agenta-sdk/) — re-exports `AgentaApiClient`, `AgentaApiEnvironment`, `AgentaApiError`, `AgentaApiTimeoutError` and provides a Python-style `init()` helper. Most application code should consume the SDK rather than this package directly.
- [`@agenta/entities`](../agenta-entities/) — testset API uses `client.testsets.queryTestsets(...)` via the SDK as the v3 migration's first consumer.

## What's in this package

- `src/index.ts` — re-exports `./generated`
- `src/generated/` — Fern's auto-generated client (do not edit by hand; changes will be lost on next regeneration)
- `dist/` — gitignored compiled output, rebuilt by `pnpm install`'s `prepare` script
