/**
 * Phase 1 / App 1 demo entry — Node + AI SDK v6 + raw OTel.
 *
 * Three demos exposed as named functions, importable by the assertion scripts
 * AND runnable interactively via `pnpm dev`:
 *
 *   demoGenerateText()  — single-shot generation with metadata + tool call
 *   demoStreamText()    — streaming response (returns the AsyncIterable)
 *   demoToolCall()      — generateText with a forced tool call
 *
 * `experimental_telemetry: { isEnabled: true }` triggers the AI SDK's built-in
 * OTel spans (`ai.generateText`, `ai.streamText`, `ai.toolCall`, etc.). The
 * Agenta `VercelAIAdapter` maps `ai.*` → `ag.*` server-side.
 *
 * NOTE on first-handler sentinel (assertion 4): each public demo writes the
 * `__agenta_first_handler_<APP>` sentinel exactly once, so the assertion can
 * compare instrumentation-register-time vs first-call-time.
 */

import "dotenv/config"
import {openai} from "@ai-sdk/openai"
import {trace} from "@opentelemetry/api"
import {generateText, streamText, tool} from "ai"
import {z} from "zod"

const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "node"

/** Set the first-handler sentinel exactly once. Read by assertion 4. */
function markFirstHandler(): void {
    const key = `__agenta_first_handler_${APP_NAME}`
    const g = globalThis as Record<string, unknown>
    if (g[key] === undefined) {
        g[key] = Date.now()
    }
}

/** Single generateText call with telemetry metadata. */
export async function demoGenerateText(opts?: {
    userId?: string
    sessionId?: string
}): Promise<string> {
    markFirstHandler()
    const result = await generateText({
        model: openai("gpt-4o-mini"),
        messages: [
            {role: "system", content: "You are a helpful assistant. Reply in one sentence."},
            {role: "user", content: "Write a one-sentence story about a robot learning to paint."},
        ],
        experimental_telemetry: {
            isEnabled: true,
            functionId: "demo-generate-text",
            metadata: {
                userId: opts?.userId ?? "u-demo",
                sessionId: opts?.sessionId ?? "s-demo",
            },
        },
    })
    return result.text
}

/** streamText call. Returns the result so callers can pull from `.textStream`. */
export function demoStreamText(opts?: {
    userId?: string
    sessionId?: string
    abortSignal?: AbortSignal
}): ReturnType<typeof streamText> {
    markFirstHandler()
    return streamText({
        model: openai("gpt-4o-mini"),
        messages: [
            {role: "system", content: "You are a helpful assistant. Reply in two short sentences."},
            {role: "user", content: "Tell me a tiny story about a curious cat."},
        ],
        experimental_telemetry: {
            isEnabled: true,
            functionId: "demo-stream-text",
            metadata: {
                userId: opts?.userId ?? "u-demo",
                sessionId: opts?.sessionId ?? "s-demo",
            },
        },
        abortSignal: opts?.abortSignal,
    })
}

/** generateText with a tool — exercises `ai.toolCall` child span shape. */
export async function demoToolCall(opts?: {userId?: string; sessionId?: string}): Promise<string> {
    markFirstHandler()
    const result = await generateText({
        model: openai("gpt-4o-mini"),
        messages: [
            {role: "user", content: "What's the weather in Berlin? Use the getWeather tool."},
        ],
        tools: {
            getWeather: tool({
                description: "Get current weather for a city",
                inputSchema: z.object({
                    city: z.string().describe("City name, e.g. Berlin"),
                }),
                execute: async ({city}) => {
                    return {city, tempC: 18, condition: "partly cloudy"}
                },
            }),
        },
        experimental_telemetry: {
            isEnabled: true,
            functionId: "demo-tool-call",
            metadata: {
                userId: opts?.userId ?? "u-demo",
                sessionId: opts?.sessionId ?? "s-demo",
            },
        },
    })
    return result.text
}

/** Force-flush spans before the process exits. */
export async function flushTraces(): Promise<void> {
    const tracerProvider = trace.getTracerProvider() as {forceFlush?: () => Promise<void>}
    if (typeof tracerProvider.forceFlush === "function") {
        await tracerProvider.forceFlush()
    }
}

// --- interactive entry point ---

const isMain =
    import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith("app.ts") ||
    process.argv[1]?.endsWith("app.js")

if (isMain) {
    ;(async () => {
        try {
            console.log("→ demoGenerateText...")
            const story = await demoGenerateText()
            console.log(`  ${story}`)

            console.log("→ demoStreamText...")
            const stream = demoStreamText()
            let streamed = ""
            for await (const chunk of stream.textStream) {
                streamed += chunk
                process.stdout.write(chunk)
            }
            process.stdout.write("\n")
            void streamed

            console.log("→ demoToolCall...")
            const weather = await demoToolCall()
            console.log(`  ${weather}`)

            await flushTraces()
            console.log("→ traces flushed.")
        } catch (err) {
            console.error("app.ts error:", err)
            process.exit(1)
        }
    })()
}
