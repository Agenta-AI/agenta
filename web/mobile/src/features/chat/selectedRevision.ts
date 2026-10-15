import {atom} from "jotai"
import {atomFamily} from "jotai-family"

/**
 * The revision the workspace is pinned to, per session. Null = follow the agent's latest, which is
 * what `useAgentEntity` resolves.
 *
 * Per session, not global: two sessions of the same agent are two workspaces, and a revision picked
 * in one must not retarget the other.
 */
export const selectedRevisionAtomFamily = atomFamily((_sessionId: string) =>
    atom<string | null>(null),
)

/**
 * The newest revision this session's agent committed that the session did not switch to, because
 * the config pane held unsaved edits. The top bar checks for a newer version when it changes, so
 * the version pill offers that revision right away instead of on the next tab switch.
 */
export const heldCommitAtomFamily = atomFamily((_sessionId: string) => atom<string | null>(null))
