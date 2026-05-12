# Agenta SDK — AI SDK Adapter

Integration layer for [Vercel AI SDK v6](https://sdk.vercel.ai). This is the ONLY module that imports from the `ai` package — the core SDK and tracing pipeline remain framework-agnostic.

## Exports

```ts
import {
  createAgentaTracedResponse,  // Wrap chat route with tracing
  createAgentWithPrompts,      // Create agent with Agenta-managed prompts
  initAgentaTracing,           // Re-exported from tracing (convenience)
  withSpan,                    // Re-exported from tracing (convenience)
} from "@/lib/agenta-sdk/ai";
```

## `createAgentaTracedResponse`

The primary integration point for chat API routes. Replaces ~60 lines of manual OTel ceremony with one function call.

```ts
// app/api/chat/route.ts
import { createAgentaTracedResponse } from "@/lib/agenta-sdk/ai";

export async function POST(req: Request) {
  const { messages, sessionId } = await req.json();
  const agent = await createMyAgent();

  return createAgentaTracedResponse({
    agent,
    messages,
    sessionId,
    applicationSlug: "my-app",
    onFinish: ({ messages }) => {
      // Your persistence logic — runs after span ends
    },
    onError: (error) => {
      // Your error handling — runs after span ends
      return "Something went wrong.";
    },
  });
}
```

### What it does automatically

1. **Auto-initializes tracing** — calls `initAgentaTracing()` lazily on first use
2. **Creates a parent span** — `chat:{sessionId}` with Agenta attributes
3. **Wraps in OTel context** — AI SDK child spans become children of the parent
4. **Injects trace ID** — `messageMetadata` callback sends `{ traceId }` to the client
5. **Manages span lifecycle** — ends span in `onFinish` (success) or `onError` (failure)
6. **Forwards callbacks** — your `onFinish`/`onError` still work, called after span ends

### Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `agent` | `Agent` | Yes | AI SDK agent (ToolLoopAgent or custom) |
| `messages` | `UIMessage[]` | Yes | Chat messages |
| `sessionId` | `string` | No | Groups spans + enables session queries |
| `userId` | `string` | No | Tagged on spans for filtering |
| `applicationSlug` | `string` | No | Links traces to Agenta prompt app |
| `applicationId` | `string` | No | Explicit app ID (overrides slug lookup) |
| `applicationRevisionId` | `string` | No | Explicit revision ID |
| `onFinish` | `(event) => void` | No | Called after streaming completes |
| `onError` | `(error) => string` | No | Called on error, return user-facing message |

## `createAgentWithPrompts`

Creates a `ToolLoopAgent` with instructions composed from Agenta's prompt registry, tool schemas merged from Agenta, and telemetry pre-configured.

```ts
import { createAgentWithPrompts } from "@/lib/agenta-sdk/ai";
import { stepCountIs } from "ai";

const agent = await createAgentWithPrompts({
  model: getModel(),
  applicationSlug: "rh-onboarding",
  promptSlugs: ["rh-voice", "rh-onboarding", "rh-workflow"],
  environment: "development",
  tools: myLocalTools,
  fallbacks: localFallbacks,
  dynamicSections: {
    integrations: "## Connected: Stripe, Google Sheets",
  },
  stopWhen: stepCountIs(15),
});
```

### What it does automatically

1. **Fetches prompts** — from the deployed environment (with caching + fallbacks)
2. **Extracts tool schemas** — from Agenta's prompt apps
3. **Merges tool schemas** — overrides local tool descriptions/parameters with Agenta-managed versions (keeps local `execute` functions)
4. **Resolves app refs** — gets `applicationId` + `revisionId` for telemetry
5. **Configures telemetry** — sets `experimental_telemetry` with all Agenta metadata
6. **Creates the agent** — returns a ready-to-use `ToolLoopAgent`

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `LanguageModel` | Required | LLM model |
| `promptSlugs` | `string[]` | `[]` | Prompt modules to compose, in order |
| `environment` | `string` | `"development"` | Environment to fetch from |
| `tools` | `ToolSet` | `{}` | Local tools (SDK merges Agenta schemas on top) |
| `fallbacks` | `Record<string, string>` | `{}` | Local fallback prompt content |
| `dynamicSections` | `Record<string, string>` | — | Appended after all modules |
| `templateVars` | `Record<string, string>` | — | `{{key}}` interpolation |
| `stopWhen` | `StopCondition` | — | Agent loop stop condition |
| `applicationSlug` | `string` | First promptSlug | Primary app for telemetry |
| `agenta` | `Agenta` | Auto-created | SDK client instance |
| `telemetry` | `boolean` | Auto (checks API key) | Enable/disable |
| `telemetryMetadata` | `Record<string, string>` | `{}` | Extra metadata on spans |

## Migration from Manual Setup

### Before (manual, ~100 lines across 3 files)

```ts
// lib/agent.ts
const [instructions, schemas, refs] = await Promise.all([
  composeInstructions(MODULE_ORDER, getFallbacks(), { integrations }),
  fetchToolSchemas(),
  getApplicationRefs(),
]);
const tools = mergeAgentaSchemas(localTools, schemas);
return new ToolLoopAgent({
  model, instructions, tools,
  experimental_telemetry: { isEnabled: true, metadata: { applicationId: refs.applicationId } },
});

// app/api/chat/route.ts
const tracer = otelTrace.getTracer("my-app");
const span = tracer.startSpan(`chat:${sessionId}`);
const traceId = span.spanContext().traceId;
const ctx = otelTrace.setSpan(otelContext.active(), span);
return otelContext.with(ctx, () => {
  return createAgentUIStreamResponse({
    agent, uiMessages: messages,
    messageMetadata: () => ({ traceId }),
    onFinish: () => { span.end(); },
    onError: () => { span.end(); },
  });
});

// instrumentation.ts
initTelemetry(); // 500 lines of custom OTel setup
```

### After (SDK, ~15 lines total)

```ts
// lib/agent.ts
import { createAgentWithPrompts } from "@/lib/agenta-sdk/ai";
return createAgentWithPrompts({
  model: getModel(),
  promptSlugs: [...MODULE_ORDER],
  tools: localTools,
  fallbacks: getFallbacks(),
});

// app/api/chat/route.ts
import { createAgentaTracedResponse } from "@/lib/agenta-sdk/ai";
return createAgentaTracedResponse({ agent, messages, sessionId });

// instrumentation.ts — not needed (auto-initializes)
```
