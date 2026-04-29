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
 * - "app-create": Ephemeral app from template (new app creation flow)
 */

import {atom} from "jotai"
import {atomWithReset, RESET} from "jotai/utils"

import type {ConfigViewMode} from "./DrawerContext"

// ================================================================
// TYPES
// ================================================================

export type DrawerContext =
    | "variant"
    | "deployment"
    | "evaluator-view"
    | "evaluator-create"
    | "app-create"

/**
 * Whether the drawer context represents creating a new entity (vs. viewing
 * an existing one). Create contexts use ephemeral `local-*` entities and
 * hide chrome (action buttons, metadata sidebar, navigation arrows).
 */
export const isCreateContext = (context: DrawerContext): boolean =>
    context === "evaluator-create" || context === "app-create"

export interface OpenDrawerParams {
    entityId: string
    context: DrawerContext
    /** List of entity IDs for prev/next navigation */
    navigationIds?: string[]
    /**
     * Callback after successful workflow creation/commit. Fires for both
     * `evaluator-create` and `app-create` contexts.
     *
     * For `evaluator-create`, called with the new config ID.
     * For `app-create`, called with `{newAppId, newRevisionId}` so the caller
     * can navigate to the app-scoped playground.
     */
    onWorkflowCreated?: (result: {
        configId?: string
        newAppId?: string
        newRevisionId?: string
    }) => void
    /**
     * @deprecated Use `onWorkflowCreated` instead. Kept for backward compatibility
     * with existing evaluator-create call sites; will be removed in a follow-up.
     */
    onEvaluatorCreated?: (configId?: string) => void
    /**
     * Override the drawer's initial expanded state. When omitted, evaluator
     * contexts default to expanded and other contexts default to collapsed.
     * Pass `true` to force expanded (full playground with execution panel) —
     * e.g. when opening a span in playground for replay/testing.
     */
    expanded?: boolean
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

/**
 * Callback ref fired post-commit by the drawer. Stores the new
 * `onWorkflowCreated` shape; old `onEvaluatorCreated` callers are bridged
 * inside `openWorkflowRevisionDrawerAtom`.
 */
export const workflowRevisionDrawerCallbackAtom = atom<
    ((result: {configId?: string; newAppId?: string; newRevisionId?: string}) => void) | undefined
>(undefined)

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
        params.expanded ??
        (params.context === "evaluator-view" ||
            params.context === "evaluator-create" ||
            params.context === "app-create")

    set(workflowRevisionDrawerEntityIdAtom, params.entityId)
    set(workflowRevisionDrawerOpenAtom, true)
    set(workflowRevisionDrawerExpandedAtom, opensExpanded)
    set(workflowRevisionDrawerContextAtom, params.context)
    if (params.navigationIds !== undefined) {
        set(workflowRevisionDrawerNavigationIdsAtom, params.navigationIds)
    }

    // Prefer the new callback shape; bridge the deprecated one.
    if (params.onWorkflowCreated) {
        set(workflowRevisionDrawerCallbackAtom, params.onWorkflowCreated)
    } else if (params.onEvaluatorCreated) {
        const legacy = params.onEvaluatorCreated
        set(workflowRevisionDrawerCallbackAtom, (result: {configId?: string}) =>
            legacy(result.configId),
        )
    } else {
        set(workflowRevisionDrawerCallbackAtom, undefined)
    }
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
