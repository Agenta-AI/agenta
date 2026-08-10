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
