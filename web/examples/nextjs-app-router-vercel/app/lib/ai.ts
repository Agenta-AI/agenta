/**
 * Shared AI SDK helpers used by routes, Server Actions, and (eventually)
 * Server Components. Keeps the demo functions in one place so each route's
 * file stays focused on the request/response wiring.
 *
 * `markFirstHandler` is the assertion-4 sentinel — it stamps a per-app
 * timestamp on the first handler invocation so the assertion can compare
 * against the instrumentation register time.
 */

import {openai} from "@ai-sdk/openai"
import {trace} from "@opentelemetry/api"
import {generateText, streamText, tool, type ModelMessage} from "ai"
import {z} from "zod"

const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "app-router-vercel"

export function markFirstHandler(): void {
    const key = `__agenta_first_handler_${APP_NAME}`
    const g = globalThis as Record<string, unknown>
    if (g[key] === undefined) g[key] = Date.now()
}

/**
 * Force-flush via the OTel global tracer provider directly.
 *
 * The raw variant stashed a flush helper on globalThis from
 * instrumentation.node.ts; @vercel/otel doesn't expose one, so we read
 * the registered provider and call forceFlush() on it. Works on any
 * provider with a flushable processor (Batch or Simple).
 */
export async function flushTraces(): Promise<void> {
    const tp = trace.getTracerProvider() as {forceFlush?: () => Promise<void>}
    if (typeof tp.forceFlush === "function") await tp.forceFlush()
}

export interface AiCallMeta {
    userId: string
    sessionId: string
}

/** Single-shot generateText with tool. Used by Server Action probe + assertion-1/3. */
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
            functionId: "app-router-generate-tool",
            metadata: {userId: meta.userId, sessionId: meta.sessionId},
        },
    })
    return result.text
}

/** streamText for chat routes. Returns the result so the caller can wire it into a Response. */
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
            functionId: "app-router-stream-chat",
            metadata: {userId: meta.userId, sessionId: meta.sessionId},
        },
        abortSignal,
    })
}
