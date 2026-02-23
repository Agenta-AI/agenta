/**
 * URL Snapshot Controller
 *
 * Provides a package-level API for building and encoding URL snapshots from
 * playground selection state. This controller abstracts away entity-specific
 * logic by using the RunnableTypeResolver interface.
 *
 * ## Usage
 *
 * ```typescript
 * import { urlSnapshotController, setRunnableTypeResolver } from '@agenta/playground'
 * import { useSetAtom, useAtomValue } from 'jotai'
 *
 * // OSS registers its resolver at app init
 * setRunnableTypeResolver({
 *     getType: (revisionId) => 'legacyAppRevision'
 * })
 *
 * // Build encoded snapshot from selection
 * const buildSnapshot = useSetAtom(urlSnapshotController.actions.buildEncodedSnapshot)
 * const result = buildSnapshot(['rev-123', 'rev-456'])
 * // result.encoded contains the URL-safe snapshot string
 * ```
 */

import {snapshotAdapterRegistry} from "@agenta/entities/runnable"
import {atom} from "jotai"

import {parseSnapshot, type SnapshotLoadableConnection} from "../../snapshot"
import type {RunnableType} from "../types"

import {
    playgroundSnapshotController,
    pendingHydrationsAtom,
    applyPendingHydrationsForRevision,
    type SnapshotSelectionInput,
    type HydratedSnapshotEntity,
    type CreateSnapshotResult,
    type HydrateSnapshotResult,
} from "./playgroundSnapshotController"

// ============================================================================
// RUNNABLE TYPE RESOLVER
// ============================================================================

/**
 * Interface for resolving runnable types from entity IDs.
 *
 * OSS/EE layers implement this interface to provide entity-specific
 * type resolution without leaking entity logic into the package.
 */
export interface RunnableTypeResolver {
    /**
     * Get the runnable type for a given revision ID.
     *
     * @param revisionId - The revision ID to resolve
     * @returns The runnable type (e.g., 'legacyAppRevision', 'appRevision')
     */
    getType(revisionId: string): RunnableType
}

/**
 * Default resolver that returns 'legacyAppRevision' for all IDs.
 * This is a fallback - OSS should register its own resolver.
 */
const defaultResolver: RunnableTypeResolver = {
    getType: () => "legacyAppRevision" as RunnableType,
}

/**
 * Current resolver instance.
 */
let currentResolver: RunnableTypeResolver = defaultResolver

/**
 * Set the runnable type resolver.
 *
 * Call this at app initialization to register the OSS/EE resolver.
 *
 * @param resolver - The resolver implementation
 */
export function setRunnableTypeResolver(resolver: RunnableTypeResolver): void {
    currentResolver = resolver
}

/**
 * Get the current runnable type resolver.
 */
export function getRunnableTypeResolver(): RunnableTypeResolver {
    return currentResolver
}

/**
 * Reset to default resolver (for testing).
 */
export function resetRunnableTypeResolver(): void {
    currentResolver = defaultResolver
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of building an encoded snapshot.
 */
export interface BuildEncodedSnapshotResult {
    /** Whether the operation succeeded */
    ok: boolean
    /** The encoded snapshot string (URL-safe) */
    encoded?: string
    /** Whether the snapshot has draft changes (needs to be in URL hash) */
    hasDrafts: boolean
    /** Entity IDs represented in the snapshot input */
    entityIds: string[]
    /** @deprecated Use `entityIds` */
    selectionIds?: string[]
    /** Error message if failed */
    error?: string
    /** Warning if snapshot is large */
    warning?: boolean
    /** Encoded length in bytes */
    length?: number
}

type SnapshotBuildInput = string[] | SnapshotSelectionInput[]

function normalizeSnapshotSelectionInput(input: SnapshotBuildInput): SnapshotSelectionInput[] {
    if (input.length === 0) return []

    const first = input[0]
    if (typeof first === "string") {
        return (input as string[]).map((id) => ({
            id,
            runnableType: currentResolver.getType(id),
        }))
    }

    return input as SnapshotSelectionInput[]
}

// ============================================================================
// ACTIONS
// ============================================================================

/**
 * Build an encoded snapshot from entity IDs or typed entity descriptors.
 *
 * This action:
 * 1. Resolves runnable types when only IDs are provided
 * 2. Delegates to playgroundSnapshotController.createSnapshot
 * 3. Returns the encoded result with metadata
 *
 * @param input - Entity IDs or typed entity descriptors to include in the snapshot
 * @returns BuildEncodedSnapshotResult with encoded string and metadata
 */
const buildEncodedSnapshotAtom = atom(
    null,
    (_get, set, input: SnapshotBuildInput): BuildEncodedSnapshotResult => {
        const selectionInputs = normalizeSnapshotSelectionInput(input)
        const entityIds = selectionInputs.map((item) => item.id)

        if (selectionInputs.length === 0) {
            return {
                ok: true,
                hasDrafts: false,
                entityIds: [],
                selectionIds: [],
            }
        }

        try {
            // Delegate to playgroundSnapshotController
            const result: CreateSnapshotResult = set(
                playgroundSnapshotController.actions.createSnapshot,
                selectionInputs,
            )

            if (!result.ok) {
                return {
                    ok: false,
                    hasDrafts: false,
                    entityIds,
                    selectionIds: entityIds,
                    error: result.error,
                }
            }

            // Check if snapshot has drafts, ephemeral entities, or a testset connection
            const hasDrafts = (result.snapshot?.drafts?.length ?? 0) > 0
            const hasEphemeralEntities = result.snapshot?.selection?.some(
                (item) => item.kind === "ephemeral",
            )
            const hasLoadable = Boolean(result.snapshot?.loadable)

            return {
                ok: true,
                encoded: result.encoded,
                hasDrafts: hasDrafts || !!hasEphemeralEntities || hasLoadable,
                entityIds,
                selectionIds: entityIds,
                warning: result.warning,
                length: result.length,
            }
        } catch (err) {
            return {
                ok: false,
                hasDrafts: false,
                entityIds,
                selectionIds: entityIds,
                error: `Failed to build snapshot: ${err instanceof Error ? err.message : String(err)}`,
            }
        }
    },
)

/**
 * Build URL components from entity IDs or typed entity descriptors.
 *
 * Returns the query param value and optional hash value for URL construction.
 * OSS URL adapter uses this to write the URL.
 */
export interface UrlComponents {
    /** Query param value (comma-separated root entity IDs) */
    queryParam: string | null
    /** Hash value (encoded snapshot with drafts) */
    hashParam: string | null
    /** Whether the operation succeeded */
    ok: boolean
    /** Error message if failed */
    error?: string
}

const buildUrlComponentsAtom = atom(null, (_get, set, input: SnapshotBuildInput): UrlComponents => {
    const selectionInputs = normalizeSnapshotSelectionInput(input)

    if (selectionInputs.length === 0) {
        return {
            queryParam: null,
            hashParam: null,
            ok: true,
        }
    }

    const result = set(buildEncodedSnapshotAtom, selectionInputs)

    if (!result.ok) {
        return {
            queryParam: null,
            hashParam: null,
            ok: false,
            error: result.error,
        }
    }

    // Resolve local draft IDs to their source revision IDs for the query param.
    // Local draft IDs are ephemeral (in-memory only) and won't work when opened in a new tab.
    // The hash param contains the patch data needed to reconstruct the draft state.
    const rootSelectionInputs = selectionInputs.filter((item) => (item.depth ?? 0) === 0)
    const querySelectionInputs =
        rootSelectionInputs.length > 0 ? rootSelectionInputs : selectionInputs

    const resolvedIds = querySelectionInputs.map(({id, runnableType}) => {
        const adapter = snapshotAdapterRegistry.get(runnableType)

        if (adapter && adapter.isLocalDraftId(id)) {
            const sourceId = adapter.extractSourceId(id)
            return sourceId ?? id // Fallback to original if extraction fails
        }

        return id
    })

    const hasNonRootEntities = selectionInputs.some((item) => (item.depth ?? 0) > 0)
    const hasEntityMetadata = selectionInputs.some(
        (item) => typeof item.depth === "number" || typeof item.entityType === "string",
    )
    const hasResolverTypeMismatch = selectionInputs.some(
        (item) => item.runnableType !== currentResolver.getType(item.id),
    )
    const requiresSnapshotHash =
        result.hasDrafts || hasNonRootEntities || hasEntityMetadata || hasResolverTypeMismatch

    return {
        queryParam: resolvedIds.join(","),
        hashParam: requiresSnapshotHash && result.encoded ? result.encoded : null,
        ok: true,
    }
})

// ============================================================================
// HYDRATION SELECTORS
// ============================================================================

/**
 * Selector that returns true when all pending hydrations have been applied.
 * Now properly reactive - reads from pendingHydrationsAtom so it re-evaluates
 * whenever the map changes.
 */
const hydrationCompleteAtom = atom((get) => get(pendingHydrationsAtom).size === 0)

/**
 * Selector that returns the current count of pending hydrations.
 * Now properly reactive via pendingHydrationsAtom dependency.
 */
const pendingHydrationCountAtom = atom((get) => get(pendingHydrationsAtom).size)

// ============================================================================
// HYDRATION ACTIONS
// ============================================================================

/**
 * Result of hydrateFromUrl action.
 */
export interface HydrateFromUrlResult {
    /** Whether the operation succeeded */
    ok: boolean
    /** The new selection (entity IDs to select) */
    selection?: string[]
    /** Hydrated entities with runnable type and optional graph metadata */
    entities?: HydratedSnapshotEntity[]
    /** Whether there are pending hydrations (drafts to apply) */
    hasPendingHydrations: boolean
    /** Error message if failed */
    error?: string
    /** Testset connection to restore after playground nodes are set up */
    loadable?: SnapshotLoadableConnection
}

/**
 * Hydrate playground state from an encoded URL snapshot string.
 *
 * This action:
 * 1. Parses the encoded snapshot
 * 2. Delegates to playgroundSnapshotController.hydrateSnapshot
 * 3. Returns the new selection and pending hydration status
 *
 * @param encodedSnapshot - The URL-encoded snapshot string
 * @returns HydrateFromUrlResult with selection and status
 */
const hydrateFromUrlAtom = atom(null, (get, set, encodedSnapshot: string): HydrateFromUrlResult => {
    try {
        // Parse the encoded snapshot
        const parseResult = parseSnapshot(encodedSnapshot)

        if (!parseResult.ok || !parseResult.value) {
            return {
                ok: false,
                hasPendingHydrations: false,
                error: parseResult.error ?? "Failed to parse snapshot",
            }
        }

        // Delegate to playgroundSnapshotController
        const hydrateResult: HydrateSnapshotResult = set(
            playgroundSnapshotController.actions.hydrateSnapshot,
            parseResult.value,
        )

        if (!hydrateResult.ok) {
            return {
                ok: false,
                hasPendingHydrations: false,
                error: hydrateResult.error,
            }
        }

        return {
            ok: true,
            selection: hydrateResult.selection,
            entities: hydrateResult.entities,
            hasPendingHydrations: get(pendingHydrationsAtom).size > 0,
            loadable: hydrateResult.loadable,
        }
    } catch (err) {
        return {
            ok: false,
            hasPendingHydrations: false,
            error: `Failed to hydrate from URL: ${err instanceof Error ? err.message : String(err)}`,
        }
    }
})

/**
 * Apply pending hydrations for a list of entity IDs.
 *
 * Call this when revision data becomes available for selected revisions.
 * Returns the total number of patches applied.
 *
 * @param entityIds - Array of entity IDs to apply pending hydrations for
 * @returns Number of patches successfully applied
 */
const applyPendingHydrationsAtom = atom(null, (_get, _set, entityIds: string[]): number => {
    let totalApplied = 0

    for (const entityId of entityIds) {
        const applied = applyPendingHydrationsForRevision(entityId)
        totalApplied += applied
    }

    return totalApplied
})

// ============================================================================
// CONTROLLER EXPORT
// ============================================================================

export const urlSnapshotController = {
    /**
     * Selectors for URL snapshot state.
     */
    selectors: {
        /**
         * Returns true when all pending hydrations have been applied.
         * Subscribe to this to know when to clear the URL hash.
         */
        hydrationComplete: hydrationCompleteAtom,

        /**
         * Returns the current count of pending hydrations.
         * Useful for debugging and progress tracking.
         */
        pendingHydrationCount: pendingHydrationCountAtom,
    },

    /**
     * Actions for URL snapshot operations.
     */
    actions: {
        /**
         * Build an encoded snapshot from entity IDs.
         * Returns encoded string and metadata.
         */
        buildEncodedSnapshot: buildEncodedSnapshotAtom,

        /**
         * Build URL components (query + hash) from entity IDs.
         * Convenience wrapper for URL adapter.
         */
        buildUrlComponents: buildUrlComponentsAtom,

        /**
         * Hydrate playground state from an encoded URL snapshot string.
         * Parses, validates, and queues patches for application.
         */
        hydrateFromUrl: hydrateFromUrlAtom,

        /**
         * Apply pending hydrations for a list of entity IDs.
         * Call when revision data becomes available.
         */
        applyPendingHydrations: applyPendingHydrationsAtom,
    },
}
