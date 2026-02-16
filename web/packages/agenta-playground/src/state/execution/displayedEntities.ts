/**
 * Displayed Entities
 *
 * Higher-level derived selectors for validated entity IDs, readiness signals,
 * and layout state. Migrated from OSS `variants.ts`.
 *
 * The key distinction from raw `entityIdsAtom`:
 * - `entityIdsAtom`: raw selection (may contain stale IDs from URL hydration)
 * - `displayedEntityIdsAtom`: compatibility list (includes pending entities)
 * - `resolvedEntityIdsAtom`: strict list (only entities with resolved data)
 *
 * Validation is entity-scoped (not app-scoped): each entity ID is checked
 * individually via its runnable bridge query state. No app-level aggregation
 * is needed — this allows the playground to work with or without app scoping.
 *
 * @module execution/displayedEntities
 */

import {runnableBridge} from "@agenta/entities/runnable"
import type {RequestPayloadData} from "@agenta/entities/runnable"
import {isLocalDraftId} from "@agenta/entities/shared"
import isEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"

import {entityIdsAtom, playgroundNodesAtom} from "../atoms/playground"
import {isPlaceholderId} from "../controllers/playgroundSnapshotController"

// ============================================================================
// READINESS SIGNAL
// ============================================================================

/**
 * Indicates whether all selected playground entities have resolved their
 * initial data load.
 *
 * Per-entity check: each selected entity's `runnableBridge.query()` must
 * have finished loading (not pending). Placeholder IDs and local drafts
 * are considered immediately ready.
 *
 * Must be true before we filter entityIdsAtom or attempt to apply
 * default selections.
 */
export const playgroundRevisionsReadyAtom = atom((get) => {
    const ids = get(entityIdsAtom)
    if (ids.length === 0) return true

    return ids.every((id) => {
        if (isPlaceholderId(id)) return true
        if (isLocalDraftId(id)) return true
        const query = get(runnableBridge.query(id))
        return !query.isPending
    })
})

// ============================================================================
// PLAYGROUND STATUS
// ============================================================================

/**
 * Whether the playground has completed its initial entity selection.
 *
 * Set to `true` by the OSS/EE layer (via `playgroundSyncAtom`) once
 * `ensurePlaygroundDefaults` has either applied a default selection or
 * determined that no default is available.
 *
 * While `false`, the playground is still initializing and should show
 * a loading state rather than an error.
 */
export const playgroundInitializedAtom = atom(false) as import("jotai").PrimitiveAtom<boolean>

/**
 * High-level playground lifecycle status.
 *
 * - `"idle"`:    No entities selected AND initialization hasn't completed yet.
 *               Show a loading/skeleton state.
 * - `"loading"`: Entities are selected but their queries are still pending.
 *               Show a loading/skeleton state.
 * - `"ready"`:   Entities are selected and all queries have resolved.
 *               Show the playground UI.
 * - `"empty"`:   Initialization completed but no entities could be loaded.
 *               Show an empty/error state.
 */
export type PlaygroundStatus = "idle" | "loading" | "ready" | "empty"

export const playgroundStatusAtom = atom<PlaygroundStatus>((get) => {
    const ids = get(entityIdsAtom)
    const initialized = get(playgroundInitializedAtom)
    const hasEntities = ids.length > 0

    if (!hasEntities) {
        // No entities selected — are we still initializing?
        return initialized ? "empty" : "idle"
    }

    // Entities exist — check if their queries have resolved
    const ready = get(playgroundRevisionsReadyAtom)
    if (!ready) return "loading"

    const resolved = get(resolvedEntityIdsAtom)
    if (resolved.length > 0) return "ready"
    return initialized ? "empty" : "loading"
})

// ============================================================================
// DISPLAYED ENTITY IDS (validated per-entity)
// ============================================================================

/**
 * Filtered entity IDs (compatibility facade): IDs whose data exists, is still
 * loading, or are local drafts / placeholder IDs.
 *
 * An entity ID is kept if:
 * 1. It's a placeholder ID (pending selection)
 * 2. It's a local draft ID (detected by pure prefix check)
 * 3. Its `runnableBridge.query(id)` has data OR is still pending
 *
 * Stale IDs (query resolved with no data) are filtered out.
 */
export const displayedEntityIdsAtom = selectAtom(
    atom((get) => {
        const selected = get(entityIdsAtom)
        return selected.map((id) => {
            if (isPlaceholderId(id)) return {id, keep: true}
            if (isLocalDraftId(id)) return {id, keep: true}
            const query = get(runnableBridge.query(id))
            // Keep if data exists or still loading
            const keep = !!query.data || query.isPending
            return {id, keep}
        })
    }),
    (entries) => entries.filter((e) => e.keep).map((e) => e.id),
    isEqual,
)

/**
 * Strictly resolved entity IDs for render paths that require fully loaded
 * entity details.
 *
 * An entity ID is kept only when:
 * 1. It's a local draft ID
 * 2. Its `runnableBridge.query(id)` has resolved data
 *
 * Placeholder IDs and pending entities are intentionally excluded so UI can
 * remain in loading state until details are available.
 */
export const resolvedEntityIdsAtom = selectAtom(
    atom((get) => {
        const selected = get(entityIdsAtom)
        return selected.map((id) => {
            if (isPlaceholderId(id)) return {id, keep: false}
            if (isLocalDraftId(id)) return {id, keep: true}
            const query = get(runnableBridge.query(id))
            const keep = !!query.data
            return {id, keep}
        })
    }),
    (entries) => entries.filter((e) => e.keep).map((e) => e.id),
    isEqual,
)

// ============================================================================
// COMPARISON VIEW (validated)
// ============================================================================

/**
 * Whether the playground is in comparison mode.
 * Uses validated entity IDs (filtered against revisions) to ensure
 * comparison mode exits when stale IDs are filtered out.
 */
export const isComparisonViewAtom = selectAtom(
    displayedEntityIdsAtom,
    (ids) => ids.length > 1,
    (a, b) => a === b,
)

// ============================================================================
// LAYOUT COMPOSITE
// ============================================================================

/**
 * Single derived atom for all layout state.
 * Prevents usePlaygroundLayout from subscribing to multiple atoms.
 */
export const playgroundLayoutAtom = selectAtom(
    atom((get) => ({
        displayedEntityIds: get(displayedEntityIdsAtom),
        selectedEntities: get(entityIdsAtom),
    })),
    (state) => ({
        displayedEntities: state.displayedEntityIds,
        selectedEntities: state.selectedEntities,
        isComparisonView: state.selectedEntities?.length > 1,
        entityCount: state.displayedEntityIds.length,
    }),
    isEqual,
)

// ============================================================================
// SCHEMA INPUT KEYS
// ============================================================================

/**
 * Input keys directly derived from the runnable's request payload.
 * Uses the primary entity's pre-built payload which includes variables
 * extracted from the OpenAPI schema and prompt templates.
 */
export const schemaInputKeysAtom = selectAtom(
    atom((get) => {
        const rootNode = get(playgroundNodesAtom).find((n) => n.depth === 0)
        if (!rootNode) return [] as string[]

        const payload = get(
            runnableBridge.requestPayload(rootNode.entityId),
        ) as RequestPayloadData | null
        return payload?.variables || ([] as string[])
    }),
    (keys) => keys,
    isEqual,
)
