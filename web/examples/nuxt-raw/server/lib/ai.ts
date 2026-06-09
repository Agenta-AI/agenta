/**
 * Shared AI SDK helpers for Nuxt server routes. Mirrors the structure of
 * the Next.js spikes' lib/ai.ts so the trace shape comparison is apples-
 * to-apples (same `experimental_telemetry` setup, same span names, same
 * metadata path).
 */

import {openai} from "@ai-sdk/openai"
import {generateText, streamText, tool, type ModelMessage} from "ai"
import {z} from "zod"

const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "nuxt-raw"

export function markFirstHandler(): void {
    const key = `__agenta_first_handler_${APP_NAME}`
    const g = globalThis as Record<string, unknown>
    if (g[key] === undefined) g[key] = Date.now()
}

export async function flushTraces(): Promise<void> {
    const flush = (globalThis as Record<string, unknown>).__agenta_flush_traces as
        | (() => Promise<void>)
        | undefined
    if (typeof flush === "function") await flush()
}

export interface AiCallMeta {
    userId: string
    sessionId: string
}

/** Single-shot generateText with tool — assertion-3 metadata round-trip. */
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
            functionId: "nuxt-generate-tool",
            metadata: {userId: meta.userId, sessionId: meta.sessionId},
        },
    })
    return result.text
}

/** streamText for chat routes. Caller wraps in toUIMessageStreamResponse(). */
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
            functionId: "nuxt-stream-chat",
            metadata: {userId: meta.userId, sessionId: meta.sessionId},
        },
        abortSignal,
    })
}
