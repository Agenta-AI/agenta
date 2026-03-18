/**
 * Evaluator Drawer Store
 *
 * Global state for the evaluator configuration drawer.
 * Supports two modes:
 * - "create": Ephemeral entity from template (used in NewEvaluation modal)
 * - "view": Existing committed entity (used from evaluators table row click)
 *
 * Follows the same pattern as variantDrawerStore.ts.
 */

import {playgroundController} from "@agenta/playground"
import {atom} from "jotai"
import {atomWithReset, RESET} from "jotai/utils"

// ================================================================
// TYPES
// ================================================================

type EvaluatorDrawerMode = "create" | "view"

interface OpenDrawerParams {
    entityId: string
    mode: EvaluatorDrawerMode
    /** Callback after successful evaluator creation/commit. Called with the new revision ID. */
    onEvaluatorCreated?: (configId?: string) => void
}

// ================================================================
// STATE ATOMS
// ================================================================

/** The entity ID being configured in the drawer */
export const evaluatorDrawerEntityIdAtom = atomWithReset<string | null>(null)

/** Whether the drawer is open */
export const evaluatorDrawerOpenAtom = atomWithReset<boolean>(false)

/** Whether the drawer is expanded (shows execution panel) */
export const evaluatorDrawerExpandedAtom = atomWithReset<boolean>(false)

/** Current drawer mode */
export const evaluatorDrawerModeAtom = atomWithReset<EvaluatorDrawerMode>("create")

/** Callback ref for onEvaluatorCreated — stored as atom so drawer content can read it */
export const evaluatorDrawerCallbackAtom = atom<((configId?: string) => void) | undefined>(
    undefined,
)

// ================================================================
// ACTIONS
// ================================================================

/** Open the drawer with an entity ID and initialize the playground */
export const openEvaluatorDrawerAtom = atom(null, (_get, set, params: OpenDrawerParams) => {
    set(evaluatorDrawerEntityIdAtom, params.entityId)
    set(evaluatorDrawerOpenAtom, true)
    set(evaluatorDrawerExpandedAtom, false)
    set(evaluatorDrawerModeAtom, params.mode)
    set(evaluatorDrawerCallbackAtom, params.onEvaluatorCreated)
    set(playgroundController.actions.setEntityIds, [params.entityId])
})

/** Close the drawer and clean up playground state */
export const closeEvaluatorDrawerAtom = atom(null, (_get, set) => {
    set(evaluatorDrawerOpenAtom, false)
    set(evaluatorDrawerEntityIdAtom, RESET)
    set(evaluatorDrawerExpandedAtom, RESET)
    set(evaluatorDrawerModeAtom, RESET)
    set(evaluatorDrawerCallbackAtom, undefined)
    set(playgroundController.actions.setEntityIds, [])
})
