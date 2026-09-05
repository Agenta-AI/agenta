export interface ParsedRunError {
    message: string
    /** An HTTP-ish status from a JSON error envelope, or a stable runner failure class string. */
    code?: number | string
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

export const ACCEPTED_SENDER_DISCONNECT_MESSAGE =
    "Connection interrupted. The turn was accepted and is still running."

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

// Keep this refusal contract byte-identical to the runner message.
export const SESSION_TURN_IN_USE_CODE = "session_turn_in_use"

export const SESSION_TURN_IN_USE_MESSAGE =
    "This session is already running a turn. Your message was not sent. Wait for the reply, or stop the turn, then send again."

/** True when a `useChat` error is the single-turn admission refusal. */
export const isSessionBusyRefusal = (err: unknown): boolean =>
    parseAgentRunError(err).message.trim() === SESSION_TURN_IN_USE_MESSAGE

// Keep byte parity with the desktop parser until its duplicate is removed.
/**
 * Best-effort human reason from a useChat stream error: a plain string or a `{status:{…}}`
 * envelope. An engine's own wording is translated — "Failed to fetch" under "The agent run
 * failed" read as a fault in the agent.
 */
export const parseAgentRunError = (err: unknown, serverErrorProvenance = false): ParsedRunError => {
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
            const type = typeof status?.type === "string" ? status.type : undefined
            const code = type?.endsWith("#continuation-resumed")
                ? "continuation_resumed"
                : typeof status?.code === "number" || typeof status?.code === "string"
                  ? status.code
                  : undefined
            return {
                message,
                code,
            }
        }
    } catch {
        // raw isn't JSON — it's already the human message.
    }
    if (fallback.trim() === SESSION_TURN_IN_USE_MESSAGE) {
        // Carry the class so the bubble can say "not sent" rather than "the agent run failed".
        return {message: fallback, code: SESSION_TURN_IN_USE_CODE}
    }
    // A server envelope outranks transport-phrase translation.
    if (!serverErrorProvenance && isTransportFailure(fallback))
        return {message: TRANSPORT_ERROR_MESSAGE, transport: true}
    return {message: fallback}
}

/** A stream error/abort is already surfaced via `useChat`'s `onError` + the in-chat `error`
 * alert; swallow the floating `sendMessage`/`regenerate` rejection so it doesn't bubble to the
 * Next.js dev Runtime Error overlay (F-033). */
export const ignoreStreamRejection = () => {}

export interface RunErrorMetadata {
    runError?: ParsedRunError
}

export interface AgentRunErrorBoundary {
    runError?: ParsedRunError
    connectionWarning?: string
}

/** Keep an accepted sender disconnect out of conversation content; the shared run continues. */
export const classifyAgentRunError = (
    error: unknown,
    turnAccepted: boolean,
    serverErrorProvenance = false,
): AgentRunErrorBoundary => {
    const parsed = parseAgentRunError(error, serverErrorProvenance)
    return turnAccepted && parsed.transport
        ? {connectionWarning: ACCEPTED_SENDER_DISCONNECT_MESSAGE}
        : {runError: parsed}
}
