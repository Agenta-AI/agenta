// Canonical since the desktop re-plumb: the OSS copy is deleted and both apps import this.
import type {UIMessage} from "ai"

/**
 * The custom `data-trace` part the service emits: `{type: "data-trace", data: {...}}`.
 * The service sends both a `traceId` (preferred — `openTraceDrawerAtom` wants an id) and a
 * `url` (human link). We parse the id out of the url as a fallback for older emitters that
 * only send `{url}` (the original RAG_QA example did).
 */
interface TracePartData {
    traceId?: string
    url?: string
}

const parseTraceIdFromUrl = (url?: string): string | undefined => {
    if (!url) return undefined
    const segments = url.split("?")[0].split("/").filter(Boolean)
    return segments[segments.length - 1] || undefined
}

/**
 * Extract the trace id for a message. Prefers `message.metadata.traceId` (the RFC-aligned
 * channel — the service sets it via `messageMetadata` on the `start`/`finish` parts), and
 * falls back to the custom `data-trace` part for emitters that only send that.
 */
export const getMessageTraceId = (message: UIMessage): string | undefined => {
    const metaTraceId = (message.metadata as {traceId?: string} | undefined)?.traceId
    if (metaTraceId) return metaTraceId

    const tracePart = message.parts.find((p) => p.type === "data-trace") as
        | {type: "data-trace"; data?: TracePartData}
        | undefined
    if (!tracePart?.data) return undefined
    return tracePart.data.traceId || parseTraceIdFromUrl(tracePart.data.url)
}

/**
 * A run failure stamped onto an assistant turn's metadata (FE-side, when the stream errors —
 * see AgentChatPanel). The backend doesn't always record the error on the trace, but useChat
 * surfaces it; persisting it here lets the failed turn render the real reason inline (a red
 * error bubble) instead of a generic "no response", and survives a reload with the session.
 */
export const getMessageRunError = (message: UIMessage): string | undefined => {
    const runError = (message.metadata as {runError?: {message?: string}} | undefined)?.runError
    const msg = runError?.message
    return typeof msg === "string" && msg.trim() ? msg : undefined
}

/**
 * The failure CLASS behind a run error — the runner's stable `code` (never a display string), so a
 * callout can offer a purposeful action instead of parsing the message. Read from
 * `metadata.runError.code` (replayed transcripts stamp it there) or the live stream's
 * `data-agent-error` part. `ParsedRunError.code` is an HTTP-ish NUMBER on the same field, so only a
 * string counts here.
 */
export const getMessageRunErrorCode = (message: UIMessage): string | undefined => {
    const metaCode = (message.metadata as {runError?: {code?: unknown}} | undefined)?.runError?.code
    if (typeof metaCode === "string" && metaCode.trim()) return metaCode

    const errorPart = message.parts.find((p) => p.type === "data-agent-error") as
        | {type: "data-agent-error"; data?: {code?: unknown}}
        | undefined
    const partCode = errorPart?.data?.code
    return typeof partCode === "string" && partCode.trim() ? partCode : undefined
}

/** A request that never reached Agenta: retryable as-is, and it carries no failure code. */
export const isMessageRunErrorTransport = (message: UIMessage): boolean =>
    (message.metadata as {runError?: {transport?: unknown}} | undefined)?.runError?.transport ===
    true

/** Token/cost fields in `ExecutionMetricsDisplay`'s shape. */
export interface MessageUsageMetrics {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
    totalCost?: number
}

/**
 * Usage (tokens + cost) the service stamps onto `message.metadata.usage` via the
 * `finish` part's messageMetadata (`{input, output, total, cost}`), mapped to the
 * metrics-display field names. The trace supplies latency; this supplies tokens/cost
 * (the agent-run trace summary doesn't surface them on the Pi/local path).
 */
export const getMessageUsage = (message: UIMessage): MessageUsageMetrics | undefined => {
    const usage = (message.metadata as {usage?: Record<string, unknown>} | undefined)?.usage
    if (!usage || typeof usage !== "object") return undefined
    const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined)
    const out: MessageUsageMetrics = {}
    const input = num(usage.input)
    const output = num(usage.output)
    const total = num(usage.total)
    const cost = num(usage.cost)
    if (input !== undefined) out.promptTokens = input
    if (output !== undefined) out.completionTokens = output
    if (total !== undefined) out.totalTokens = total
    if (cost !== undefined) out.totalCost = cost
    return Object.keys(out).length > 0 ? out : undefined
}
