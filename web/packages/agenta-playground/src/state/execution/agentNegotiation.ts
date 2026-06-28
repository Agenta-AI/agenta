import type {AgentChannelMode} from "./channelMode"

/**
 * Client-side transport negotiation for the agent `/invoke` lane.
 *
 * The backend negotiates the response channel off the request `Accept` header
 * (sdk/agents/adapters/vercel routing): `text/event-stream` asks for the v6 SSE
 * UI-message stream, `application/json` for a single `WorkflowBatchResponse`. A
 * handler that cannot stream answers a stream request with **406 Not Acceptable**
 * (not an SSE body); a handler that errors answers with JSON carrying the real
 * status code.
 *
 * JP's first cut sent a fixed `Accept` from the kebab toggle and trusted it. This
 * adds the real negotiation the toggle's `stream` default implies:
 *
 *  1. **stream** — request the SSE stream.
 *  2. **fall back to batch** — if the server can't stream (406), re-issue the same
 *     request as `application/json` and replay the batch as a one-shot stream.
 *  3. **error gracefully** — any other non-OK response (or a failed batch fallback)
 *     is returned untouched so the AI-SDK transport throws its body text, which
 *     `useChat`'s `onError` surfaces inline (`parseAgentRunError`).
 *
 * An explicit `batch` toggle skips the stream attempt entirely.
 */
export interface NegotiatingFetch {
    /** A `fetch` middleware to hand the AI-SDK transport. */
    fetch: typeof globalThis.fetch
    /**
     * The channel a response actually resolved to — drives how the transport parses the body
     * (SSE stream vs. one-shot batch replay).
     *
     * Pass the response body the transport is about to parse (`response.body`); the mode is bound
     * to that exact stream, so request and parse can never disagree even if requests overlap. With
     * no argument it returns the LAST negotiated mode (kept for callers that don't have the stream).
     */
    resolvedMode: (stream?: ReadableStream<Uint8Array> | null) => AgentChannelMode
}

type Headersish = HeadersInit | undefined

/** Read a header value tolerant of the three `HeadersInit` shapes the caller may pass. */
const headerValue = (headers: Headersish, name: string): string => {
    const lower = name.toLowerCase()
    if (!headers) return ""
    if (headers instanceof Headers) return headers.get(name) ?? ""
    if (Array.isArray(headers)) {
        const hit = headers.find(([k]) => k.toLowerCase() === lower)
        return hit?.[1] ?? ""
    }
    for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === lower) return String(v)
    }
    return ""
}

/** Clone `headers` with `Accept` replaced — preserves every other header (auth, UA, format). */
const withAccept = (headers: Headersish, accept: string): Record<string, string> => {
    const out: Record<string, string> = {}
    if (headers instanceof Headers) {
        headers.forEach((v, k) => {
            out[k] = v
        })
    } else if (Array.isArray(headers)) {
        for (const [k, v] of headers) out[k] = v
    } else if (headers) {
        for (const [k, v] of Object.entries(headers)) out[k] = String(v)
    }
    // Drop any existing Accept (case-insensitive) before setting the new one.
    for (const k of Object.keys(out)) {
        if (k.toLowerCase() === "accept") delete out[k]
    }
    out.Accept = accept
    return out
}

/** HTTP status the SDK route returns when a stream was asked of a handler that can only batch. */
const NOT_ACCEPTABLE = 406

export function createNegotiatingFetch(baseFetch?: typeof globalThis.fetch): NegotiatingFetch {
    const base = baseFetch ?? globalThis.fetch.bind(globalThis)

    // Bind the resolved mode to the response body STREAM, not a shared variable: the transport
    // reads it back when it parses that body, so keying on the stream keeps request and parse in
    // lockstep even if two requests on this transport ever overlap. `last` is the no-arg fallback.
    const modes = new WeakMap<ReadableStream<Uint8Array>, AgentChannelMode>()
    let last: AgentChannelMode = "stream"

    const remember = (res: Response, mode: AgentChannelMode): Response => {
        last = mode
        if (res.body) modes.set(res.body, mode)
        return res
    }

    const fetch: typeof globalThis.fetch = async (input, init) => {
        const wantsStream = headerValue(init?.headers, "accept").includes("text/event-stream")

        // Explicit batch request (toggle = batch) — no stream attempt.
        if (!wantsStream) {
            return remember(await base(input, init), "batch")
        }

        const res = await base(input, init)

        if (res.ok) {
            // The server may honour the stream or, having no preference path, answer batch JSON.
            // Trust the response Content-Type over our request intent.
            const isStream = (res.headers.get("content-type") ?? "").includes("text/event-stream")
            return remember(res, isStream ? "stream" : "batch")
        }

        // Negotiation failed because the handler can't stream — fall back to batch.
        if (res.status === NOT_ACCEPTABLE) {
            const batch = await base(input, {
                ...init,
                headers: withAccept(init?.headers, "application/json"),
            })
            return remember(batch, "batch")
        }

        // A real error (4xx/5xx with the run's JSON envelope). Hand it back untouched so the
        // AI-SDK transport throws its body text and `useChat` renders it inline.
        return remember(res, "stream")
    }

    const resolvedMode = (stream?: ReadableStream<Uint8Array> | null): AgentChannelMode => {
        if (stream) {
            const mode = modes.get(stream)
            if (mode) return mode
        }
        return last
    }

    return {fetch, resolvedMode}
}
