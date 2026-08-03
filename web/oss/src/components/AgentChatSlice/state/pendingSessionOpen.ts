import {atom} from "jotai"

/**
 * A session to open on its agent's playground, set just before navigating there from a surface that
 * lists sessions project-wide (the sessions page, Home). The playground is a different Next page, so
 * the target can't be passed as a prop — it rides this single slot (only one open→navigate is in
 * flight at a time) and is consumed once by `AgentChatPanel` when the chat scope resolves to
 * `appId`. Mirrors the `agentFirstRunSeedAtom` handoff.
 */
export interface PendingSessionOpen {
    /** The owning agent's workflow artifact id — also the chat scope key. */
    appId: string
    sessionId: string
    title?: string
}

export const pendingSessionOpenAtom = atom<PendingSessionOpen | null>(null)
