import {atom} from "jotai"

/**
 * First-run seed for a freshly-created agent: the composer text (or a template's seed message) set at
 * create time and consumed once by the agent chat on the new app's playground — pre-fills the composer
 * so the user lands ready to send. A single slot (only one create→navigate is in flight at a time);
 * both ids are carried so the chat can match whether it mounts on the revision id or the app id.
 */
export interface AgentFirstRunSeed {
    appId: string
    /** The session this message belongs to, minted by the composer alongside
     * `pendingSessionOpenAtom.newSessionId`. Without it the seed goes to whichever session is active
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

export const agentFirstRunSeedAtom = atom<AgentFirstRunSeed | null>(null)
