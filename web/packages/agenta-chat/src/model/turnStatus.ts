import type {UIMessage} from "ai"

import {isReadableMcpServerNoticePart} from "./mcpServerNotice"
import {isToolPart} from "./parts"

// The runner's own sentences for the same failures (services/runner errors.ts), so a failure
// reads the same whichever way it reached the turn.
const REQUEST_TOO_LARGE_MESSAGE =
    "The request is too large for this model. Start a new session, turn off tools you do not need, or pick a model with a larger context."
/**
 * A provider's raw HTTP error: `400 {json}`, `Label: 400 {json}`, or `OpenAI API error (400): {json}`,
 * after any number of `Label: ` prefixes (`Internal error: OpenAI API error (404): {json}`).
 * The runner has the same rule. Prefix and label runs are bounded (not `*`) so this stays
 * linear-time on adversarial input (CodeQL js/polynomial-redos): unbounded nested
 * quantifiers over the same `[A-Za-z ]` class let a run of letters/spaces with no colon
 * force exponential backtracking.
 */
const RAW_PROVIDER_BODY =
    /^(?:[A-Za-z][A-Za-z ]{0,40}:\s*){0,6}(?:[A-Za-z ]{1,40}\()?([45]\d\d)\b[^\n]*?\{/
/**
 * The runner's generic class: any other code means the runner recognized the failure, and its
 * sentence (a rate limit, a quota, a provider refusal, withheld text) says more than a trace can.
 */
const GENERIC_ERROR_CODE = "runner_error"

/**
 * What an error may show: the sentence with credentials redacted, and nothing else: `Bearer` and
 * `Basic` values and any other `Authorization` scheme's, the value of a field named like a key,
 * token, secret, password or credential (singular or plural, except `tokens`),
 * JWTs and provider-key shapes. Numbers, ids and paths stay. A port of the runner's
 * `sanitizeErrorText` (services/runner errors.ts): keep the rules identical, so a failure reads
 * the same whichever way it reached the turn.
 */
export const sanitizeErrorText = (text: string): string =>
    text
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 [secret]")
        .replace(/\b(Token|Bot)\s+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{12,}/g, "$1 [secret]")
        // Any other scheme in an Authorization header, quoted or not (`Authorization: Token abc...`,
        // `{"Authorization": "Token abc..."}`).
        .replace(
            /\b(Authorization['"]?\s*[=:]\s*['"]?)(?!(?:Bearer|Basic)\b)([A-Za-z]+)\s+(?!\[secret\])[A-Za-z0-9._~+/=-]{6,}/gi,
            "$1$2 [secret]",
        )
        // A credential's value, quoted (`password='a b'`, `"token": "x"`) or not (`key=x`), digits
        // included. The name ends in the credential word, so `max_tokens` is not one.
        .replace(
            /(['"]?)\b([A-Za-z0-9_-]*(?:keys?|token|secrets?|passwords?|passwd|credentials?))\1\s*[=:]\s*(['"`])(?:(?!\3)[^\\]|\\.)*\3/gi,
            "$2=[secret]",
        )
        .replace(
            /(['"]?)\b([A-Za-z0-9_-]*(?:keys?|token|secrets?|passwords?|passwd|credentials?))\1\s*[=:]\s*(?!\[secret\])['"`]?[^\s'"`,;)]+/gi,
            "$2=[secret]",
        )
        .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9._-]+/g, "[secret]")
        .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, "[secret]")
        .trim()

/** A run error as the screen may show it; `null` when nothing readable is left. */
const readableRunError = (raw?: string | null): string | null =>
    raw ? sanitizeErrorText(raw) || null : null

/** The `message` of a provider's JSON error body (`{"error":{"message":...}}` or `{"message":...}`). */
const providerBodyReason = (body: string): string | undefined => {
    try {
        const parsed = JSON.parse(body) as {error?: unknown; message?: unknown}
        const error = parsed?.error
        const message =
            error && typeof error === "object"
                ? (error as {message?: unknown}).message
                : (error ?? parsed?.message)
        if (typeof message === "string") return message
    } catch {
        // Not one JSON value: read the first "message" string.
    }
    const quoted = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(body)?.[1]
    if (quoted === undefined) return undefined
    try {
        return JSON.parse(`"${quoted}"`) as string
    } catch {
        return quoted
    }
}

/**
 * A trace records the provider's failure as it came back, which can be a raw `NNN {json}` body.
 * That body reads as one sentence with its own reason, the way the runner writes it; any other
 * text is shown sanitized.
 */
export const readableTraceError = (raw?: string | null): string | null => {
    if (!raw) return null
    const match = RAW_PROVIDER_BODY.exec(raw)
    if (!match) return sanitizeErrorText(raw) || null
    const status = match[1]
    if (status === "413") return REQUEST_TOO_LARGE_MESSAGE
    const reason = providerBodyReason(raw.slice(raw.indexOf("{", match.index)))
    const said = reason
        ? sanitizeErrorText(reason)
              .slice(0, 300)
              .replace(/[.!?]?$/, ".")
        : ""
    if (status === "429" || status.startsWith("5"))
        return `The model provider could not answer (HTTP ${status})${said ? `: ${said}` : "."} Try again in a moment.`
    return `The model provider refused the request (HTTP ${status})${said ? `: ${said}` : "."}`
}

export interface TurnStatusContext {
    isUser: boolean
    isStreaming: boolean
    traceError?: string | null
    runError?: string | null
    /** Stable failure class from the runner (`data-agent-error`'s `code`), never a display string. */
    errorCode?: string | null
}

export interface TurnStatus {
    hasAnswer: boolean
    hasReasoning: boolean
    hasContent: boolean
    noResponse: boolean
    errorText: string | null
    /** The failure class, only while an error is actually shown. */
    errorCode: string | null
    showError: boolean
    isError: boolean
}

/**
 * The seven status derivations of a turn (answer/reasoning/content presence, "no response", and
 * the error-surfacing rules), as a pure function. The one implementation: the desktop chat's
 * `AgentMessage.tsx` calls it too.
 */
export const deriveTurnStatus = (
    message: UIMessage,
    {isUser, isStreaming, traceError, runError, errorCode}: TurnStatusContext,
): TurnStatus => {
    // "Answer" = anything the user is meant to read as a reply (text / tool / file / source, and
    // the notice for a server that did not join). Reasoning alone is NOT an answer — a turn that
    // only thought hasn't responded.
    const hasAnswer = message.parts.some(
        (p) =>
            (p.type === "text" && (p as {text?: string}).text) ||
            isToolPart(p.type) ||
            p.type === "file" ||
            p.type === "source-url" ||
            isReadableMcpServerNoticePart(p),
    )
    const hasReasoning = message.parts.some(
        (p) => p.type === "reasoning" && (p as {text?: string}).text,
    )
    const hasContent = hasAnswer || hasReasoning

    // A settled assistant turn (NOT the one being generated) with no answer — only a thought,
    // or nothing — means the model ended without responding. Surface it so the bubble doesn't
    // read as frozen/broken. Keyed on `isStreaming`, not the conversation-level `busy`, so
    // earlier answer-less turns don't all light up while a later turn streams.
    const noResponse = !isUser && !isStreaming && !hasAnswer

    // A trace-leaf error means a model/tool call failed. When the turn still produced an answer,
    // the agent recovered from it — that failure belongs inline in ToolActivity ("· N failed"),
    // NOT as a run failure. So trust `traceError` only on an answer-less turn (the swallowed
    // quota/model error it was written for). A stream death (`runError`) is a real run failure
    // even with partial output, so it always counts. On an answer-less turn the trace's error
    // leads: it names the failing call, where `runError` can be the run's generic ending. Both
    // are sanitized. When the runner classified the failure (any code but its generic
    // `runner_error`), its sentence leads: it says why (a 429, a quota, a provider refusal), and
    // when the runner withheld the text (`internal_error`) a trace's text must never take its place.
    const shownRunError = readableRunError(runError)
    const shownTraceError = readableTraceError(traceError)
    const runErrorLeads = !!errorCode && errorCode !== GENERIC_ERROR_CODE && !!shownRunError
    const errorText = noResponse
        ? runErrorLeads
            ? shownRunError || shownTraceError
            : shownTraceError || shownRunError
        : shownRunError
    // Surface a settled-turn error even when the model emitted partial output before the stream
    // died. (`isError` stays answer-less-only so the *whole* bubble only turns red when there's
    // nothing else to show.)
    const showError = !isStreaming && !!errorText
    // A settled no-answer turn whose trace recorded an error → render the bubble itself as a
    // failure (red), with the message inline — not a nested alert box.
    const isError = noResponse && showError
    // A failure class with no surfaced failure is meaningless — a consumer keys UI off it.
    const shownErrorCode = showError ? (errorCode ?? null) : null

    return {
        hasAnswer,
        hasReasoning,
        hasContent,
        noResponse,
        errorText,
        errorCode: shownErrorCode,
        showError,
        isError,
    }
}
