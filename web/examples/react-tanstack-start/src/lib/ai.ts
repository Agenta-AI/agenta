/**
 * Shared AI SDK helpers for TanStack Start routes.
 *
 * Mirrors web/examples/nextjs-app-router-raw/app/lib/ai.ts since
 * TanStack Start server routes return a fetch Response (via
 * `result.toUIMessageStreamResponse()`) just like App Router — the
 * sink shape is identical. The only framework-specific thing is the
 * `createFileRoute` entry shape in the route files themselves.
 */

import {openai} from "@ai-sdk/openai"
import {generateText, streamText, tool, type ModelMessage} from "ai"
import {z} from "zod"

const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "tanstack-start"

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

/** Single-shot generateText with tool. */
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
            functionId: "tanstack-start-generate-tool",
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
            functionId: "tanstack-start-stream-chat",
            metadata: {userId: meta.userId, sessionId: meta.sessionId},
        },
        abortSignal,
    })
}
