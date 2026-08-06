# Reference packages (read-only)

This directory holds v2-era TypeScript SDK packages copied from `arda/auto-agenta-poc` for design lookup while the v3 thin-wrapper SDK is being built at [`../packages/agenta-sdk/`](../packages/agenta-sdk/).

**These packages are NOT part of the pnpm workspace.** They live outside `web/packages/` so the `packages/*` glob in [`web/pnpm-workspace.yaml`](../pnpm-workspace.yaml) doesn't pick them up. Nothing builds, installs, or links them.

## Contents

| Package | Purpose in v2 | Disposition under v3 |
|---|---|---|
| `agenta-sdk` | Hand-rolled HTTP client + 22 resource classes + Zod boundary validation + retry logic + typed error hierarchy | Replaced by Fern-generated `@agentaai/api-client` consumed by the new thin `@agenta/sdk` |
| `agenta-sdk-tracing` | OTel exporter wrapper, framework mappers, hierarchy repair, span filter | Mappers deleted (backend canonicalizes); hierarchy-repair survives; tracing API moves to `AgentaSpanProcessor` model |
| `agenta-sdk-ai` | Vercel AI SDK helpers — `createAgentWithPrompts`, `syncToolDefinitions`, traceID injection | Killed as standalone package; `createAgentWithPrompts` + `syncToolDefinitions` move to `@agenta/sdk/ai` sub-export |
| `agenta-sdk-mastra` | Mastra adapter (~50% of AI SDK helper surface) | Killed — Mastra emits OTel natively |

## How to use

Read the source for design context. Don't import from here. Don't add references to these paths in any package.json.
