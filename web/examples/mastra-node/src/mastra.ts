/**
 * Mastra setup — one agent that wraps AI SDK calls under the hood.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Phase 6 design question:                                    │
 *   │   Does Mastra-on-AI-SDK inherit our globally-registered     │
 *   │   NodeTracerProvider transparently? Or does Mastra register │
 *   │   its own provider that conflicts?                          │
 *   │                                                             │
 *   │ Setup chosen: PATH A — no `@mastra/observability` install,  │
 *   │ no `observability: new Observability({...})` passed to      │
 *   │ `new Mastra(...)`. Just a bare Agent + the global OTel that │
 *   │ instrumentation.ts registers. If AI SDK's internal spans    │
 *   │ flow through, the global is good. If not, the spike has its │
 *   │ first P-MASTRA pain entry.                                  │
 *   │                                                             │
 *   │ Mastra's `agent.stream/generate` does NOT expose            │
 *   │ `experimental_telemetry` to callers. So we can't pass       │
 *   │ per-call metadata (userId, sessionId) the way every other   │
 *   │ Phase did. Workaround used in the assertions: wrap each     │
 *   │ agent call in a manual parent span carrying the runId in    │
 *   │ its attributes. This mirrors what a real Mastra user has    │
 *   │ to do today.                                                │
 *   └─────────────────────────────────────────────────────────────┘
 */

import {openai} from "@ai-sdk/openai"
import {Agent} from "@mastra/core/agent"
import {Mastra} from "@mastra/core/mastra"
import {createTool} from "@mastra/core/tools"
import {Observability, SamplingStrategyType} from "@mastra/observability"
import {z} from "zod"

import {AgentaMastraExporter} from "./agenta-exporter"

/**
 * Chat agent — uses the same OpenAI model as Phase 1 so the trace
 * comparison is apples-to-apples. The only difference is the framing
 * layer (Mastra Agent) wrapping the AI SDK call.
 */
export const chatAgent = new Agent({
    name: "chat-agent",
    instructions: "You are a concise assistant. Answer in one short sentence.",
    model: openai("gpt-4o-mini"),
})

/**
 * Weather agent with a zod-typed tool — exercises the tool-call path
 * that Phase 1 also tests. Lets us see how Mastra's tool span shape
 * compares to AI SDK's bare `ai.toolCall` span.
 */
const weatherTool = createTool({
    id: "get-weather",
    description: "Get current weather for a city",
    inputSchema: z.object({
        city: z.string().describe("City name, e.g. Berlin"),
    }),
    execute: async (inputData) => {
        return {city: inputData.city, tempC: 18, condition: "partly cloudy"}
    },
})

export const weatherAgent = new Agent({
    name: "weather-agent",
    instructions:
        "When the user asks about weather, use the get-weather tool. Reply with one sentence summarizing the result.",
    model: openai("gpt-4o-mini"),
    tools: {getWeather: weatherTool},
})

/**
 * Mastra instance — Path B test.
 *
 * Path A (bare Mastra) was empirically proven to emit ZERO AI SDK spans
 * regardless of globally-registered NodeTracerProvider. Mastra's vendored
 * AI SDK v1 returns a noopTracer when `isEnabled: false`, and Mastra
 * doesn't expose `experimental_telemetry` to callers. P-MASTRA-01.
 *
 * Path B: install `@mastra/observability` and pass a configured
 * `Observability` instance. Even with a no-op-ish ConsoleExporter, the
 * mere presence of Observability MAY flip Mastra's internal AI SDK
 * telemetry on, which would let the global OTel provider (registered
 * in instrumentation.ts) catch the `ai.*` spans.
 *
 * The trace probe afterwards reveals the truth empirically.
 */
const APP_NAME_FOR_SERVICE = process.env.AGENTA_SPIKE_APP_NAME ?? "mastra-node"
const observability = new Observability({
    configs: {
        default: {
            name: "default",
            serviceName: `vercel-ai-spike-${APP_NAME_FOR_SERVICE}`,
            sampling: {type: SamplingStrategyType.ALWAYS},
            // AgentaMastraExporter ships Mastra TracingEvents to Agenta's
            // OTLP endpoint as OTel-shaped spans. This is the PoC of what
            // @agenta/sdk-mastra would package as a one-line install.
            exporters: [
                new AgentaMastraExporter({
                    host: process.env.AGENTA_HOST || "https://cloud.agenta.ai",
                    apiKey: process.env.AGENTA_API_KEY ?? "",
                    projectId: process.env.AGENTA_PROJECT_ID ?? "",
                    serviceName: `vercel-ai-spike-${APP_NAME_FOR_SERVICE}`,
                }),
            ],
        },
    },
})

export const mastra = new Mastra({
    agents: {chatAgent, weatherAgent},
    observability,
})

/**
 * First-handler sentinel — same shape as Phase 1's `markFirstHandler`,
 * called once on the first AI SDK invocation so assertion-4 can
 * compare register-before-handler ordering.
 */
const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "mastra-node"
export function markFirstHandler(): void {
    const key = `__agenta_first_handler_${APP_NAME}`
    const g = globalThis as Record<string, unknown>
    if (g[key] === undefined) g[key] = Date.now()
}
