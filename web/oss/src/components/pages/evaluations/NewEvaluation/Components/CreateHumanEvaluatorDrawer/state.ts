/**
 * Human Evaluator Drawer State Atoms
 *
 * These atoms manage the state for the human evaluator creation drawer
 * within the NewEvaluation modal. They follow the same pattern as the
 * automatic evaluator drawer atoms (see ConfigureEvaluator/state/atoms.ts).
 *
 * Architecture:
 * - atomWithReset for easy cleanup when drawer closes
 * - Action atoms for state transitions (open/close)
 * - No prop drilling - components read directly from atoms
 */

import {atom} from "jotai"
import {atomWithReset, RESET} from "jotai/utils"

// ================================================================
// DRAWER STATE
// ================================================================

/**
 * Controls whether the human evaluator creation drawer is open
 * Used by the NewEvaluation modal to show/hide the AnnotateDrawer
 */
export const humanEvaluatorDrawerOpenAtom = atomWithReset<boolean>(false)

// ================================================================
// ACTION ATOMS
// ================================================================

/**
 * Action to open the human evaluator creation drawer
 */
export const openHumanEvaluatorDrawerAtom = atom(null, (get, set) => {
    set(humanEvaluatorDrawerOpenAtom, true)
})

/**
 * Action to close the drawer and reset state
 */
export const closeHumanEvaluatorDrawerAtom = atom(null, (get, set) => {
    set(humanEvaluatorDrawerOpenAtom, RESET)
})
