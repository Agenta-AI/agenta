# Agenta SDK — Mastra Adapter

Integration layer for [Mastra](https://mastra.ai). This module wraps Mastra's agent responses with Agenta tracing and provides prompt registry access. It does NOT import from the `ai` package — only `@opentelemetry/api`.

## Exports

```ts
import {
  createMastraTracedStream,    // Wrap streaming responses with tracing
  createMastraTracedGenerate,  // Wrap non-streaming responses with tracing
  getMastraPromptConfig,       // Fetch prompt config for agent construction
  initAgentaTracing,           // Re-exported from tracing (convenience)
  withSpan,                    // Re-exported from tracing (convenience)
} from "@/lib/agenta-sdk/mastra";
```

## `createMastraTracedStream`

Wraps a Mastra agent's streaming output with Agenta tracing.

```ts
import { createMastraTracedStream } from "@/lib/agenta-sdk/mastra";

const { textStream, traceId, output } = await createMastraTracedStream({
  agent: myMastraAgent,
  messages: [{ role: "user", content: "Hello" }],
  sessionId: "session-123",
  applicationSlug: "my-agent",
});

// Stream to the client
return new Response(textStream, {
  headers: {
    "Content-Type": "text/event-stream",
    "X-Agenta-Trace-Id": traceId,  // Client reads this for annotations
  },
});
```

### What it does

1. Auto-initializes Agenta tracing
2. Creates a parent span with session/user/app attributes
3. Calls `agent.stream(messages)` inside the OTel context
4. Wraps the text stream — ends the span when the stream completes (or errors)
5. Returns the `traceId` for client-side annotation linking

### Return value

```ts
interface MastraTracedStreamResult {
  textStream: ReadableStream<string>;  // The wrapped stream
  traceId: string;                     // OTel trace ID for annotations
  output: unknown;                     // Full Mastra output object
}
```

## `createMastraTracedGenerate`

Non-streaming equivalent — for when you want the full output at once.

```ts
const { output, traceId } = await createMastraTracedGenerate({
  agent: myMastraAgent,
  messages,
  sessionId,
});
```

## `getMastraPromptConfig`

Fetches prompt configuration from Agenta's registry. Returns raw config that you wire into Mastra's agent builder.

```ts
import { getMastraPromptConfig } from "@/lib/agenta-sdk/mastra";

const config = await getMastraPromptConfig({
  promptSlugs: ["voice", "onboarding", "workflow"],
  environment: "development",
  fallbacks: { voice: localVoicePrompt },
});

// Wire into Mastra
const agent = new Agent({
  name: "my-agent",
  instructions: config.instructions,
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { ...myTools },
});
```

### Return value

```ts
interface MastraPromptConfig {
  instructions: string;                              // Composed prompt text
  toolSchemas: Record<string, ToolSchema>;            // Tool schemas from Agenta
  applicationId: string | null;                       // For telemetry
  revisionId: string | null;                          // For telemetry
  revisionIds: Record<string, string>;                // Per-slug revision IDs
  source: "environment" | "latest" | "fallback";      // Where data came from
}
```

## Full Integration Example

```ts
// server.ts
import { getMastraPromptConfig, createMastraTracedStream } from "@/lib/agenta-sdk/mastra";
import { Agent } from "@mastra/core";

// 1. Get prompts from Agenta
const config = await getMastraPromptConfig({
  promptSlugs: ["voice", "onboarding"],
  environment: "development",
});

// 2. Create Mastra agent
const agent = new Agent({
  name: "my-agent",
  instructions: config.instructions,
  model: anthropic("claude-sonnet-4-20250514"),
});

// 3. Handle a request with tracing
export async function handleChat(messages, sessionId) {
  const { textStream, traceId } = await createMastraTracedStream({
    agent,
    messages,
    sessionId,
    applicationSlug: "onboarding",
  });

  return new Response(textStream, {
    headers: { "X-Agenta-Trace-Id": traceId },
  });
}
```

## Options (shared by stream + generate)

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `agent` | Mastra Agent | Yes | The agent to call |
| `messages` | `Array<{ role, content }>` | Yes | Chat messages |
| `sessionId` | `string` | No | Groups spans |
| `userId` | `string` | No | Tagged on spans |
| `applicationSlug` | `string` | No | Links traces to prompt app |
| `applicationId` | `string` | No | Explicit app ID |
| `applicationRevisionId` | `string` | No | Explicit revision ID |
| `onFinish` | `(result) => void` | No | Called after completion |
| `onError` | `(error) => string` | No | Called on error |
