/**
 * Evaluator Drawer Store — Compatibility Bridge
 *
 * Delegates to the unified WorkflowRevisionDrawer store.
 * Maintains the old API surface so existing call sites don't need to change immediately.
 */

import {
    openWorkflowRevisionDrawerAtom,
    closeWorkflowRevisionDrawerAtom,
    workflowRevisionDrawerOpenAtom,
    workflowRevisionDrawerEntityIdAtom,
    workflowRevisionDrawerExpandedAtom,
    workflowRevisionDrawerCallbackAtom,
} from "@agenta/playground-ui/workflow-revision-drawer"
import {atom} from "jotai"

// ================================================================
// TYPES
// ================================================================

type EvaluatorDrawerMode = "create" | "view"

interface OpenDrawerParams {
    entityId: string
    mode: EvaluatorDrawerMode
    /** List of entity IDs for prev/next navigation */
    navigationIds?: string[]
    /** Callback after successful evaluator creation/commit. Called with the new revision ID. */
    onEvaluatorCreated?: (configId?: string) => void
}

// ================================================================
// RE-EXPORTS (read atoms — same underlying state)
// ================================================================

export const evaluatorDrawerEntityIdAtom = workflowRevisionDrawerEntityIdAtom
export const evaluatorDrawerOpenAtom = workflowRevisionDrawerOpenAtom
export const evaluatorDrawerExpandedAtom = workflowRevisionDrawerExpandedAtom
export const evaluatorDrawerCallbackAtom = workflowRevisionDrawerCallbackAtom

// ================================================================
// BRIDGE ACTIONS
// ================================================================

/** Open the drawer — maps evaluator mode to unified context */
export const openEvaluatorDrawerAtom = atom(null, (_get, set, params: OpenDrawerParams) => {
    set(openWorkflowRevisionDrawerAtom, {
        entityId: params.entityId,
        context: params.mode === "create" ? "evaluator-create" : "evaluator-view",
        navigationIds: params.navigationIds,
        onEvaluatorCreated: params.onEvaluatorCreated,
    })
})

/** Close the drawer */
export const closeEvaluatorDrawerAtom = closeWorkflowRevisionDrawerAtom
