import type {UIMessage} from "ai"

import {isToolPart} from "./parts"

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

// Copied verbatim from web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the re-plumb
// PR deletes it. Keep byte-parity if either side changes. Adapted only to take `message` +
// `traceError`/`runError` as parameters instead of reading component props/hooks directly.
/**
 * The seven status derivations AgentMessage computes per turn (answer/reasoning/content
 * presence, "no response", and the error-surfacing rules), as a pure function.
 */
export const deriveTurnStatus = (
    message: UIMessage,
    {isUser, isStreaming, traceError, runError, errorCode}: TurnStatusContext,
): TurnStatus => {
    // "Answer" = anything the user is meant to read as a reply (text / tool / file / source).
    // Reasoning alone is NOT an answer — a turn that only thought hasn't responded.
    const hasAnswer = message.parts.some(
        (p) =>
            (p.type === "text" && (p as {text?: string}).text) ||
            isToolPart(p.type) ||
            p.type === "file" ||
            p.type === "source-url",
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
    // even with partial output, so it always counts.
    const errorText = (noResponse ? traceError || runError : runError) ?? null
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
