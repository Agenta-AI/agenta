import {atom} from "jotai"

/**
 * First-run seed for a freshly-created agent: the composer text (or a template's seed message) set at
 * create time and consumed once by the agent chat on the new app's playground — pre-fills the composer
 * so the user lands ready to send. A single slot (only one create→navigate is in flight at a time);
 * both ids are carried so the chat can match whether it mounts on the revision id or the app id.
 */
export interface AgentFirstRunSeed {
    appId: string
    revisionId: string
    seedMessage: string
    /**
     * The seed is an explicit "go" (the onboarding Create-agent click), so send it as soon as the model
     * is ready — don't wait for a Start click. Redirect-seeds omit this: a model ready on arrival still
     * shows Start (Arda: never auto-send a seed that merely arrived with a ready model).
     */
    autoSend?: boolean
}

export const agentFirstRunSeedAtom = atom<AgentFirstRunSeed | null>(null)
