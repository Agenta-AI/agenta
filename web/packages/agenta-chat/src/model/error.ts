// Copied verbatim from web/oss/src/components/AgentChatSlice/AgentConversation.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the
// re-plumb PR deletes it. Keep byte-parity if either side changes.
export interface ParsedRunError {
    message: string
    /** An HTTP-ish status from a JSON error envelope, or a stable runner failure class string. */
    code?: number | string
}

/**
 * The runner refuses a message sent while another turn is already running on the same session,
 * so at most one execution runs per session (#6417, #5539, #5538). Nothing ran, nothing was
 * destroyed, and the message was never sent — so this is NOT a run failure, and the client keeps
 * the user's text instead of losing it.
 *
 * The message text is the contract with the runner. It is produced in exactly one place,
 * `services/runner/src/sessions/admission.ts`, and reaches the browser verbatim: the SDK's
 * `sanitize_runner_error` passes a clean one-line message through unchanged, and the Vercel
 * egress puts it on the stream as `errorText`. Keep the two constants byte-identical.
 */
export const SESSION_TURN_IN_USE_CODE = "session_turn_in_use"

export const SESSION_TURN_IN_USE_MESSAGE =
    "This session is already running a turn. Your message was not sent. Wait for the reply, or stop the turn, then send again."

/**
 * True when a `useChat` stream error is the single-turn admission refusal.
 *
 * Matched on the message rather than on the stream's `data-agent-error` code because the `error`
 * object is the only thing available at the moment the client has to decide whether to give the
 * user their text back. The code still travels on the message part and drives how the bubble
 * renders (`getMessageRunErrorCode`).
 */
export const isSessionBusyRefusal = (err: unknown): boolean =>
    parseAgentRunError(err).message.trim() === SESSION_TURN_IN_USE_MESSAGE

// Copied verbatim from web/oss/src/components/AgentChatSlice/AgentConversation.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the
// re-plumb PR deletes it. Keep byte-parity if either side changes.
/**
 * Best-effort human reason from a useChat stream error. The server may hand us a clean string
 * ("Agent run failed: …") or a JSON envelope (`{status:{code,message,…}}` / `{message}`) — pull
 * the message out of either and drop the stacktrace / docs-url noise so it reads cleanly inline.
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
    return {message: fallback}
}

/** A stream error/abort is already surfaced via `useChat`'s `onError` + the in-chat `error`
 * alert; swallow the floating `sendMessage`/`regenerate` rejection so it doesn't bubble to the
 * Next.js dev Runtime Error overlay (F-033). */
export const ignoreStreamRejection = () => {}
