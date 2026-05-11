/**
 * Shared utilities for framework mappers.
 *
 * Mappers receive a ReadableSpan and return a Record of new/overridden
 * attributes. They do NOT mutate the original span — TransformedSpan
 * handles the merge.
 */

import type {ReadableSpan} from "@opentelemetry/sdk-trace-base"

// ─── Attribute Extraction ───────────────────────────────────────────────────

/**
 * Read span attributes as a plain record.
 * ReadableSpan.attributes is typed as `Attributes` (AttributeValue | undefined).
 * We read values as unknown for safe downstream handling.
 */
export function readAttrs(span: ReadableSpan): Readonly<Record<string, unknown>> {
    return span.attributes as Record<string, unknown>
}

/**
 * Read the parent span ID from a ReadableSpan.
 * OTel's ReadableSpan doesn't expose this, but the SDK Span stores it.
 */
export function readParentSpanId(span: ReadableSpan): string | undefined {
    return (span as {parentSpanId?: string}).parentSpanId
}

// ─── General Helpers ────────────────────────────────────────────────────────

/**
 * Convert a value to a JSON string.
 * If already a string, returns as-is.
 */
export function toJson(v: unknown): string {
    return typeof v === "string" ? v : JSON.stringify(v)
}

/**
 * Infer the LLM provider system name from a model string.
 */
export function inferProvider(model: string): string | undefined {
    if (model.includes("claude")) return "anthropic"
    if (model.includes("gpt") || model.includes("o1") || model.includes("o3")) return "openai"
    if (model.includes("gemini")) return "google"
    if (model.includes("mistral")) return "mistral"
    return undefined
}
