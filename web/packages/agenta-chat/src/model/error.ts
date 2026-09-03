export interface ParsedRunError {
    message: string
    code?: number
    /** The request never reached Agenta: no server verdict behind it, and retryable as-is. */
    transport?: boolean
}

/** How each engine words "the fetch never completed", matched as the WHOLE message — a server
 * sentence merely containing one ("Upstream fetch failed") is a verdict, not a lost request. */
const TRANSPORT_MESSAGES = [
    "failed to fetch", // Chrome, Edge
    "networkerror when attempting to fetch resource", // Firefox
    "load failed", // Safari
    "the network connection was lost", // Safari, mid-flight drop
    "network request failed", // React Native / polyfills
    "fetch failed", // undici, when this runs server-side
]

/** Chromium's network codes, matched anywhere: nothing but a network stack says these words. */
const TRANSPORT_CODES = ["err_network", "err_internet_disconnected", "err_connection_refused"]

/** The class an engine prefixes its own message with ("TypeError: Failed to fetch"). */
const ERROR_CLASS_PREFIX = /^[a-z]*error:\s*/

/** One sentence with something to do in it, in place of a browser's internal wording. */
export const TRANSPORT_ERROR_MESSAGE = "Could not reach Agenta. Check your connection and retry."

/** Trailing periods and spaces, scanned rather than matched: `/[.\s]+$/` backtracks
 * quadratically on a long unmatched tail (CodeQL js/polynomial-redos). */
const withoutTrailingStop = (text: string): string => {
    let end = text.length
    while (end > 0 && (text[end - 1] === "." || text[end - 1] === " " || text[end - 1] === "\t")) {
        end -= 1
    }
    return text.slice(0, end)
}

/** Is this raw message an engine's transport failure rather than a reason from the server? */
export const isTransportFailure = (raw: string): boolean => {
    const text = raw.trim().toLowerCase()
    if (!text) return false
    if (TRANSPORT_CODES.some((code) => text.includes(code))) return true
    // Strip the engine's wrapper, then require what is left to BE the phrase.
    const bare = withoutTrailingStop(text.replace(ERROR_CLASS_PREFIX, ""))
    return TRANSPORT_MESSAGES.includes(bare)
}

/**
 * Best-effort human reason from a useChat stream error: a plain string or a `{status:{…}}`
 * envelope. An engine's own wording is translated — "Failed to fetch" under "The agent run
 * failed" read as a fault in the agent.
 */
export const parseAgentRunError = (err: unknown): ParsedRunError => {
    const raw =
        err instanceof Error ? err.message : typeof err === "string" ? err : String(err ?? "")
    const fallback = raw.trim() || "The agent run failed."
    try {
        const obj = JSON.parse(raw) as Record<string, unknown>
        const status = (obj?.status && typeof obj.status === "object" ? obj.status : obj) as Record<
            string,
            unknown
        >
        const message =
            typeof status?.message === "string"
                ? status.message
                : typeof obj?.message === "string"
                  ? (obj.message as string)
                  : null
        if (message) {
            return {message, code: typeof status?.code === "number" ? status.code : undefined}
        }
    } catch {
        // raw isn't JSON — it's already the human message.
    }
    // After the envelope: a server that reports those words means them, and its code is worth more
    // than this translation. A bare engine string has no envelope to lose.
    if (isTransportFailure(fallback)) return {message: TRANSPORT_ERROR_MESSAGE, transport: true}
    return {message: fallback}
}

/** A stream error/abort is already surfaced via `useChat`'s `onError` + the in-chat `error`
 * alert; swallow the floating `sendMessage`/`regenerate` rejection so it doesn't bubble to the
 * Next.js dev Runtime Error overlay (F-033). */
export const ignoreStreamRejection = () => {}
