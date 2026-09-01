/**
 * Version-history drawer state.
 *
 * Keyed by WORKFLOW, not revision: a revert mints a new revision and the host switches to it, so
 * revision-keyed state would reset the drawer mid-flow. Workflow-keyed also bounds the
 * `atomFamily` maps (which never evict) to the handful of agents opened in a session.
 *
 * Lives with the drawer, as `WorkflowRevisionDrawer/store.ts` does — the revert engine is the
 * part that belongs in `@agenta/playground`.
 */
import {atom} from "jotai"
import {atomFamily} from "jotai-family"

/** The footer's machine. `done`/`failed` are terminal until the user acts again. */
export type RevertPhase = "idle" | "confirm" | "reverting" | "done" | "failed"

export const versionHistoryOpenAtomFamily = atomFamily((_workflowId: string) => atom(false))

/** Which version the diff pane is showing. Null = nothing picked yet. */
export const versionHistorySelectedAtomFamily = atomFamily((_workflowId: string) =>
    atom<string | null>(null),
)

export const versionHistoryPhaseAtomFamily = atomFamily((_workflowId: string) =>
    atom<RevertPhase>("idle"),
)

/** The version a completed revert restored, so `done` can name it after the selection moves. */
export const versionHistoryRevertedFromAtomFamily = atomFamily((_workflowId: string) =>
    atom<number | null>(null),
)

/** Pick a version. Any in-progress revert is abandoned — the footer is about the selection. */
export const selectAgentVersionAtom = atom(
    null,
    (_get, set, {workflowId, revisionId}: {workflowId: string; revisionId: string}) => {
        set(versionHistorySelectedAtomFamily(workflowId), revisionId)
        set(versionHistoryPhaseAtomFamily(workflowId), "idle")
    },
)

export const openAgentVersionHistoryAtom = atom(null, (_get, set, workflowId: string) => {
    set(versionHistoryOpenAtomFamily(workflowId), true)
})

export const closeAgentVersionHistoryAtom = atom(null, (_get, set, workflowId: string) => {
    set(versionHistoryOpenAtomFamily(workflowId), false)
    set(versionHistorySelectedAtomFamily(workflowId), null)
    set(versionHistoryPhaseAtomFamily(workflowId), "idle")
    set(versionHistoryRevertedFromAtomFamily(workflowId), null)
})
