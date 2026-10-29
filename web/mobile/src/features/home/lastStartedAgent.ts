import {atom} from "jotai"
import {atomFamily, atomWithStorage} from "jotai/utils"

/**
 * The agent Home last started a chat with, per project (#6741).
 *
 * The composer binds the head of the roster by default, and the roster is newest-first — so a
 * workspace with two agents always opened on the one created last, whichever was actually in use.
 * Persisted on this device, like pins: a preference, not a fact the server needs.
 *
 * Read via `lastStartedAgentIdAtom(projectId)`; a stale id (the agent archived since) is the
 * page's problem to fall back from, not this store's — it only remembers.
 */
const lastStartedByProjectAtom = atomWithStorage<Record<string, string>>(
    "agenta:home:last-started-agent",
    {},
)

export const lastStartedAgentIdAtom = atomFamily((projectId: string) =>
    atom((get) => get(lastStartedByProjectAtom)[projectId] ?? null),
)

export const rememberStartedAgentAtom = atom(
    null,
    (get, set, {projectId, agentId}: {projectId: string; agentId: string}) => {
        const all = get(lastStartedByProjectAtom)
        if (all[projectId] === agentId) return
        set(lastStartedByProjectAtom, {...all, [projectId]: agentId})
    },
)
