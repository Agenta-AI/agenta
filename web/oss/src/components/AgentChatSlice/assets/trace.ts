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
