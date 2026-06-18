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

/** Extract the trace id from a message's `data-trace` part, if present. */
export const getMessageTraceId = (message: UIMessage): string | undefined => {
    const tracePart = message.parts.find((p) => p.type === "data-trace") as
        | {type: "data-trace"; data?: TracePartData}
        | undefined
    if (!tracePart?.data) return undefined
    return tracePart.data.traceId || parseTraceIdFromUrl(tracePart.data.url)
}
