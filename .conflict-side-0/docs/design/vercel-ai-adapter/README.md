# Vercel AI SDK Adapter for OTLP Ingestion

## Overview

Add a backend adapter that maps Vercel AI SDK's `ai.*` OpenTelemetry span attributes to Agenta's `ag.*` namespace. This enables the frontend's structured panels (inputs, outputs, model, tokens, costs) to display data from Vercel AI SDK traces.

## Origin

The Vercel AI SDK has built-in OTel support via `experimental_telemetry: { isEnabled: true }`. It emits `ai.*` span attributes. We verified that traces arrive in Agenta, but the structured UI panels are empty because no adapter maps `ai.*` to `ag.*`.

## Documents

| File | Description |
|------|-------------|
| [context.md](./context.md) | Background, problem, goals |
| [plan.md](./plan.md) | Implementation plan, attribute mapping, testing, docs |
| [research.md](./research.md) | Vercel AI SDK semconv reference (all attribute keys) |
| [status.md](./status.md) | Progress tracker |

## Scope

This project covers:

1. **Backend adapter** — `VercelAIAdapter` mapping `ai.*` → `ag.*`
2. **Unit tests** — First adapter unit tests in the codebase (establishes pattern)
3. **E2E tests** — Ingest Vercel AI-style spans via HTTP API, query back, verify `ag.*` mapping
4. **Integration docs** — `docs/docs/integrations/frameworks/vercel-ai-sdk/` (overview + observability pages)
5. **Example** — `examples/node/observability-vercel-ai/` (already created, will be refined)
6. **Live validation** — Send real Vercel AI SDK traces to deployed instance for visual verification
