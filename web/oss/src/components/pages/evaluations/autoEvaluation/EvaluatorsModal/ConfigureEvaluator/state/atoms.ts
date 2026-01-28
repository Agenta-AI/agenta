/**
 * Evaluator Playground State Atoms
 *
 * These atoms manage the state for the evaluator configuration playground.
 * They are used by both the standalone page (/evaluators/configure/[id])
 * and the inline drawer in the evaluation creation modal.
 *
 * Architecture follows patterns from the prompt playground:
 * - atomWithReset for easy cleanup
 * - Local cache + derived pattern where needed
 * - Action atoms for state transitions
 * - No prop drilling - components read directly from atoms
 *
 * @see /AGENTS.md for state management guidelines
 */

import type {FormInstance} from "antd"
import {atom} from "jotai"
import {atomWithReset, atomWithStorage, RESET} from "jotai/utils"

import type {Evaluator, SimpleEvaluator, Variant} from "@/oss/lib/Types"
import {stringStorage} from "@/oss/state/utils/stringStorage"

// ================================================================
// TYPES
// ================================================================

export type PlaygroundMode = "create" | "edit" | "clone"

export interface EvaluatorPlaygroundSession {
    /** The evaluator template being configured */
    evaluator: Evaluator | null
    /** ID of existing config (for edit/clone modes) */
    existingConfigId: string | null
    /** Current mode */
    mode: PlaygroundMode
}

export interface TestcaseSelection {
    testcase: Record<string, any> | null
}

export interface TraceTreeState {
    trace: Record<string, any> | string | null
}

// ================================================================
// CORE SESSION ATOMS
// ================================================================

/**
 * Root session state - identifies what evaluator we're configuring
 * Reset when leaving the playground (page or drawer)
 */
export const playgroundSessionAtom = atomWithReset<EvaluatorPlaygroundSession>({
    evaluator: null,
    existingConfigId: null,
    mode: "create",
})

/**
 * Derived: current evaluator template (convenience accessor)
 */
export const playgroundEvaluatorAtom = atom((get) => get(playgroundSessionAtom).evaluator)

/**
 * Derived: is in edit mode?
 */
export const playgroundIsEditModeAtom = atom((get) => get(playgroundSessionAtom).mode === "edit")

/**
 * Derived: is in clone mode?
 */
export const playgroundIsCloneModeAtom = atom((get) => get(playgroundSessionAtom).mode === "clone")

// ================================================================
// EDIT VALUES ATOM
// Following the "local cache + derived" pattern from prompt playground
// ================================================================

/**
 * The config values being edited
 * - In create mode: null initially, set after first save
 * - In edit mode: loaded from existing config
 * - In clone mode: copied from source config (with cleared name)
 */
export const playgroundEditValuesAtom = atomWithReset<SimpleEvaluator | null>(null)

// ================================================================
// FORM STATE
// ================================================================

/**
 * Reference to the Ant Design Form instance
 * Allows DebugSection to read form values for running the evaluator
 *
 * This is set by ConfigureEvaluator when the form mounts
 * and read by DebugSection to get current parameters
 */
export const playgroundFormRefAtom = atom<FormInstance | null>(null)

// ================================================================
// TEST SECTION ATOMS
// These manage the state for testing the evaluator
// ================================================================

/**
 * Selected variant for testing the evaluator
 * The variant is run to generate output that the evaluator will evaluate
 */
export const playgroundSelectedVariantAtom = atomWithReset<Variant | null>(null)

/**
 * Selected testset ID
 * Used to load testcases for testing
 */
export const playgroundSelectedTestsetIdAtom = atomWithReset<string>("")

/**
 * Selected testset revision ID
 */
export const playgroundSelectedRevisionIdAtom = atomWithReset<string>("")

/**
 * Selected testcase data from the testset
 * Contains the input data used for testing
 */
export const playgroundSelectedTestcaseAtom = atomWithReset<TestcaseSelection>({
    testcase: null,
})

/**
 * Trace output from running the variant
 * Used by DynamicFormField to show trace keys for data mapping in RAG evaluators
 */
export const playgroundTraceTreeAtom = atomWithReset<TraceTreeState>({
    trace: null,
})

/**
 * Persisted atom for the last used app ID in the evaluator debug section.
 * Stored in localStorage with key "agenta:evaluator-debug:last-app-id"
 */
export const playgroundLastAppIdAtom = atomWithStorage<string | null>(
    "agenta:evaluator-debug:last-app-id",
    null,
    stringStorage,
)

/**
 * Persisted atom for the last used variant ID in the evaluator debug section.
 * Stored in localStorage with key "agenta:evaluator-debug:last-variant-id"
 */
export const playgroundLastVariantIdAtom = atomWithStorage<string | null>(
    "agenta:evaluator-debug:last-variant-id",
    null,
    stringStorage,
)

// ================================================================
// ACTION ATOMS
// These provide a clean API for state transitions
// ================================================================

/**
 * Initialize the playground for configuring an evaluator
 * Call this when:
 * - Opening the evaluator configure page
 * - Opening the evaluator drawer from evaluation modal
 *
 * @param evaluator - The evaluator template to configure
 * @param existingConfig - Optional existing config (for edit/clone modes)
 * @param mode - The mode: "create" | "edit" | "clone"
 */
export const initPlaygroundAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            evaluator: Evaluator
            existingConfig?: SimpleEvaluator | null
            mode?: PlaygroundMode
        },
    ) => {
        const mode = payload.mode ?? (payload.existingConfig ? "edit" : "create")

        // Set session
        set(playgroundSessionAtom, {
            evaluator: payload.evaluator,
            existingConfigId: payload.existingConfig?.id ?? null,
            mode,
        })

        // Set edit values
        if ((mode === "edit" || mode === "clone") && payload.existingConfig) {
            set(playgroundEditValuesAtom, payload.existingConfig)
        } else {
            set(playgroundEditValuesAtom, RESET)
        }

        // Note: We intentionally do NOT reset test section state (variant, testcase, trace)
        // This allows users to test different evaluators with the same testcase - less friction
    },
)

/**
 * Reset the entire playground state
 * Call this when:
 * - Leaving the evaluator configure page
 * - Closing the evaluator drawer
 */
export const resetPlaygroundAtom = atom(null, (get, set) => {
    set(playgroundSessionAtom, RESET)
    set(playgroundEditValuesAtom, RESET)
    set(playgroundFormRefAtom, null)
    set(playgroundSelectedVariantAtom, RESET)
    set(playgroundSelectedTestsetIdAtom, RESET)
    set(playgroundSelectedTestcaseAtom, RESET)
    set(playgroundTraceTreeAtom, RESET)
})

/**
 * Update state after successful save
 * Call this after createEvaluatorConfig or updateEvaluatorConfig succeeds
 *
 * @param savedConfig - The config returned from the API
 */
export const commitPlaygroundAtom = atom(null, (get, set, savedConfig: SimpleEvaluator) => {
    // Update edit values with saved config
    set(playgroundEditValuesAtom, savedConfig)

    // Update session to reflect we're now in edit mode
    const session = get(playgroundSessionAtom)
    set(playgroundSessionAtom, {
        ...session,
        existingConfigId: savedConfig.id,
        mode: "edit",
    })
})

/**
 * Switch to clone mode from current edit values
 * Creates a copy of the current config for modification
 */
export const cloneCurrentConfigAtom = atom(null, (get, set) => {
    const currentValues = get(playgroundEditValuesAtom)
    if (!currentValues) return

    const session = get(playgroundSessionAtom)
    set(playgroundSessionAtom, {
        ...session,
        existingConfigId: null, // Clear ID so we create new
        mode: "clone",
    })

    // Keep edit values but they'll be treated as a template
    // The form will clear the name field for clone mode
})

// ================================================================
// DRAWER STATE
// These manage the inline drawer in the evaluation creation modal
// ================================================================

/**
 * Controls whether the inline evaluator creation drawer is open
 * Used by the NewEvaluation modal to show/hide the ConfigureEvaluator drawer
 */
export const evaluatorDrawerOpenAtom = atomWithReset<boolean>(false)

/**
 * Action to open the drawer with a specific evaluator template
 * This combines opening the drawer AND initializing the playground
 */
export const openEvaluatorDrawerAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            evaluator: Evaluator
            existingConfig?: SimpleEvaluator | null
            mode?: PlaygroundMode
        },
    ) => {
        // Initialize the playground with the evaluator
        set(initPlaygroundAtom, payload)
        // Open the drawer
        set(evaluatorDrawerOpenAtom, true)
    },
)

/**
 * Action to close the drawer and reset playground state
 */
export const closeEvaluatorDrawerAtom = atom(null, (get, set) => {
    set(evaluatorDrawerOpenAtom, false)
    // Reset playground state when closing
    set(resetPlaygroundAtom)
})

// ================================================================
// DERIVED STATE HELPERS
// ================================================================

/**
 * Check if playground has unsaved changes
 * Compare current form values against saved edit values
 *
 * Note: This is a simple check - for full dirty detection,
 * you'd need to compare form.getFieldsValue() with editValues
 */
export const playgroundHasUnsavedChangesAtom = atom((get) => {
    const session = get(playgroundSessionAtom)
    const editValues = get(playgroundEditValuesAtom)

    // In create mode with no saved config, any form input = unsaved
    if (session.mode === "create" && !editValues) {
        // Would need form ref to check if any values entered
        // For now, return false - can enhance later
        return false
    }

    // In edit mode, would need to compare form values with editValues
    // This requires access to the form, which we have via playgroundFormRefAtom
    // Can be enhanced to do deep comparison if needed
    return false
})
