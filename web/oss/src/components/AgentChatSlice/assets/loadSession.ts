import type {UIMessage} from "ai"

/**
 * Server-side hydration seam for a session's conversation.
 *
 * Today this returns `null`: the agent service wires a `NoopSessionStore`, so the backend does
 * NOT own message history — the only record of a conversation's content is this browser's
 * localStorage (`sessionMessagesAtom`). So opening a session from a deep link / observability
 * trace can only render content for sessions that originated in THIS browser.
 *
 * When the backend gains a real `SessionStore` (DB-backed message history), wire the call here:
 *
 *   POST {AGENT_SERVICE}/services/agent/v0/load-session
 *        ?project_id=<projectId>&application_id=<appId>
 *        body: { session_id }
 *   → returns the stored turns; map them to v6 `UIMessage[]` (reuse the vercel messages
 *     adapter's shape) and return them here. The caller writes them into `sessionMessagesAtom`
 *     before opening the tab, so the conversation seeds from server history.
 *
 * Returning `null` means "no server history available" — the caller falls back to whatever is
 * already in localStorage.
 */
export const loadSessionMessages = async (_sessionId: string): Promise<UIMessage[] | null> => {
    return null
}
