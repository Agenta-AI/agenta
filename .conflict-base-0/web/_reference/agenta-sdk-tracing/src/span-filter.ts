/**
 * Agenta SDK Tracing — Span filter.
 *
 * Determines which OTel spans are relevant for LLM observability.
 * Drops Next.js routing, HTTP, DNS, and other framework noise.
 */

import type {ReadableSpan} from "@opentelemetry/sdk-trace-base"

/**
 * Span name prefixes that indicate LLM-relevant spans.
 * Anything not matching these is dropped from the export.
 */
const ALLOWED_SPAN_NAMES = [
    "chat:", // Manual conversation root span
    "ai.streamText", // AI SDK streaming
    "ai.generateText", // AI SDK generation
    "ai.toolCall", // AI SDK tool execution
    "ai.embed", // AI SDK embeddings
    "tool:", // Manual tool span
    "llm:", // Manual LLM span
] as const

/**
 * Returns true if the span should be exported to Agenta.
 *
 * A span is kept if:
 * 1. It has a manual `ag.type.node` attribute (always kept), OR
 * 2. Its name starts with one of the allowed prefixes
 */
export function isAgentSpan(span: ReadableSpan): boolean {
    if (span.attributes["ag.type.node"] !== undefined) return true
    return ALLOWED_SPAN_NAMES.some((prefix) => span.name.startsWith(prefix))
}
