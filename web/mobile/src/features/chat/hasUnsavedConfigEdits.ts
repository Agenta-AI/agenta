import {workflowMolecule} from "@agenta/entities/workflow"
import {
    agentAutoCommitScheduledAtomFamily,
    agentAutoCommitStatusAtomFamily,
} from "@agenta/playground/state"
import type {createStore} from "jotai"

type Store = ReturnType<typeof createStore>

/**
 * Whether the config pane holds edits to `revisionId` that are not saved yet: a local draft, or an
 * auto-save that is armed or in flight. Moving the session to another revision now would drop them.
 */
export const hasUnsavedConfigEdits = (store: Store, revisionId: string): boolean => {
    if (store.get(workflowMolecule.selectors.isDirty(revisionId))) return true
    if (store.get(agentAutoCommitScheduledAtomFamily(revisionId))) return true
    return store.get(agentAutoCommitStatusAtomFamily(revisionId)) === "saving"
}
