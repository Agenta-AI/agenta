/**
 * Agenta SDK Tracing — Helper utilities.
 *
 * Provides convenience functions for manual span instrumentation
 * and access to the global tracer.
 */

import {
    trace,
    context as otelContext,
    ROOT_CONTEXT,
    SpanStatusCode,
    type Tracer,
    type Span,
    type SpanContext,
    type AttributeValue,
    type SpanStatus,
    type TimeInput,
    type SpanAttributes,
    type Exception,
    type Link,
    TraceFlags,
} from "@opentelemetry/api"

import type {SpanOptions} from "./types"

// ─── NoOp Span ──────────────────────────────────────────────────────────────
// Used when tracing isn't initialized so consumers can call span methods safely.

const NOOP_SPAN_CONTEXT: SpanContext = {
    traceId: "0".repeat(32),
    spanId: "0".repeat(16),
    traceFlags: TraceFlags.NONE,
}

class NoOpSpan implements Span {
    spanContext(): SpanContext {
        return NOOP_SPAN_CONTEXT
    }
    setAttribute(_key: string, _value: AttributeValue): this {
        return this
    }
    setAttributes(_attributes: SpanAttributes): this {
        return this
    }
    addEvent(
        _name: string,
        _attributesOrTime?: SpanAttributes | TimeInput,
        _startTime?: TimeInput,
    ): this {
        return this
    }
    addLink(_link: Link): this {
        return this
    }
    addLinks(_links: Link[]): this {
        return this
    }
    setStatus(_status: SpanStatus): this {
        return this
    }
    updateName(_name: string): this {
        return this
    }
    end(_endTime?: TimeInput): void {
        /* no-op */
    }
    isRecording(): boolean {
        return false
    }
    recordException(_exception: Exception, _time?: TimeInput): void {
        /* no-op */
    }
}

const NOOP_SPAN = new NoOpSpan()

// ─── Constants (shared across all framework adapters) ───────────────────────

export const TRACER_NAME = "agenta-sdk"
export const TRACER_VERSION = "0.1.0"

/**
 * Get the global OTel tracer for Agenta spans.
 * Returns null if tracing hasn't been initialized.
 */
export function getTracer(): Tracer | null {
    try {
        return trace.getTracer(TRACER_NAME, TRACER_VERSION)
    } catch {
        return null
    }
}

/**
 * Wrap an async function in a traced span.
 *
 * Sets Agenta attributes automatically (type, inputs, outputs).
 * If tracing isn't initialized, the function runs without a span.
 *
 * ```ts
 * const result = await withSpan(
 *   { name: "tool:detectStore", type: "tool", inputs: { url } },
 *   async (span) => {
 *     const data = await detectStore(url);
 *     return data;
 *   }
 * );
 * ```
 */
export async function withSpan<T>(opts: SpanOptions, fn: (span: Span) => Promise<T>): Promise<T> {
    const tracer = getTracer()
    if (!tracer) return fn(NOOP_SPAN)

    return tracer.startActiveSpan(opts.name, async (span) => {
        try {
            span.setAttribute("ag.type.tree", "invocation")
            if (opts.type) span.setAttribute("ag.type.node", opts.type)
            if (opts.inputs) {
                span.setAttribute("ag.data.inputs", JSON.stringify(opts.inputs))
            }
            if (opts.metadata) {
                for (const [key, value] of Object.entries(opts.metadata)) {
                    span.setAttribute(`ag.meta.${key}`, value)
                }
            }

            const result = await fn(span)

            if (result !== undefined && result !== null) {
                try {
                    span.setAttribute(
                        "ag.data.outputs",
                        typeof result === "string" ? result : JSON.stringify(result),
                    )
                } catch {
                    // Non-serializable — skip
                }
            }

            span.setStatus({code: SpanStatusCode.OK})
            return result
        } catch (error) {
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error instanceof Error ? error.message : String(error),
            })
            throw error
        } finally {
            span.end()
        }
    })
}

/**
 * Flush all pending spans.
 * Call before process exit to ensure all spans are exported.
 */
export async function flushTracing(): Promise<void> {
    try {
        const provider = trace.getTracerProvider()
        if ("forceFlush" in provider && typeof provider.forceFlush === "function") {
            await (provider as {forceFlush: () => Promise<void>}).forceFlush()
        }
    } catch {
        // Best effort
    }
}

// ─── Shared Adapter Helpers ─────────────────────────────────────────────────
// Used by both AI SDK and Mastra adapters to avoid code duplication.

/**
 * Get the Agenta tracer, or null if tracing isn't initialized.
 * Wraps the try-catch pattern used by all adapters.
 */
export function getAgentaTracer(): Tracer | null {
    try {
        return trace.getTracer(TRACER_NAME, TRACER_VERSION)
    } catch {
        return null
    }
}

/**
 * Set standard Agenta span attributes for a traced response.
 * Used by all framework adapters (AI SDK, Mastra, etc.)
 */
export function setAgentaSpanAttributes(
    span: Span,
    attrs: {
        sessionId?: string
        userId?: string
        applicationId?: string
        applicationRevisionId?: string
        applicationSlug?: string
    },
): void {
    if (attrs.sessionId) span.setAttribute("ag.session.id", attrs.sessionId)
    if (attrs.userId) span.setAttribute("ag.meta.userId", attrs.userId)
    if (attrs.applicationId) span.setAttribute("ag.refs.application.id", attrs.applicationId)
    if (attrs.applicationRevisionId)
        span.setAttribute("ag.refs.application_revision.id", attrs.applicationRevisionId)
    if (attrs.applicationSlug) span.setAttribute("ag.meta.applicationSlug", attrs.applicationSlug)
    span.setAttribute("ag.type.node", "agent")
}

/**
 * Create a parent span and context for traced responses.
 * Returns the span, trace ID, and wrapped context.
 */
export function createTracedContext(options: {
    sessionId?: string
    userId?: string
    applicationId?: string
    applicationRevisionId?: string
    applicationSlug?: string
}): {span: Span; traceId: string; context: ReturnType<typeof otelContext.active>} | null {
    const tracer = getAgentaTracer()
    if (!tracer) return null

    const spanName = `chat:${options.sessionId ?? "anonymous"}`
    // Start from ROOT_CONTEXT so the chat span is a true root —
    // prevents inheriting stray parent spans from Next.js/framework context.
    const span = tracer.startSpan(spanName, {}, ROOT_CONTEXT)
    setAgentaSpanAttributes(span, options)

    const traceId = span.spanContext().traceId
    const context = trace.setSpan(ROOT_CONTEXT, span)

    return {span, traceId, context}
}
