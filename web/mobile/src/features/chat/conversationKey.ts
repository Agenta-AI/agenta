/**
 * What identifies a mounted conversation: the session, and only the session.
 *
 * A changed key REMOUNTS the chat engine, and its unmount aborts the in-flight stream — so a
 * revision in this key cancels a running turn every time the config auto-commits (#6126) or the
 * user picks another revision in the top bar. The revision belongs in a prop: `useChat` is pinned
 * to the session and the request builder reads the live revision through a ref.
 *
 * It lives here with a test rather than inline because the inline comment did not stop it.
 */
export const conversationKey = ({sessionId}: {sessionId: string; revisionId: string | null}) =>
    sessionId
