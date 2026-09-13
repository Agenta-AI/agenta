/**
 * Version-history state that outlives the drawer: whether it is open, and which version is
 * picked. The header trigger sets `open`, so those two are genuinely shared.
 *
 * The revert phase and which pane a phone shows stay local to the drawer — no reader outside it.
 *
 * Keyed by WORKFLOW: a revert mints a new revision and the host switches to it, so revision-keyed
 * state would reset the drawer mid-flow.
 */
import {atom} from "jotai"
import {atomFamily} from "jotai-family"

export const versionHistoryOpenAtomFamily = atomFamily((_workflowId: string) => atom(false))

/** Which version the diff pane is showing. Null = nothing picked yet. */
export const versionHistorySelectedAtomFamily = atomFamily((_workflowId: string) =>
    atom<string | null>(null),
)

export const selectAgentVersionAtom = atom(
    null,
    (_get, set, {workflowId, revisionId}: {workflowId: string; revisionId: string}) => {
        set(versionHistorySelectedAtomFamily(workflowId), revisionId)
    },
)

export const openAgentVersionHistoryAtom = atom(null, (_get, set, workflowId: string) => {
    set(versionHistoryOpenAtomFamily(workflowId), true)
})

export const closeAgentVersionHistoryAtom = atom(null, (_get, set, workflowId: string) => {
    set(versionHistoryOpenAtomFamily(workflowId), false)
    set(versionHistorySelectedAtomFamily(workflowId), null)
})
