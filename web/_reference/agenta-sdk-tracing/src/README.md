# Agenta SDK — Tracing Pipeline

Framework-agnostic OpenTelemetry tracing that maps AI framework spans to Agenta's `ag.*` conventions. This module has **zero framework dependencies** — it only imports from `@opentelemetry/*`.

Framework-specific wrappers (`createAgentaTracedResponse`, `createMastraTracedStream`) live in the [`ai/`](../ai/) and [`mastra/`](../mastra/) adapters. This module provides the underlying pipeline they both use.

## Architecture

```
Your Framework (AI SDK / Mastra / Custom)
    │ creates OTel spans
    ▼
┌─ AgentaExporter Pipeline ────────────────────────┐
│                                                    │
│  1. Span Filter    → Drop framework noise          │
│  2. Attribute Map  → Framework attrs → ag.*        │
│  3. Session Prop   → Propagate session IDs         │
│  4. Hierarchy Fix  → Reparent orphaned spans       │
│  5. OTLP Export    → Send to Agenta backend        │
│                                                    │
└────────────────────────────────────────────────────┘
```

## Public API

### `initAgentaTracing(options?)`

Initialize the OTel provider. Called automatically by `createAgentaTracedResponse` / `createMastraTracedStream`, but can be called manually for control.

```ts
import { initAgentaTracing } from "@/lib/agenta-sdk/tracing";

initAgentaTracing({
  host: "http://localhost",          // default: AGENTA_HOST env
  apiKey: "ak-...",                  // default: AGENTA_API_KEY env
  serviceName: "my-app",            // default: "agenta-app"
  framework: "auto",                // "auto" | "ai-sdk" | "mastra"
  batchDelayMs: 2000,               // batch export interval
  maxBatchSize: 50,                 // spans per batch
});
```

Safe to call multiple times — only initializes once. No-op if `AGENTA_API_KEY` is not set.

### `withSpan(options, fn)`

Manual span instrumentation for custom operations.

```ts
import { withSpan } from "@/lib/agenta-sdk/tracing";

const result = await withSpan(
  { name: "tool:detectStore", type: "tool", inputs: { url } },
  async (span) => {
    const data = await detectStore(url);
    return data;  // Automatically recorded as ag.data.outputs
  }
);
```

### `getTracer()`

Get the global OTel tracer. Returns `null` if tracing isn't initialized.

### `flushTracing()`

Flush all pending spans. Call before process exit.

## Pluggable Framework Mappers

The attribute mapper is pluggable — each AI framework gets its own mapper that converts framework-specific OTel attributes to Agenta's `ag.*` conventions.

### Built-in mappers

| Mapper | Framework | Detection |
|--------|-----------|-----------|
| `aiSdkMapper` | Vercel AI SDK v6 | Span names: `ai.streamText*`, `ai.toolCall*` |
| `mastraMapper` | Mastra | Span names: `mastra.*`, attributes: `mastra.agent.*` |

### Auto-detection (default)

When `framework: "auto"` (default), the exporter checks each span against all registered mappers. The first mapper whose `detect()` returns `true` handles the span.

### Custom mapper

```ts
import { registerMapper } from "@/lib/agenta-sdk/tracing";
import type { FrameworkMapper } from "@/lib/agenta-sdk/tracing";

const myMapper: FrameworkMapper = {
  id: "my-framework",
  detect(span) {
    return span.name.startsWith("myfw.");
  },
  mapAttributes(span) {
    const attrs = span.attributes;
    const m = (span as any).attributes;
    // Map your framework's attributes to ag.* conventions
    m["ag.type.node"] = "chat";
    m["ag.data.inputs"] = JSON.stringify(attrs["myfw.input"]);
    // ... etc
  },
};

registerMapper(myMapper); // Call before initAgentaTracing()
```

### `FrameworkMapper` interface

```ts
interface FrameworkMapper {
  /** Unique identifier (e.g., "ai-sdk", "mastra", "langchain") */
  readonly id: string;
  /** Return true if this span came from your framework */
  detect(span: ReadableSpan): boolean;
  /** Convert framework attributes to ag.* conventions (mutates in place) */
  mapAttributes(span: ReadableSpan): void;
}
```

## Pipeline Components

### Span Filter (`span-filter.ts`)

Drops non-LLM spans (Next.js routing, HTTP, DNS, middleware). Keeps:

| Span Name Pattern | Kept As |
|-------------------|---------|
| `chat:*` | Manual conversation root |
| `ai.streamText*` | AI SDK streaming |
| `ai.generateText*` | AI SDK generation |
| `ai.toolCall*` | AI SDK tool execution |
| `ai.embed*` | AI SDK embeddings |
| `mastra.*` | Mastra spans |
| `tool:*` | Manual tool spans |
| `llm:*` | Manual LLM spans |

Also keeps any span with `ag.type.node` already set.

### Attribute Mapper (`mappers/`)

Converts framework attributes to Agenta conventions:

| Agenta Attribute | Purpose |
|------------------|---------|
| `ag.type.node` | Span type: `"chat"`, `"tool"`, `"agent"`, `"embedding"` |
| `ag.type.tree` | `"invocation"` on the root span |
| `ag.data.inputs` | JSON-encoded inputs |
| `ag.data.outputs` | JSON-encoded outputs |
| `ag.metrics.tokens.incremental.prompt` | Prompt token count |
| `ag.metrics.tokens.incremental.completion` | Completion token count |
| `ag.metrics.tokens.incremental.total` | Total tokens |
| `ag.metrics.costs.incremental.total` | Estimated USD cost |
| `ag.meta.request.model` | Model name |
| `ag.meta.system` | Provider: `"anthropic"`, `"openai"` |
| `ag.meta.request.streaming` | `true` if streaming |
| `ag.session.id` | Session identifier |
| `ag.meta.userId` | User identifier |
| `ag.refs.application.id` | Agenta application ID |
| `ag.refs.application_revision.id` | Deployed revision ID |

### Hierarchy Repairer (`hierarchy-repairer.ts`)

Fixes span parent-child relationships broken by span filtering. When intermediate spans are dropped (e.g., `ai.streamText` outer wrapper), child spans become orphans. The repairer:

1. Groups spans by trace ID
2. Finds the earliest "chat" span as root → marks with `ag.type.tree = "invocation"`
3. Reparents orphaned tool spans to the nearest chat span that started before them
4. Reparents orphaned chat spans to the root

### Session Propagation

Three-phase propagation ensures all spans in a session have `ag.session.id`:

1. **Collect** — gather session IDs from spans that have them
2. **Parent→Child** — propagate from parent to child spans
3. **Trace-wide fallback** — if a span has no session, check other spans in the same trace

### Cost Estimator (`cost-estimator.ts`)

Estimates per-span USD cost from model name + token counts:

```ts
// Supported models (auto-strips provider prefix)
"anthropic/claude-haiku-4-5"      → $0.80/M input, $4.00/M output
"anthropic/claude-sonnet-4-*"     → $3.00/M input, $15.00/M output
"openai/gpt-4o"                   → $2.50/M input, $10.00/M output
"openai/gpt-4o-mini"              → $0.15/M input, $0.60/M output
"openai/gpt-5.4"                  → $2.00/M input, $8.00/M output
```

## Agenta Exporter (`exporter.ts`)

The `AgentaExporter` implements OTel's `SpanExporter` interface and orchestrates the pipeline:

```ts
import { AgentaExporter } from "@/lib/agenta-sdk/tracing";

// Used internally by initAgentaTracing(), but available for custom setups:
const exporter = new AgentaExporter(
  otlpExporter,          // Inner OTLP exporter
  createMapper("auto"),  // Optional: explicit mapper function
);
```

The exporter maintains cross-batch state:
- **Exported span IDs** — tracks which spans have been exported (cap: 2000) for hierarchy repair across batches
- **Session cache** — maps span ID → session ID (cap: 2000) for session propagation across batches
