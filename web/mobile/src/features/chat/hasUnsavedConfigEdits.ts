import {workflowMolecule} from "@agenta/entities/workflow"
import {
    agentAutoCommitScheduledAtomFamily,
    agentAutoCommitStatusAtomFamily,
} from "@agenta/playground/state"
import type {createStore} from "jotai"

import {viewFormDirtyAtom} from "./viewFormDirty"

type Store = ReturnType<typeof createStore>

/**
 * Whether the configuration holds edits to `revisionId` that are not saved yet: an open view form
 * with edits, a local draft, or an auto-save that is armed or in flight. Moving the session to
 * another revision now would drop them.
 */
export const hasUnsavedConfigEdits = (store: Store, revisionId: string): boolean => {
    if (store.get(viewFormDirtyAtom)) return true
    if (store.get(workflowMolecule.selectors.isDirty(revisionId))) return true
    if (store.get(agentAutoCommitScheduledAtomFamily(revisionId))) return true
    return store.get(agentAutoCommitStatusAtomFamily(revisionId)) === "saving"
}
