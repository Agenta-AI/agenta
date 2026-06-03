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
// PERSISTED TESTSET SELECTION
// ============================================================================

interface PersistedTestsetSelection {
    revisionId: string
    testsetId: string | null
    sourceName: string | null
    testcases: ({id: string} & Record<string, unknown>)[]
}

const persistedTestsetSelectionByProjectAtom = atomWithStorage<
    Record<string, PersistedTestsetSelection>
>("agenta:evaluator:selected-testset", {})

export const persistedTestsetSelectionAtom = atom(
    (get) => {
        const projectId = get(projectIdAtom) || "__global__"
        const all = get(persistedTestsetSelectionByProjectAtom)
        return all[projectId] ?? null
    },
    (get, set, next: PersistedTestsetSelection | null) => {
        const projectId = get(projectIdAtom) || "__global__"
        const all = get(persistedTestsetSelectionByProjectAtom)
        if (next) {
            set(persistedTestsetSelectionByProjectAtom, {...all, [projectId]: next})
        } else {
            const {[projectId]: _, ...rest} = all
            set(persistedTestsetSelectionByProjectAtom, rest)
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

/**
 * Label of the currently selected app workflow (for display in header picker).
 *
 * Derived from the node graph: when an evaluator-as-downstream (depth > 0)
 * exists, the primary (depth-0) node is the connected app, and its `label`
 * is what we want to show. Returns `null` in standalone mode (no downstream).
 *
 * Derived (not a primitive atom) so URL-hydration of the snapshot — which
 * restores `playgroundNodesAtom` along with each node's `label` — automatically
 * surfaces the right label without any explicit re-seeding from the page.
 * Previously the atom was a primitive `atom<string | null>(null)`, which left
 * the picker placeholder empty after reload while the disconnect button and
 * testset dropdown (both gated on the node graph) showed normally.
 */
export const selectedAppLabelAtom = atom<string | null>((get) => {
    const nodes = get(playgroundNodesAtom)
    const hasDownstream = nodes.some((n) => n.depth > 0)
    if (!hasDownstream) return null
    const primary = nodes.find((n) => n.depth === 0)
    return primary?.label ?? null
})

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

        // Replace primary node with the app FIRST — if the graph mutation
        // bails out (changePrimaryNode returns null when there's no current
        // primary to swap), we must not commit a stale persisted record.
        // Pre-fix the persist happened before this call, which could leave
        // an `{appRevisionId, appLabel}` entry in localStorage referring to
        // a connection that never actually formed; the next mount would
        // re-hydrate from that record and the picker would show "connected"
        // for an app the playground never linked.
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

        // Clean the shared testcase row against the newly-selected app's input
        // contract so stale keys from a previously-selected app (e.g. chat
        // `messages`/`context` after swapping a chat app for a completion app)
        // are dropped immediately — not only at run time (#4525 / AGE-3793).
        // Runs AFTER connectDownstreamNode so the evaluator is in the graph and
        // its referenced columns (correct_answer_key → ground_truth, etc.) are
        // protected from the strict app-contract clean.
        set(playgroundController.actions.reconcileRowsToPrimary)

        // Persist only after both graph mutations succeeded. The picker
        // display label is derived from the depth-0 node's `label` via
        // `selectedAppLabelAtom`, so no extra write needed here.
        set(persistedAppSelectionAtom, {appRevisionId, appLabel})
    },
)

// ============================================================================
// DISCONNECT APP (reverse the connect)
// ============================================================================

/**
 * Disconnect the upstream app and return to standalone evaluator mode.
 *
 * Reverse of `connectAppToEvaluatorAtom`:
 * 1. Capture the downstream evaluator's identity (we need it after removal).
 * 2. Remove the downstream evaluator node (`removeNodeAtom` keeps primary if
 *    target is depth > 0; if there's no depth-1 node, this is a no-op and we
 *    just swap primary).
 * 3. Swap the primary node back to the evaluator. `changePrimaryNodeAtom`
 *    clears `outputConnectionsAtom` for us as a side-effect.
 * 4. Clear the persisted app selection + display label so the picker placeholder
 *    reverts to "Select app".
 */
export const disconnectAppFromEvaluatorAtom = atom(null, (get, set) => {
    const nodes = get(playgroundController.selectors.nodes())
    const downstreamEvaluator = nodes.find((n) => n.depth > 0)
    if (!downstreamEvaluator) {
        // No downstream node means the graph is already in the
        // standalone-evaluator shape, but a stale `persistedAppSelectionAtom`
        // entry could still be on disk (e.g., from a previous session where
        // `connectAppToEvaluatorAtom` persisted before its swap silently
        // failed mid-mutation). Clear it on this path too so the next mount
        // doesn't re-hydrate a phantom "connected" app.
        set(persistedAppSelectionAtom, null)
        return
    }

    const evaluatorEntity = {
        type: downstreamEvaluator.entityType,
        id: downstreamEvaluator.entityId,
        label: downstreamEvaluator.label ?? "Evaluator",
    }

    set(playgroundController.actions.removeNode, downstreamEvaluator.id)
    set(playgroundController.actions.changePrimaryNode, evaluatorEntity)
    // `selectedAppLabelAtom` is derived from the node graph — clearing the
    // downstream above is what flips it back to `null`. Only the persisted
    // localStorage cache needs an explicit clear.
    set(persistedAppSelectionAtom, null)
})
