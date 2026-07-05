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
}

export const agentFirstRunSeedAtom = atom<AgentFirstRunSeed | null>(null)
