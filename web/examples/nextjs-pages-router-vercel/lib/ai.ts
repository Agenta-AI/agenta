/**
 * Shared AI SDK helpers for Pages Router routes.
 *
 * Same shape as the App Router raw spike's lib/ai.ts. Pages Router has
 * no Server Actions and no Server Components, so the surface is smaller —
 * just the streamText helper for the chat route + a generateText helper
 * for one-shot tool-call probes via the API path.
 *
 * `markFirstHandler` stamps the assertion-4 sentinel on the first
 * handler invocation so the test can verify instrumentation register
 * happened before any AI handler ran.
 */

import {openai} from "@ai-sdk/openai"
import {trace} from "@opentelemetry/api"
import {generateText, streamText, tool, type ModelMessage} from "ai"
import {z} from "zod"

const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "pages-vercel"

export function markFirstHandler(): void {
    const key = `__agenta_first_handler_${APP_NAME}`
    const g = globalThis as Record<string, unknown>
    if (g[key] === undefined) g[key] = Date.now()
}

/** @vercel/otel doesn't expose a globalThis flush helper — read the global tracer provider directly. */
export async function flushTraces(): Promise<void> {
    const tp = trace.getTracerProvider() as {forceFlush?: () => Promise<void>}
    if (typeof tp.forceFlush === "function") await tp.forceFlush()
}

export interface AiCallMeta {
    userId: string
    sessionId: string
}

/** Single-shot generateText with tool. Used by Pages chat-warmup probes. */
export async function runGenerateWithTool(
    messages: ModelMessage[],
    meta: AiCallMeta,
): Promise<string> {
    markFirstHandler()
    const result = await generateText({
        model: openai("gpt-4o-mini"),
        messages,
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
            functionId: "pages-router-generate-tool",
            metadata: {userId: meta.userId, sessionId: meta.sessionId},
        },
    })
    return result.text
}

/** streamText for chat routes. Caller pipes into the Pages res with pipeUIMessageStreamToResponse. */
export function runStreamChat(
    messages: ModelMessage[],
    meta: AiCallMeta,
    abortSignal?: AbortSignal,
): ReturnType<typeof streamText> {
    markFirstHandler()
    return streamText({
        model: openai("gpt-4o-mini"),
        messages,
        experimental_telemetry: {
            isEnabled: true,
            functionId: "pages-router-stream-chat",
            metadata: {userId: meta.userId, sessionId: meta.sessionId},
        },
        abortSignal,
    })
}
