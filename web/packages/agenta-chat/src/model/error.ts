import type {UIMessage} from "ai"

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
    if (fallback.trim() === SESSION_TURN_IN_USE_MESSAGE) {
        // Carry the class so the bubble can say "not sent" rather than "the agent run failed".
        return {message: fallback, code: SESSION_TURN_IN_USE_CODE}
    }
    // A server envelope outranks transport-phrase translation.
    if (isTransportFailure(fallback)) return {message: TRANSPORT_ERROR_MESSAGE, transport: true}
    return {message: fallback}
}

/** A stream error/abort is already surfaced via `useChat`'s `onError` + the in-chat `error`
 * alert; swallow the floating `sendMessage`/`regenerate` rejection so it doesn't bubble to the
 * Next.js dev Runtime Error overlay (F-033). */
export const ignoreStreamRejection = () => {}

/** Metadata the error effect writes onto the row it stamps. `turnAccepted` records that the
 * server took the turn before the stream died — see `isDeadAcceptedSenderCarrier`. */
export interface RunErrorMetadata {
    runError?: ParsedRunError
    turnAccepted?: boolean
}

/**
 * The row a sender stream left behind after the server had already accepted the turn.
 *
 * Three things have to be true together, and each one carries weight.
 *
 * - `turnAccepted`: the runner answered this send with its acceptance frame, so it owns the turn
 *   and will write it to the durable log with or without us. Without this flag the send may never
 *   have started, and the card is the only thing telling the user so.
 * - `transport`: WE lost the request. No server verdict came back, so there is no judgment here to
 *   preserve.
 * - No answer of its own: every part is structure or control. On the shared path there is never
 *   more, because the answer arrives through the session frames. A row that DOES hold content is a
 *   turn, so it stays whole, stamp included.
 *
 * The acceptance cannot be read off the message. The runner marks that frame `transient`
 * (`services/runner/src/server.ts`), so the AI SDK hands it to `onData` and never puts it in
 * `parts`. The hook records it for the turn in flight instead.
 */
/** Parts that say a turn was opened, not what it answered. The AI SDK adds `step-start` for the
 * `start-step` chunk, and a non-transient acceptance would land as its own data part. */
const CONTROL_PART_TYPES = new Set(["step-start", "data-session-accepted"])

const isDeadAcceptedSenderCarrier = (message: UIMessage): boolean => {
    const metadata = message.metadata as RunErrorMetadata | undefined
    return (
        metadata?.turnAccepted === true &&
        metadata.runError?.transport === true &&
        message.parts.every((part) => CONTROL_PART_TYPES.has(part.type))
    )
}

/**
 * Drop the row a dead sender stream leaves behind once the server owns the turn.
 *
 * That row is control, not transcript: the turn runs on and lands in the durable log, so the row
 * must not be persisted and must not be counted when the adoption guard compares what we render
 * with what the log holds. Both would keep a failure card over a turn the server completed.
 *
 * The rendered transcript is NOT filtered this way. A user whose send fails still sees the card,
 * live, in the tab that failed.
 *
 * Returns the same array when there is nothing to drop, which saves an allocation on every settle.
 */
export const withoutDeadSenderAcceptance = (messages: UIMessage[]): UIMessage[] =>
    messages.some(isDeadAcceptedSenderCarrier)
        ? messages.filter((message) => !isDeadAcceptedSenderCarrier(message))
        : messages
