/**
 * Agenta SDK — AI SDK Adapter: Traced Response.
 *
 * Wraps Vercel AI SDK's `createAgentUIStreamResponse` with automatic
 * Agenta tracing initialization and trace ID injection into message metadata.
 *
 * The trace ID is captured from the active OTel span during streaming
 * and sent to the client as `message.metadata.traceId`, enabling
 * annotation controls to link back to the correct Agenta trace.
 */

import {createAgentUIStreamResponse} from "ai"
import type {UIMessage} from "ai"
import {trace as otelTrace, context as otelContext} from "@opentelemetry/api"
import type {AgentaTracedResponseOptions} from "./types"
import {initAgentaTracing} from "@agenta/sdk-tracing"

/**
 * Read the trace ID from the active OTel span context.
 * Returns undefined if no span is active (tracing disabled or not yet started).
 */
function getActiveTraceId(): string | undefined {
    const span = otelTrace.getSpan(otelContext.active())
    if (!span) return undefined
    const ctx = span.spanContext()
    // OTel trace IDs are 32-char hex; skip the "all zeros" invalid trace
    if (ctx.traceId === "00000000000000000000000000000000") return undefined
    return ctx.traceId
}

/**
 * Create a streaming response with automatic Agenta tracing.
 *
 * The agent's `experimental_telemetry` (set by `createAgentWithPrompts`)
 * already carries session, application, and user metadata. This function
 * ensures tracing is initialized, captures the OTel trace ID during
 * streaming, and injects it into message metadata so the client can
 * use it for annotations.
 */
export function createAgentaTracedResponse(
    options: AgentaTracedResponseOptions,
): Response | Promise<Response> {
    const {agent, messages, onFinish: consumerOnFinish, onError: consumerOnError} = options

    // Auto-init tracing on first use (no-op if already initialized or no API key)
    initAgentaTracing()

    // Capture trace ID once during streaming and inject into message metadata.
    // The AI SDK creates an `ai.streamText` OTel span that becomes the active
    // span during the streaming pipeline — messageMetadata is called inside
    // that context, so getActiveTraceId() returns the correct trace ID.
    let capturedTraceId: string | undefined

    return createAgentUIStreamResponse({
        agent,
        uiMessages: messages as UIMessage[],
        messageMetadata: ({part}) => {
            // Capture on the first part we see — the OTel span is active by then
            if (!capturedTraceId) {
                capturedTraceId = getActiveTraceId()
            }

            // Only send metadata on start/finish events (the stream protocol
            // sends messageMetadata on 'start' and 'finish' chunk types)
            if (part.type === "start" || part.type === "finish") {
                return capturedTraceId ? {traceId: capturedTraceId} : undefined
            }
            return undefined
        },
        onFinish: consumerOnFinish as (event: {messages: UIMessage[]}) => void,
        onError: consumerOnError,
    })
}
