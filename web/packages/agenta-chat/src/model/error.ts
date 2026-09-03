export interface ParsedRunError {
    message: string
    code?: number
    /**
     * The request never reached Agenta — offline, DNS, refused, dropped mid-flight, or the tab out
     * of connections. There is no server verdict behind this one, so it is worth retrying as-is,
     * and it must not be reported as anything the agent or its config did.
     */
    transport?: boolean
}

/**
 * How each engine words "the fetch never completed". Matched as the WHOLE message, because a
 * server sentence that merely contains one of these ("Upstream fetch failed") is a verdict the
 * server reached, not a request that never arrived.
 */
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

/** Is this raw message an engine's transport failure rather than a reason from the server? */
export const isTransportFailure = (raw: string): boolean => {
    const text = raw.trim().toLowerCase()
    if (!text) return false
    if (TRANSPORT_CODES.some((code) => text.includes(code))) return true
    // Drop the wrapper the engine added and the sentence-final period, then require what's left
    // to BE the phrase — a message with words of its own around it came from someone else.
    const bare = text.replace(ERROR_CLASS_PREFIX, "").replace(/[.\s]+$/, "")
    return TRANSPORT_MESSAGES.includes(bare)
}

/**
 * Best-effort human reason from a useChat stream error. The server may hand us a clean string
 * ("Agent run failed: …") or a JSON envelope (`{status:{code,message,…}}` / `{message}`) — pull
 * the message out of either and drop the stacktrace / docs-url noise so it reads cleanly inline.
 *
 * A message the server never sent is translated rather than shown. A dropped request surfaces as
 * the engine's own `TypeError` text, and "Failed to fetch" rendered under "The agent run failed"
 * told the user nothing they could act on and read as a fault in the agent.
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
