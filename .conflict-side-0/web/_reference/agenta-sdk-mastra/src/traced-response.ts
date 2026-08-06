/**
 * Agenta SDK — Mastra Adapter: Traced Response.
 *
 * Wraps Mastra's agent stream/generate with Agenta tracing context.
 *
 * Unlike the AI SDK adapter, Mastra handles its own OTel spans internally.
 * The Agenta exporter (with the Mastra mapper) processes them at export time.
 * This adapter's job is to:
 *   1. Ensure tracing is initialized
 *   2. Set Agenta-specific attributes on a parent span (session, user, app refs)
 *   3. Extract the trace ID from Mastra's output for client-side annotation linking
 *   4. Return the result in a consumer-friendly format
 *
 * ```ts
 * import { createMastraTracedResponse } from "@agenta/sdk/mastra";
 *
 * const { textStream, traceId } = await createMastraTracedStream({
 *   agent: myMastraAgent,
 *   messages: [{ role: "user", content: "Hello" }],
 *   sessionId: "session-123",
 *   applicationSlug: "my-agent",
 * });
 *
 * // Stream the response
 * return new Response(textStream, {
 *   headers: {
 *     "Content-Type": "text/event-stream",
 *     "X-Agenta-Trace-Id": traceId,
 *   },
 * });
 * ```
 */

import {initAgentaTracing, createTracedContext} from "@agenta/sdk-tracing"
import {context as otelContext, SpanStatusCode} from "@opentelemetry/api"

import type {MastraTracedResponseOptions} from "./types"

/**
 * Result from a traced Mastra stream.
 */
export interface MastraTracedStreamResult {
    /** The text stream from Mastra's output */
    textStream: ReadableStream<string>
    /** OTel trace ID for client-side annotation linking */
    traceId: string
    /** The full Mastra output object (for accessing objectStream, getFullOutput, etc.) */
    output: unknown
}

/**
 * Result from a traced Mastra generate (non-streaming).
 */
export interface MastraTracedGenerateResult {
    /** The full output from Mastra */
    output: unknown
    /** OTel trace ID for client-side annotation linking */
    traceId: string
}

/**
 * Create a traced streaming response from a Mastra agent.
 *
 * Mastra creates its own OTel spans internally. This wrapper:
 * 1. Auto-initializes Agenta tracing (if not already done)
 * 2. Creates a parent span with Agenta-specific attributes
 * 3. Calls agent.stream() inside the span context
 * 4. Extracts traceId from Mastra's output (or from the parent span)
 * 5. Ends the span when the stream completes
 */
export async function createMastraTracedStream(
    options: MastraTracedResponseOptions,
): Promise<MastraTracedStreamResult> {
    const {
        agent,
        messages,
        sessionId,
        userId,
        applicationSlug,
        applicationId,
        applicationRevisionId,
        onFinish: consumerOnFinish,
        onError: consumerOnError,
    } = options

    // Auto-init tracing
    initAgentaTracing()

    const traced = createTracedContext({
        sessionId,
        userId,
        applicationId,
        applicationRevisionId,
        applicationSlug,
    })

    // No tracer — run without tracing wrapper
    if (!traced) {
        const output = await agent.stream(messages)
        const traceId = output.traceId ?? ""
        return {textStream: output.textStream, traceId, output}
    }

    const {span: chatSpan, context: chatContext} = traced

    // Run Mastra agent inside the span context
    const output = await otelContext.with(chatContext, () => agent.stream(messages))

    // Extract trace ID — prefer Mastra's (it's the inner trace),
    // fall back to our parent span's trace ID
    const traceId = output.traceId ?? chatSpan.spanContext().traceId

    // Wrap the text stream to end the span when done
    const originalStream = output.textStream as ReadableStream<string>
    const wrappedStream = new ReadableStream<string>({
        async start(controller) {
            try {
                const reader = originalStream.getReader()
                while (true) {
                    const {done, value} = await reader.read()
                    if (done) break
                    controller.enqueue(value)
                }
                controller.close()
                chatSpan.setStatus({code: SpanStatusCode.OK})
                chatSpan.end()
                consumerOnFinish?.(output)
            } catch (error) {
                controller.error(error)
                chatSpan.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: error instanceof Error ? error.message : String(error),
                })
                chatSpan.end()
                consumerOnError?.(error)
            }
        },
    })

    return {textStream: wrappedStream, traceId, output}
}

/**
 * Create a traced non-streaming response from a Mastra agent.
 *
 * For non-streaming use cases where you want the full output at once.
 */
export async function createMastraTracedGenerate(
    options: MastraTracedResponseOptions,
): Promise<MastraTracedGenerateResult> {
    const {
        agent,
        messages,
        sessionId,
        userId,
        applicationSlug,
        applicationId,
        applicationRevisionId,
        onFinish: consumerOnFinish,
        onError: consumerOnError,
    } = options

    initAgentaTracing()

    const traced = createTracedContext({
        sessionId,
        userId,
        applicationId,
        applicationRevisionId,
        applicationSlug,
    })

    if (!traced) {
        const output = await agent.generate(messages)
        return {output, traceId: output.traceId ?? ""}
    }

    const {span: chatSpan, context: chatContext} = traced

    try {
        const output = await otelContext.with(chatContext, () => agent.generate(messages))
        chatSpan.setStatus({code: SpanStatusCode.OK})
        chatSpan.end()
        consumerOnFinish?.(output)
        return {output, traceId: output.traceId ?? chatSpan.spanContext().traceId}
    } catch (error) {
        chatSpan.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
        })
        chatSpan.end()
        consumerOnError?.(error)
        throw error
    }
}
