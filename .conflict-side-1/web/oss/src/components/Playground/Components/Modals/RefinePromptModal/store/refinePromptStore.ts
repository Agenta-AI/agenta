/**
 * State management for the Refine Prompt Modal
 *
 * Key insight: This is NOT a chat. Each "turn" is a refinement request:
 * - User provides `guidelines`
 * - AI returns `messages` + `summary`
 *
 * The state models this as RefinementIteration[], not chat messages.
 */

import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {PromptTemplate, RefinementIteration} from "../types"

/**
 * Modal open state (scoped per prompt)
 */
export const refineModalOpenAtomFamily = atomFamily((promptId: string) => atom(false))

/**
 * Refinement iterations history (guidelines + explanations)
 * Each iteration contains what the user asked for and what the AI explained it changed.
 */
export const refineIterationsAtomFamily = atomFamily((promptId: string) =>
    atom<RefinementIteration[]>([]),
)

/**
 * Current working prompt (starts as original, updated after each refinement)
 * This is what gets sent to the next refinement API call.
 */
export const workingPromptAtomFamily = atomFamily((promptId: string) =>
    atom<PromptTemplate | null>(null),
)

/**
 * Editor remount version.
 *
 * Increments only when AI returns a new refined prompt so MessageEditor
 * can reinitialize from the latest AI output without remounting on
 * each manual keystroke.
 */
export const workingPromptVersionAtomFamily = atomFamily((promptId: string) => atom(0))

/**
 * Loading state for refinement API calls
 */
export const refineLoadingAtomFamily = atomFamily((promptId: string) => atom(false))

/**
 * Diff view toggle state
 */
export const refineDiffViewAtomFamily = atomFamily((promptId: string) => atom(false))

/**
 * Original prompt snapshot (captured when modal opens, never changes)
 * Used for diff comparison against the current working prompt.
 */
export const originalPromptSnapshotAtomFamily = atomFamily((promptId: string) =>
    atom<PromptTemplate | null>(null),
)

/**
 * Pending guidelines (what user is currently typing/submitting)
 * Used to show the user's message immediately while waiting for API response.
 */
export const pendingGuidelinesAtomFamily = atomFamily((promptId: string) =>
    atom<string | null>(null),
)

/**
 * Helper atom to reset all modal state for a given promptId
 * Usage: set(resetRefineModalAtomFamily(promptId))
 */
export const resetRefineModalAtomFamily = atomFamily((promptId: string) =>
    atom(null, (get, set) => {
        set(refineModalOpenAtomFamily(promptId), false)
        set(refineIterationsAtomFamily(promptId), [])
        set(workingPromptAtomFamily(promptId), null)
        set(workingPromptVersionAtomFamily(promptId), 0)
        set(refineLoadingAtomFamily(promptId), false)
        set(refineDiffViewAtomFamily(promptId), false)
        set(originalPromptSnapshotAtomFamily(promptId), null)
        set(pendingGuidelinesAtomFamily(promptId), null)
    }),
)
