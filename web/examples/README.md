# `web/examples/` — Spike Apps for `ts-sdk-tracing` Design

> ⚠️ **These are spike apps for internal SDK design.** They may break or be removed when `ts-sdk-tracing` ships. Not stable starter templates.
>
> For a stable, published example, see [`examples/node/observability-vercel-ai/`](../../examples/node/observability-vercel-ai/) (AI SDK v4).

## Purpose

Six spike apps that exercise raw OpenTelemetry + Vercel AI SDK across the modern TypeScript runtime/framework matrix Agenta users will hit. Their output is the [pain log](../../docs/design/ts-sdk-tracing/pain-log.md) — a structured friction log that becomes the requirements doc for Agenta's first proper TypeScript SDK with tracing.

## Apps

| Directory | Framework | Instrumentation | Status |
|-----------|-----------|-----------------|--------|
| [`node-vercel-ai-v6/`](./node-vercel-ai-v6/) | Node.js standalone | Raw OTel | Phase 1 — building |
| [`nextjs-app-router-raw/`](./nextjs-app-router-raw/) | Next.js 15 App Router | Raw OTel | Phase 2a — pending |
| [`nextjs-app-router-vercel/`](./nextjs-app-router-vercel/) | Next.js 15 App Router | `@vercel/otel` | Phase 2b — pending |
| [`nextjs-pages-router-raw/`](./nextjs-pages-router-raw/) | Next.js 15 Pages Router | Raw OTel | Phase 3a — pending |
| [`nextjs-pages-router-vercel/`](./nextjs-pages-router-vercel/) | Next.js 15 Pages Router | `@vercel/otel` | Phase 3b — pending |
| [`react-tanstack-start/`](./react-tanstack-start/) | React TanStack Start (pre-1.0) | Raw OTel | Phase 4 — pending |

## Shared verification harness

[`.shared/agenta-verify/`](./.shared/agenta-verify/) — workspace package `@agenta/spike-verify` consumed by every spike app's canonical assertions. Built on `@agenta/sdk`'s `traces.querySpans()` (the official Fern-generated TypeScript client). Polls Agenta for matching traces, validates expected spans + attributes, throws typed errors with diagnostic context.

**Why this matters for the spike:** the harness is on the same dependency path real users would take. Pain log entries reflect what users will actually feel when wiring `@agenta/sdk` + raw OTel + AI SDK v6 together — the exact question `ts-sdk-tracing` is designed to answer.

## Running an app

Each app is self-contained. From its directory:

```bash
cp .env.example .env   # fill in AGENTA_HOST, AGENTA_API_KEY, OPENAI_API_KEY, AGENTA_SPIKE_APP_NAME
pnpm install           # workspace deps including @agenta/spike-verify
pnpm dev               # start the app
pnpm test:assertion-1  # cold-start trace completeness
pnpm test:assertion-2  # stream flush on mid-abort
pnpm test:assertion-3  # request metadata round-trips
pnpm test:assertion-4  # instrumentation runs before first handler
```

## Adding a pain log entry

When you hit friction worth capturing, append to [`docs/design/ts-sdk-tracing/pain-log.md`](../../docs/design/ts-sdk-tracing/pain-log.md). Schema in that file's header. Pre-commit hook runs `scripts/validate-pain-log.ts` to catch malformed entries.

## Lifecycle

When `ts-sdk-tracing` ships, each app's lifecycle decision is captured in the root [`TODOS.md`](../../TODOS.md):

- (a) Refactor to use `ts-sdk-tracing`, convert to docs companion.
- (b) Refactor to use `ts-sdk-tracing`, ship as starter template.
- (c) Delete, preserve pain log entries.

Don't let these rot in the repo.
