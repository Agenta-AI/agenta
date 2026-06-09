/**
 * Phase 6 demo entry — Node + Mastra + AI SDK v6 + raw OTel.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Three demos, mirroring Phase 1's shape so the trace probe   │
 *   │ has a like-for-like comparison:                             │
 *   │                                                             │
 *   │   demoChatGenerate(runId)   — agent.generate() one-shot     │
 *   │   demoChatStream(runId, ac) — agent.stream() with abort     │
 *   │   demoWeatherToolCall(runId) — agent.generate() w/ tool     │
 *   │                                                             │
 *   │ Each demo passes `tracingOptions.metadata` (Mastra's        │
 *   │ canonical per-call metadata path) carrying userId/sessionId.│
 *   │ Our AgentaMastraExporter reads these off `span.metadata`    │
 *   │ and writes them as `ag.user.id` / `ag.session.id` on the    │
 *   │ exported OTLP span.                                         │
 *   └─────────────────────────────────────────────────────────────┘
 */

import "dotenv/config"
import {trace} from "@opentelemetry/api"

import {chatAgent, markFirstHandler, mastra, weatherAgent} from "./mastra"

// Reference `mastra` to ensure the Mastra instance + Observability +
// AgentaMastraExporter all initialize before the first agent call. Without
// this import-side-effect path, the exporter wouldn't be subscribed to
// Mastra's bus when the spans start firing.
void mastra

/** Single agent.generate() call with Mastra metadata. */
export async function demoChatGenerate(opts?: {runId?: string}): Promise<string> {
    markFirstHandler()
    const runId = opts?.runId ?? "u-demo"
    const result = await chatAgent.generate(
        "Write a one-sentence story about a robot learning to paint.",
        {
            tracingOptions: {
                metadata: {userId: runId, sessionId: runId},
            },
        },
    )
    return result.text ?? ""
}

/** agent.stream() with Mastra metadata. */
export async function demoChatStream(opts?: {
    runId?: string
    abortSignal?: AbortSignal
}): Promise<{text: string}> {
    markFirstHandler()
    const runId = opts?.runId ?? "u-demo"
    const stream = await chatAgent.stream("Tell me a tiny story about a curious cat.", {
        abortSignal: opts?.abortSignal,
        tracingOptions: {
            metadata: {userId: runId, sessionId: runId},
        },
    })
    let text = ""
    for await (const chunk of stream.textStream) {
        text += chunk
    }
    return {text}
}

/** generate() with a tool call + metadata. */
export async function demoWeatherToolCall(opts?: {runId?: string}): Promise<string> {
    markFirstHandler()
    const runId = opts?.runId ?? "u-demo"
    const result = await weatherAgent.generate(
        "What's the weather in Berlin? Use the get-weather tool.",
        {
            tracingOptions: {
                metadata: {userId: runId, sessionId: runId},
            },
        },
    )
    return result.text ?? ""
}

/**
 * Force-flush spans before the process exits. With the AgentaMastraExporter
 * we drain its internal buffer via the Observability shutdown path.
 */
export async function flushTraces(): Promise<void> {
    const tp = trace.getTracerProvider() as {forceFlush?: () => Promise<void>}
    if (typeof tp.forceFlush === "function") await tp.forceFlush()
    // Drain the Mastra-side exporter buffer too.
    const obsShutdown = (mastra as {observability?: {shutdown?: () => Promise<void>}}).observability
        ?.shutdown
    if (typeof obsShutdown === "function") await obsShutdown.call(mastra.observability)
}

// --- interactive entry point ---

const isMain =
    import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith("app.ts") ||
    process.argv[1]?.endsWith("app.js")

if (isMain) {
    ;(async () => {
        try {
            console.log("→ demoChatGenerate...")
            const story = await demoChatGenerate({runId: `demo-${Date.now()}`})
            console.log(`  ${story}`)

            console.log("→ demoChatStream...")
            const {text} = await demoChatStream({runId: `demo-${Date.now()}`})
            console.log(`  ${text}`)

            console.log("→ demoWeatherToolCall...")
            const weather = await demoWeatherToolCall({runId: `demo-${Date.now()}`})
            console.log(`  ${weather}`)

            await flushTraces()
            console.log("→ traces flushed.")
        } catch (err) {
            console.error("app.ts error:", err)
            process.exit(1)
        }
    })()
}
