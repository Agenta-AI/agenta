/**
 * WorkflowRevisionDrawer Store
 *
 * Unified state atoms for the workflow revision drawer.
 * Supports both variant and evaluator contexts.
 *
 * Contexts:
 * - "variant": Existing committed variant (from prompts/overview table row click)
 * - "deployment": Deployment variant (from deployments table)
 * - "evaluator-view": Existing committed evaluator (from evaluators table row click)
 * - "evaluator-create": Ephemeral evaluator from template (new evaluator creation flow)
 */

import {atom} from "jotai"
import {atomWithReset, RESET} from "jotai/utils"

import type {ConfigViewMode} from "./DrawerContext"

// ================================================================
// TYPES
// ================================================================

export type DrawerContext = "variant" | "deployment" | "evaluator-view" | "evaluator-create"

export interface OpenDrawerParams {
    entityId: string
    context: DrawerContext
    /** List of entity IDs for prev/next navigation */
    navigationIds?: string[]
    /** Callback after successful evaluator creation/commit */
    onEvaluatorCreated?: (configId?: string) => void
}

// ================================================================
// STATE ATOMS
// ================================================================

/** Whether the drawer is open */
export const workflowRevisionDrawerOpenAtom = atomWithReset<boolean>(false)

/** The entity ID being displayed */
export const workflowRevisionDrawerEntityIdAtom = atomWithReset<string | null>(null)

/** Drawer context (variant, deployment, evaluator-view, evaluator-create) */
export const workflowRevisionDrawerContextAtom = atomWithReset<DrawerContext>("variant")

/** Whether the drawer is expanded (shows full playground with execution panel) */
export const workflowRevisionDrawerExpandedAtom = atomWithReset<boolean>(false)

/** Config view mode (form/json/yaml) — persists across expand/collapse */
export const workflowRevisionDrawerViewModeAtom = atomWithReset<ConfigViewMode>("form")

/** List of entity IDs for prev/next navigation */
export const workflowRevisionDrawerNavigationIdsAtom = atomWithReset<string[]>([])

/** Callback ref for onEvaluatorCreated */
export const workflowRevisionDrawerCallbackAtom = atom<((configId?: string) => void) | undefined>(
    undefined,
)

// ================================================================
// DERIVED
// ================================================================

/** Combined drawer state (for convenience reads) */
export const workflowRevisionDrawerAtom = atom((get) => ({
    open: get(workflowRevisionDrawerOpenAtom),
    entityId: get(workflowRevisionDrawerEntityIdAtom),
    context: get(workflowRevisionDrawerContextAtom),
    expanded: get(workflowRevisionDrawerExpandedAtom),
    navigationIds: get(workflowRevisionDrawerNavigationIdsAtom),
}))

// ================================================================
// ACTIONS
// ================================================================

/** Open the drawer */
export const openWorkflowRevisionDrawerAtom = atom(null, (get, set, params: OpenDrawerParams) => {
    const opensExpanded =
        params.context === "evaluator-view" || params.context === "evaluator-create"

    set(workflowRevisionDrawerEntityIdAtom, params.entityId)
    set(workflowRevisionDrawerOpenAtom, true)
    set(workflowRevisionDrawerExpandedAtom, opensExpanded)
    set(workflowRevisionDrawerContextAtom, params.context)
    if (params.navigationIds !== undefined) {
        set(workflowRevisionDrawerNavigationIdsAtom, params.navigationIds)
    }
    set(workflowRevisionDrawerCallbackAtom, params.onEvaluatorCreated)
})

/** Close the drawer and clean up */
export const closeWorkflowRevisionDrawerAtom = atom(null, (_get, set) => {
    set(workflowRevisionDrawerOpenAtom, false)
    set(workflowRevisionDrawerEntityIdAtom, RESET)
    set(workflowRevisionDrawerExpandedAtom, RESET)
    set(workflowRevisionDrawerContextAtom, RESET)
    set(workflowRevisionDrawerNavigationIdsAtom, RESET)
    set(workflowRevisionDrawerCallbackAtom, undefined)
    set(workflowRevisionDrawerViewModeAtom, RESET)
})

/** Navigate to a specific entity ID within the drawer */
export const navigateWorkflowRevisionDrawerAtom = atom(null, (_get, set, entityId: string) => {
    set(workflowRevisionDrawerEntityIdAtom, entityId)
})
