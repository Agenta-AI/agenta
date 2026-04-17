/**
 * Evaluator Playground Atoms
 *
 * Page-local state for the evaluator configuration playground.
 *
 * Entity loading is URL-driven via playgroundSyncAtom (same as the app playground).
 * Phase 1: Evaluator hydrated from URL as primary node (depth 0)
 * Phase 2: App selected → app becomes primary (depth 0), evaluator moves downstream (depth 1)
 *
 * URL updates happen automatically via playgroundSyncAtom's SUB 4 subscription.
 */

import {playgroundController} from "@agenta/playground"
import {playgroundNodesAtom} from "@agenta/playground/state"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

// ============================================================================
// PERSISTED APP SELECTION
// ============================================================================

interface PersistedAppSelection {
    appRevisionId: string
    appLabel: string
}

/** Stores the last selected app per project in localStorage. */
const persistedAppSelectionByProjectAtom = atomWithStorage<Record<string, PersistedAppSelection>>(
    "agenta:evaluator:selected-app",
    {},
)

/** Read/write the persisted app selection for the current project. */
export const persistedAppSelectionAtom = atom(
    (get) => {
        const projectId = get(projectIdAtom) || "__global__"
        const all = get(persistedAppSelectionByProjectAtom)
        return all[projectId] ?? null
    },
    (get, set, next: PersistedAppSelection | null) => {
        const projectId = get(projectIdAtom) || "__global__"
        const all = get(persistedAppSelectionByProjectAtom)
        if (next) {
            set(persistedAppSelectionByProjectAtom, {...all, [projectId]: next})
        } else {
            const {[projectId]: _, ...rest} = all
            set(persistedAppSelectionByProjectAtom, rest)
        }
    },
)

// ============================================================================
// DERIVED SELECTORS
// ============================================================================

/**
 * Entity IDs for the config panel override.
 *
 * When evaluator is the only node (phase 1), it's at depth 0 — return it directly.
 * When app is connected (phase 2), evaluator is at depth 1 — return depth-1 nodes.
 */
export const evaluatorConfigEntityIdsAtom = atom((get) => {
    const nodes = get(playgroundNodesAtom)
    if (nodes.length === 0) return []

    const downstreamNodes = nodes.filter((n) => n.depth > 0)
    if (downstreamNodes.length > 0) {
        return downstreamNodes.map((n) => n.entityId)
    }

    // Phase 1: evaluator is the only (primary) node
    return nodes.map((n) => n.entityId)
})

/**
 * Whether an app workflow is connected (phase 2).
 * True when there are downstream nodes (evaluator at depth 1 = app at depth 0).
 */
export const hasAppConnectedAtom = atom((get) => {
    const nodes = get(playgroundNodesAtom)
    return nodes.some((n) => n.depth > 0)
})

/** Label of the currently selected app workflow (for display in header picker). */
export const selectedAppLabelAtom = atom<string | null>(null)

// ============================================================================
// CONNECT APP (on app select)
// ============================================================================

/**
 * When user selects an app workflow:
 * 1. Swap the primary node to the app (depth 0)
 * 2. Connect the evaluator as downstream (depth 1)
 *
 * URL is updated automatically by playgroundSyncAtom's entity ID subscription.
 */
export const connectAppToEvaluatorAtom = atom(
    null,
    (
        get,
        set,
        params: {
            appRevisionId: string
            appLabel: string
            evaluatorRevisionId: string
            evaluatorLabel: string
        },
    ) => {
        const {appRevisionId, appLabel, evaluatorRevisionId, evaluatorLabel} = params

        // Track selected app label for display + persist across sessions
        set(selectedAppLabelAtom, appLabel)
        set(persistedAppSelectionAtom, {appRevisionId, appLabel})

        // Replace primary node with app
        const nodeId = set(playgroundController.actions.changePrimaryNode, {
            type: "workflow",
            id: appRevisionId,
            label: appLabel,
        })

        if (!nodeId) return

        // Connect evaluator as downstream node (depth 1)
        set(playgroundController.actions.connectDownstreamNode, {
            sourceNodeId: nodeId,
            entity: {
                type: "workflow",
                id: evaluatorRevisionId,
                label: evaluatorLabel,
            },
        })
    },
)
