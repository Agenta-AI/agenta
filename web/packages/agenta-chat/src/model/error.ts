// Copied verbatim from web/oss/src/components/AgentChatSlice/AgentConversation.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the
// re-plumb PR deletes it. Keep byte-parity if either side changes.
export interface ParsedRunError {
    message: string
    code?: number
}

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
    return {message: fallback}
}

/** A stream error/abort is already surfaced via `useChat`'s `onError` + the in-chat `error`
 * alert; swallow the floating `sendMessage`/`regenerate` rejection so it doesn't bubble to the
 * Next.js dev Runtime Error overlay (F-033). */
export const ignoreStreamRejection = () => {}
