/**
 * Human Evaluator Drawer Store
 *
 * Global state for the human evaluator creation/edit drawer.
 * Follows the same pattern as the auto evaluator drawer store.
 */

import type {Workflow} from "@agenta/entities/workflow"
import {atom} from "jotai"
import {atomWithReset, RESET} from "jotai/utils"

// ================================================================
// TYPES
// ================================================================

type HumanDrawerMode = "create" | "edit"

interface OpenHumanDrawerParams {
    mode: HumanDrawerMode
    /** Existing evaluator to edit (only for mode="edit") */
    evaluator?: Workflow
    /** Callback after successful evaluator creation/edit */
    onSuccess?: (slug?: string) => void
}

// ================================================================
// STATE ATOMS
// ================================================================

export const humanEvaluatorDrawerOpenAtom = atomWithReset<boolean>(false)
export const humanEvaluatorDrawerModeAtom = atomWithReset<HumanDrawerMode>("create")
export const humanEvaluatorDrawerEntityAtom = atomWithReset<Workflow | null>(null)
export const humanEvaluatorDrawerCallbackAtom = atom<((slug?: string) => void) | undefined>(
    undefined,
)

// ================================================================
// ACTIONS
// ================================================================

export const openHumanEvaluatorDrawerAtom = atom(
    null,
    (_get, set, params: OpenHumanDrawerParams) => {
        set(humanEvaluatorDrawerOpenAtom, true)
        set(humanEvaluatorDrawerModeAtom, params.mode)
        set(humanEvaluatorDrawerEntityAtom, params.evaluator ?? null)
        set(humanEvaluatorDrawerCallbackAtom, params.onSuccess)
    },
)

export const closeHumanEvaluatorDrawerAtom = atom(null, (_get, set) => {
    set(humanEvaluatorDrawerOpenAtom, RESET)
    set(humanEvaluatorDrawerModeAtom, RESET)
    set(humanEvaluatorDrawerEntityAtom, RESET)
    set(humanEvaluatorDrawerCallbackAtom, undefined)
})
