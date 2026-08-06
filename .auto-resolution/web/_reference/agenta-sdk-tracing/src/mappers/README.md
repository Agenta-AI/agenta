# Agenta SDK — Framework Mappers

Pluggable attribute mappers that convert framework-specific OTel span attributes to Agenta's `ag.*` namespace conventions.

## How It Works

Each AI framework creates OTel spans with its own attribute naming:
- AI SDK uses `ai.usage.promptTokens`, `ai.toolCall.name`, `gen_ai.request.model`
- Mastra uses `mastra.agent.name`, `mastra.tool.name`, `gen_ai.usage.prompt_tokens`

The mapper converts these to Agenta's unified format:
- `ag.metrics.tokens.incremental.prompt`
- `ag.type.node` = `"chat"` | `"tool"` | `"embedding"`
- `ag.data.inputs` / `ag.data.outputs`

## Built-in Mappers

### `ai-sdk.ts` — Vercel AI SDK v6

**Detects:** Span names starting with `ai.streamText`, `ai.generateText`, `ai.toolCall`, `ai.embed`, or spans with `ai.model.id` attribute.

**Maps:**
| AI SDK Attribute | Agenta Attribute |
|------------------|------------------|
| `ai.usage.promptTokens` / `gen_ai.usage.prompt_tokens` | `ag.metrics.tokens.incremental.prompt` |
| `ai.usage.completionTokens` / `gen_ai.usage.completion_tokens` | `ag.metrics.tokens.incremental.completion` |
| `ai.model.id` / `gen_ai.request.model` | `ag.meta.request.model` |
| `ai.prompt.messages` | `ag.data.inputs` (as JSON) |
| `ai.response.text` | `ag.data.outputs` (as JSON) |
| `ai.toolCall.name` | `ai.toolCall.name` (kept) + `ag.type.node = "tool"` |
| `ai.toolCall.args` | `ag.data.inputs` |
| `ai.toolCall.result` | `ag.data.outputs` |
| `ai.telemetry.metadata.sessionId` | `ag.session.id` |
| `ai.telemetry.metadata.userId` | `ag.meta.userId` |
| `ai.telemetry.metadata.applicationId` | `ag.refs.application.id` |

### `mastra.ts` — Mastra Framework

**Detects:** Span names starting with `mastra.`, or spans with `mastra.agent.name` / `mastra.tool.name` attributes.

**Maps:** Mastra's OTel attributes to the same `ag.*` targets. See the source for the full mapping table.

## Adding a New Mapper

1. Create `mappers/my-framework.ts`:

```ts
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { FrameworkMapper } from "./types";
import { estimateCost } from "../cost-estimator";

export const myFrameworkMapper: FrameworkMapper = {
  id: "my-framework",

  detect(span: ReadableSpan): boolean {
    // Return true if this span came from your framework
    return span.name.startsWith("myfw.") ||
      span.attributes["myfw.version"] !== undefined;
  },

  mapAttributes(span: ReadableSpan): void {
    const attrs = span.attributes;
    const m = (span as any).attributes; // mutable access

    // Token metrics
    const promptTokens = attrs["myfw.tokens.input"];
    if (promptTokens !== undefined) {
      m["ag.metrics.tokens.incremental.prompt"] = Number(promptTokens);
    }

    // Model name
    const model = attrs["myfw.model"];
    if (model) {
      m["ag.meta.request.model"] = String(model);
    }

    // Span type
    if (span.name.startsWith("myfw.llm")) {
      m["ag.type.node"] = "chat";
      m["ag.data.inputs"] = JSON.stringify(attrs["myfw.input"]);
      m["ag.data.outputs"] = JSON.stringify(attrs["myfw.output"]);
    } else if (span.name.startsWith("myfw.tool")) {
      m["ag.type.node"] = "tool";
    }

    // Cost estimation (reuse SDK's estimator)
    if (model && promptTokens !== undefined) {
      const cost = estimateCost(String(model), Number(promptTokens), 0);
      if (cost > 0) m["ag.metrics.costs.incremental.total"] = cost;
    }
  },
};
```

2. Register in `mappers/index.ts`:

```ts
import { myFrameworkMapper } from "./my-framework";

const MAPPERS: FrameworkMapper[] = [
  aiSdkMapper,
  mastraMapper,
  myFrameworkMapper,  // Add here
];
```

3. Or register at runtime:

```ts
import { registerMapper } from "@/lib/agenta-sdk/tracing";
registerMapper(myFrameworkMapper); // Call before initAgentaTracing()
```

## `FrameworkMapper` Interface

```ts
interface FrameworkMapper {
  /** Unique identifier */
  readonly id: string;
  /** Return true if this span came from your framework */
  detect(span: ReadableSpan): boolean;
  /** Convert span attributes to ag.* conventions (mutates in place) */
  mapAttributes(span: ReadableSpan): void;
}
```

## Required Agenta Attributes

Your mapper should set as many of these as possible:

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `ag.type.node` | `string` | **Yes** | `"chat"`, `"tool"`, `"agent"`, `"embedding"` |
| `ag.data.inputs` | `string` (JSON) | Recommended | Function/LLM inputs |
| `ag.data.outputs` | `string` (JSON) | Recommended | Function/LLM outputs |
| `ag.metrics.tokens.incremental.prompt` | `number` | Recommended | Prompt tokens |
| `ag.metrics.tokens.incremental.completion` | `number` | Recommended | Completion tokens |
| `ag.metrics.tokens.incremental.total` | `number` | Recommended | Total tokens |
| `ag.meta.request.model` | `string` | Recommended | Model name |
| `ag.meta.system` | `string` | Optional | Provider: `"anthropic"`, `"openai"` |
| `ag.metrics.costs.incremental.total` | `number` | Optional | USD cost estimate |
| `ag.meta.request.streaming` | `boolean` | Optional | Streaming flag |
| `ag.session.id` | `string` | Optional | Session grouping |
| `ag.meta.userId` | `string` | Optional | User filtering |
| `ag.refs.application.id` | `string` | Optional | Links to Agenta app |
| `ag.refs.application_revision.id` | `string` | Optional | Links to specific revision |
