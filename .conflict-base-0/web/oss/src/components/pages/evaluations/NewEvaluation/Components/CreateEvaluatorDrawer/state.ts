/**
 * CreateEvaluatorDrawer State
 *
 * Atoms for managing the inline evaluator creation drawer
 * within the NewEvaluation modal.
 */

import {playgroundController} from "@agenta/playground"
import {atom} from "jotai"
import {atomWithReset, RESET} from "jotai/utils"

// ================================================================
// DRAWER STATE
// ================================================================

/** The local entity ID being configured in the drawer */
export const drawerEntityIdAtom = atomWithReset<string | null>(null)

/** Whether the drawer is open */
export const drawerOpenAtom = atomWithReset<boolean>(false)

/** Whether the drawer is expanded (shows execution panel) */
export const drawerExpandedAtom = atomWithReset<boolean>(false)

// ================================================================
// ACTIONS
// ================================================================

/** Open the drawer with a local entity ID and initialize the playground */
export const openDrawerWithEntityAtom = atom(null, (_get, set, entityId: string) => {
    set(drawerEntityIdAtom, entityId)
    set(drawerOpenAtom, true)
    set(drawerExpandedAtom, true)
    set(playgroundController.actions.setEntityIds, [entityId])
})

/** Close the drawer and clean up playground state */
export const closeDrawerAtom = atom(null, (_get, set) => {
    set(drawerOpenAtom, false)
    set(drawerEntityIdAtom, RESET)
    set(drawerExpandedAtom, RESET)
    set(playgroundController.actions.setEntityIds, [])
})
