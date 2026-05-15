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
    /**
     * When true, render the drawer with a mask (and therefore its own focus
     * lock). Use when this drawer is opened on top of another drawer (e.g. the
     * trace drawer) so the underlying drawer's focus lock can't steal focus
     * from the editor.
     */
    stacked?: boolean
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

/** Whether the drawer is stacked over another drawer (forces mask + focus lock) */
export const workflowRevisionDrawerStackedAtom = atomWithReset<boolean>(false)

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
    set(workflowRevisionDrawerStackedAtom, params.stacked ?? false)
    if (params.navigationIds !== undefined) {
        set(workflowRevisionDrawerNavigationIdsAtom, params.navigationIds)
    }

    // Prefer the new callback shape; bridge the deprecated one.
    //
    // Wrap the callback in an updater (`() => fn`). Jotai's primitive atoms
    // treat a function value passed to `set` as an updater and invoke it with
    // the current value — storing a callback directly would fire it once with
    // `undefined` and persist the return value instead of the callback itself.
    if (params.onWorkflowCreated) {
        const cb = params.onWorkflowCreated
        set(workflowRevisionDrawerCallbackAtom, () => cb)
    } else if (params.onEvaluatorCreated) {
        const legacy = params.onEvaluatorCreated
        const bridged = (result: {configId?: string}) => legacy(result?.configId)
        set(workflowRevisionDrawerCallbackAtom, () => bridged)
    } else {
        set(workflowRevisionDrawerCallbackAtom, undefined)
    }
})

/**
 * When set, the wrapper's drawer-close effect skips the `setQueryRevision(null)`
 * URL cleanup for the next close. Used when the caller is about to (or already
 * did) `router.push` to a different URL — the close-time cleanup would
 * otherwise rebuild the URL against the stale pre-push pathname and cancel
 * the in-flight navigation.
 */
export const suppressDrawerCloseUrlCleanupAtom = atom<boolean>(false)

/** Close the drawer and clean up */
export const closeWorkflowRevisionDrawerAtom = atom(
    null,
    (_get, set, options?: {skipUrlCleanup?: boolean}) => {
        if (options?.skipUrlCleanup) {
            set(suppressDrawerCloseUrlCleanupAtom, true)
        }
        set(workflowRevisionDrawerOpenAtom, false)
        set(workflowRevisionDrawerEntityIdAtom, RESET)
        set(workflowRevisionDrawerExpandedAtom, RESET)
        set(workflowRevisionDrawerContextAtom, RESET)
        set(workflowRevisionDrawerStackedAtom, RESET)
        set(workflowRevisionDrawerNavigationIdsAtom, RESET)
        set(workflowRevisionDrawerCallbackAtom, undefined)
        set(workflowRevisionDrawerViewModeAtom, RESET)
    },
)

/** Navigate to a specific entity ID within the drawer */
export const navigateWorkflowRevisionDrawerAtom = atom(null, (_get, set, entityId: string) => {
    set(workflowRevisionDrawerEntityIdAtom, entityId)
})
