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
        {type: "data-trace"; data?: TracePartData} | undefined
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

/** Token/cost fields in `ExecutionMetricsDisplay`'s shape. */
export interface MessageUsageMetrics {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
    totalCost?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
}

/**
 * Usage (tokens + cost) the service stamps onto `message.metadata.usage` via the
 * `finish` part's messageMetadata (`{input, output, total, cost, cacheRead, cacheWrite}`),
 * mapped to the metrics-display field names. The trace supplies latency; this supplies
 * tokens/cost (the agent-run trace summary doesn't surface them on the Pi/local path).
 *
 * The wire `input` excludes cached tokens, so the displayed prompt count folds the
 * cached portion back in (Prompt + Completion = Total), with the split kept separately.
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
    const cacheRead = num(usage.cacheRead)
    const cacheWrite = num(usage.cacheWrite)
    if (input !== undefined) out.promptTokens = input + (cacheRead ?? 0) + (cacheWrite ?? 0)
    if (output !== undefined) out.completionTokens = output
    if (total !== undefined) out.totalTokens = total
    if (cost !== undefined) out.totalCost = cost
    if (cacheRead !== undefined) out.cacheReadTokens = cacheRead
    if (cacheWrite !== undefined) out.cacheWriteTokens = cacheWrite
    return Object.keys(out).length > 0 ? out : undefined
}
