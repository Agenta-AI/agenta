import {atom} from "jotai"
import {atomFamily} from "jotai-family"

/**
 * Holds that suspend auto-commit for a revision while a run owns it.
 *
 * The agent's own `commit_revision` checks HEAD, so a concurrent unattended commit would fail
 * it. Inverted through `@agenta/shared` because `@agenta/chat` sits ABOVE `@agenta/playground`
 * — same idiom as `agentCommitSignal`. Keyed by session; every holder must release.
 */
export const agentAutoCommitHoldsAtom = atom<Record<string, string[]>>({})

export interface AgentAutoCommitHoldUpdate {
    revisionId: string
    /** Stable per-holder key — the session id. */
    key: string
    held: boolean
}

export const setAgentAutoCommitHoldAtom = atom(
    null,
    (get, set, {revisionId, key, held}: AgentAutoCommitHoldUpdate) => {
        if (!revisionId || !key) return

        const holds = get(agentAutoCommitHoldsAtom)
        const current = holds[revisionId] ?? []
        const next = held
            ? current.includes(key)
                ? current
                : [...current, key]
            : current.filter((k) => k !== key)

        if (next.length === current.length && next.every((k, i) => k === current[i])) return

        const updated = {...holds}
        // Drop empty entries so the record doesn't grow a key per revision ever visited.
        if (next.length === 0) delete updated[revisionId]
        else updated[revisionId] = next

        set(agentAutoCommitHoldsAtom, updated)
    },
)

export const agentAutoCommitHeldAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => (get(agentAutoCommitHoldsAtom)[revisionId]?.length ?? 0) > 0),
)
