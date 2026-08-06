import {atom} from "jotai"

/**
 * Raised by the agent chat when the agent commits a NEW revision of itself
 * (`data-committed-revision` stream part) and the playground switches to it in place.
 * Carries the pre-commit parameters so the config panel can show WHAT the agent
 * changed (per-section indicators / summary) once the new revision's data lands.
 * Cleared by user dismissal or overwritten by the next self-commit.
 */
export interface AgentSelfCommitSignal {
    /** The newly committed revision the playground switched to. */
    revisionId: string
    /** Human version tag when the stream part carried one (e.g. "v7"). */
    version?: string
    /** The previous revision's parameters, captured just before the switch. */
    prevParameters: unknown
    at: number
}

export const agentSelfCommitSignalAtom = atom<AgentSelfCommitSignal | null>(null)
