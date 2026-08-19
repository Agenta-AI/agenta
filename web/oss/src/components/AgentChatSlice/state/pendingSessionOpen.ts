import {atom} from "jotai"

/**
 * Sessions to open on their agent's playground, set just before navigating there from a surface
 * that lists sessions project-wide (the sessions page, Home). The playground is a different Next
 * page, so the target can't be passed as a prop — it rides this LIST and `AgentChatPanel` consumes
 * every entry for its scope once the chat scope resolves to `appId`. A list, not a single slot:
 * a second open/create fired before the first was consumed used to overwrite it, so the first
 * session was never created and its seed message was lost (#6042). Mirrors the
 * `agentFirstRunSeedsAtom` handoff.
 */
export interface PendingSessionOpen {
    /** The owning agent's workflow artifact id — also the chat scope key. */
    appId: string
    /** Adopt this existing session. Omit to start a fresh one instead — which is what Home's
     * composer does when you pick an agent and describe a task. */
    sessionId?: string
    /** Create the fresh session under THIS id (composers mint it up front so the message they send
     * along can name its session — see `AgentFirstRunSeed.sessionId`). Ignored when
     * `sessionId` adopts an existing session. */
    newSessionId?: string
    title?: string
}

export const pendingSessionOpensAtom = atom<PendingSessionOpen[]>([])

/** Queue a target. Replaces an entry for the same session id (a repeat click), never one for a
 * different session — that overwrite dropped the earlier create. */
export const addPendingSessionOpenAtom = atom(null, (get, set, target: PendingSessionOpen) => {
    const key = target.sessionId ?? target.newSessionId
    const rest = key
        ? get(pendingSessionOpensAtom).filter((t) => (t.sessionId ?? t.newSessionId) !== key)
        : get(pendingSessionOpensAtom)
    set(pendingSessionOpensAtom, [...rest, target])
})

/** Remove specific entries (consumed by the panel, or their navigation failed). Identity-based. */
export const removePendingSessionOpensAtom = atom(
    null,
    (get, set, targets: PendingSessionOpen[]) => {
        const drop = new Set(targets)
        set(
            pendingSessionOpensAtom,
            get(pendingSessionOpensAtom).filter((t) => !drop.has(t)),
        )
    },
)
