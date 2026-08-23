import {atom} from "jotai"

/**
 * First-run seeds: composer text (or a template's seed message) set at create time and consumed by
 * the agent chat on the target playground — surfaced in the empty state and auto-sent when armed.
 * A LIST, not a single slot: rapid back-to-back creates used to overwrite the previous seed before
 * its playground consumed it, silently losing the earlier message (#6042). Each entry stays parked
 * until the conversation that owns it actually dispatches (or claims) it.
 */
export interface AgentFirstRunSeed {
    appId: string
    /** The session this message belongs to, minted by the composer alongside
     * `PendingSessionOpen.newSessionId`. Without it the seed goes to whichever session is active
     * and looks empty on arrival — the PREVIOUS one, if it mounts before the new one is created. */
    sessionId?: string
    /** Known only when the agent was just created. Starting a conversation with an EXISTING agent
     * (Home's composer) has no revision in hand, and matches on the chat scope instead. */
    revisionId?: string
    seedMessage: string
    /**
     * The seed is an explicit "go" (the onboarding Create-agent click), so send it as soon as the model
     * is ready — don't wait for a Start click. Redirect-seeds omit this: a model ready on arrival still
     * shows Start (Arda: never auto-send a seed that merely arrived with a ready model).
     */
    autoSend?: boolean
    /**
     * Files picked before the session existed (Home / an agent's overview). Uploads are
     * session-scoped, so they cannot be staged there — they ride here and go through the chat's
     * own `addFiles`, which is what paste and drop already use.
     */
    seedFiles?: File[]
}

export const agentFirstRunSeedsAtom = atom<AgentFirstRunSeed[]>([])

/** Park a seed. Replaces an existing entry for the same session (a re-send of the same handoff),
 * never an entry for a DIFFERENT session — that overwrite was the message-loss bug. */
export const addFirstRunSeedAtom = atom(null, (get, set, seed: AgentFirstRunSeed) => {
    const rest = seed.sessionId
        ? get(agentFirstRunSeedsAtom).filter((s) => s.sessionId !== seed.sessionId)
        : get(agentFirstRunSeedsAtom)
    set(agentFirstRunSeedsAtom, [...rest, seed])
})

/** Drop one parked seed (dispatched, claimed, or its navigation failed). Identity-based so two
 * seeds with equal text can't shadow each other. */
export const removeFirstRunSeedAtom = atom(null, (get, set, seed: AgentFirstRunSeed) => {
    set(
        agentFirstRunSeedsAtom,
        get(agentFirstRunSeedsAtom).filter((s) => s !== seed),
    )
})
