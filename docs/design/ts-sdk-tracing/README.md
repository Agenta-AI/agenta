# `ts-sdk-tracing` — Spike to Inform SDK Design

Agenta's first proper TypeScript SDK with first-class tracing support. This directory holds the design phase outputs.

## Status: SPIKE IN PROGRESS

We're currently running 6 spike apps under `web/examples/*` to surface friction with raw OpenTelemetry + Vercel AI SDK across modern TS framework patterns. The pain log produced by that spike becomes the requirements doc for the SDK itself.

## Documents

| File | Description |
|------|-------------|
| [README.md](./README.md) | This file. Status + index. |
| [summary.md](./summary.md) | **Living one-page executive summary of the spike** — what existed before, what we tested, what worked, what didn't. Updated as new spike apps land. Start here. |
| [pain-log.md](./pain-log.md) | Structured friction log written incrementally during spike work. **The primary durable artifact.** |
| [status.md](./status.md) | Progress tracker for the spike + downstream SDK work. Includes "SDK Requirements" section. |

## Origin

Vercel AI SDK is the only TypeScript-first integration in Agenta today. Every other integration (LangChain, OpenAI Agents, PydanticAI, etc.) is Python-only and uses Agenta's existing Python SDK. There is no equivalent on the TS side. This SDK is that equivalent.

Before designing the SDK API surface, the team is investing in a research spike to discover the actual friction TS developers feel when wiring tracing into their apps. The spike's deliverable is a **pain log**, not example code. The pain log feeds the SDK design.

## Spike scope

Six apps under `web/examples/*`:

| App | Framework | Instrumentation |
|-----|-----------|-----------------|
| `node-vercel-ai-v6/` | Node.js standalone | Raw OpenTelemetry |
| `nextjs-app-router-raw/` | Next.js 15 App Router | Raw OpenTelemetry |
| `nextjs-app-router-vercel/` | Next.js 15 App Router | `@vercel/otel` |
| `nextjs-pages-router-raw/` | Next.js 15 Pages Router | Raw OpenTelemetry |
| `nextjs-pages-router-vercel/` | Next.js 15 Pages Router | `@vercel/otel` |
| `react-tanstack-start/` | React TanStack Start (pre-1.0) | Raw OpenTelemetry |

The full design is captured in the `/office-hours` design doc (in `~/.gstack/projects/Agenta-AI-agenta/`, ts-sdk-chore/example-apps branch). See [status.md](./status.md) for current progress.

## Existing reference

[`examples/node/observability-vercel-ai/`](../../../examples/node/observability-vercel-ai/) — published Node.js example pinned to AI SDK v4. Stays unchanged during the spike. New spike apps target AI SDK v6 (current GA stable).

## What this is NOT

- This is not the SDK itself. The SDK ships after the spike completes.
- These are not stable starter templates. They may break or be removed when `ts-sdk-tracing` ships.
- Don't reference these in user-facing docs until the SDK lands.
