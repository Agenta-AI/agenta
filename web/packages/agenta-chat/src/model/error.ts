import {gatewayRefusalCode, gatewayRefusalMessage} from "@agenta/entities/mcpEndpoint/refusal"

import type {AttachmentRejection} from "../assets/attachmentRules"

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

/**
 * The sentence a refused invoke states about itself, or `null` when it states none.
 *
 * One refusal reaches the browser in two envelopes. The SDK's normalizer answers
 * `{status: {code, message, failure_code, stacktrace}}`; the API and gateway layers in front of
 * it answer FastAPI's `{detail: …}` or the relay's `{error: {…}}`. Both are read through
 * `gatewayRefusalMessage` — the reader the MCP connect dialog and the permission editor already
 * use — by handing it whichever of the two this body carries. That reader strips the runner's
 * `⟦agenta_code:…⟧` marker and appends `next_step` when the refusal named one, so the reader of
 * the chat learns what happened AND what to do about it.
 *
 * Reading the body is the whole point: the SDK envelope ships a multi-kilobyte stacktrace beside
 * the message, so the body text is never something to show whole.
 */
const statedRefusal = (data: unknown): ParsedRunError | null => {
    if (!data || typeof data !== "object") return null
    const record = data as Record<string, unknown>
    const status = record.status
    const envelopes = status && typeof status === "object" ? [{detail: status}, record] : [record]
    for (const candidate of envelopes) {
        const shaped = {response: {data: candidate}}
        const message = gatewayRefusalMessage(shaped)
        if (!message) continue
        // The failure CLASS outranks the HTTP status, same rule the stream path applies: `422`
        // alone says only "refused", while the slug says which refusal it was.
        const failureCode =
            status && typeof status === "object"
                ? (status as {failure_code?: unknown}).failure_code
                : undefined
        const code =
            typeof failureCode === "string" && failureCode
                ? failureCode
                : (gatewayRefusalCode(shaped) ?? undefined)
        return code ? {message, code} : {message}
    }
    return null
}

/**
 * The reason half of the composer's refusal chip when the server stated nothing usable. The
 * failed-echo row says the same thing with its subject attached (`PENDING_SEND_FAILED_NOTE`);
 * the two are one event, and two phrasings would read as carelessness.
 */
export const REFUSED_SEND_REASON = "wasn't sent — try again."

/** A send the server refused outright, carrying whatever reason the refusal stated. */
export class SendRefusedError extends Error {
    /** The refusal's own sentence, or `null` when the body carried none. */
    readonly statedReason: string | null
    /** The refusal's failure class, when it named one. */
    readonly refusalCode: string | null
    readonly status: number

    constructor({
        status,
        statedReason,
        refusalCode,
    }: {
        status: number
        statedReason: string | null
        refusalCode: string | null
    }) {
        super(statedReason ?? `The input was not accepted (${status}).`)
        this.name = "SendRefusedError"
        this.status = status
        this.statedReason = statedReason
        this.refusalCode = refusalCode
    }
}

/** Build the refusal for a non-OK invoke response from its status and its (already read) body. */
export const readSendRefusal = (status: number, body: string): SendRefusedError => {
    let parsed: ParsedRunError | null = null
    try {
        parsed = statedRefusal(JSON.parse(body))
    } catch {
        // Not JSON — an HTML error page or an empty body states nothing to pass on.
    }
    return new SendRefusedError({
        status,
        statedReason: parsed?.message ?? null,
        refusalCode: typeof parsed?.code === "string" ? parsed.code : null,
    })
}

/** The refusal's own sentence, for a host that already has a frame to put it in. */
export const refusedSendReason = (error: unknown): string | null =>
    error instanceof SendRefusedError ? error.statedReason : null

/** The chip's reason for a stated sentence, or the standing wording when there is none. */
const describeStatedRefusal = (stated: string | null | undefined): string =>
    stated ? `wasn't sent — ${stated}` : REFUSED_SEND_REASON

/**
 * What the composer says about a send that never left: the server's own reason when the refusal
 * stated one, and the standing "try again" wording when it did not.
 */
export const describeRefusedSend = (error: unknown): string =>
    describeStatedRefusal(refusedSendReason(error))

/** The subject of the refusal chip's row. The message, not a file, is what was rejected. */
const REFUSED_SEND_SUBJECT = "Message"

/**
 * The composer's rejection rows for a send that never left, ready for `setRejections`.
 *
 * One place because there were three: the classic conversation's two catches and the mobile
 * composer's, each building the row by hand, and only the mobile one had a case over it. That
 * asymmetry is round-4 D98 — replacing the reason with a hardcoded string on classic left every
 * suite green. There is no per-app wording left to diverge now.
 */
export const refusedSendRejections = (error: unknown): AttachmentRejection[] => [
    {name: REFUSED_SEND_SUBJECT, reason: describeRefusedSend(error)},
]

/**
 * The same rows for a refusal that arrived after the send resolved. The run stream reports only
 * the sentence its error frame carried, so this takes that instead of an error object.
 */
export const lateRefusedSendRejections = (reason?: string): AttachmentRejection[] => [
    {name: REFUSED_SEND_SUBJECT, reason: describeStatedRefusal(reason)},
]

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
        if (!message) {
            // Neither `status.message` nor a top-level one: this refusal was written by a layer
            // in FRONT of the SDK route, which answers in FastAPI's `detail` or the relay's
            // `error` instead. Read through the same reader the MCP dialogs use, so one refusal
            // cannot be a sentence in a dialog and a bare status number in the chat.
            const stated = statedRefusal(obj)
            if (stated) return stated
        }
        if (message) {
            const type = typeof status?.type === "string" ? status.type : undefined
            // A failure CLASS outranks the HTTP status. The server sends both, and `422` alone
            // says only "your request was refused" — the slug says which refusal it was, and it
            // is the same word the runner puts on its in-stream error frame. Without this, a
            // subscription that needs a new sign-in is indistinguishable from any other 422.
            const failureCode =
                typeof status?.failure_code === "string" && status.failure_code
                    ? status.failure_code
                    : undefined
            const code = type?.endsWith("#continuation-resumed")
                ? "continuation_resumed"
                : (failureCode ??
                  (typeof status?.code === "number" || typeof status?.code === "string"
                      ? status.code
                      : undefined))
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
