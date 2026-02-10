/**
 * Runnable Snapshot Adapter
 *
 * Provides a unified interface for snapshot operations across different runnable types.
 * This enables `agenta-playground` to create and hydrate snapshots without knowing
 * the specific entity implementation details.
 *
 * ## Architecture
 *
 * - **RunnableSnapshotAdapter**: Interface that each runnable type must implement
 * - **snapshotAdapterRegistry**: Registry for looking up adapters by runnable type
 * - Entity modules (legacyAppRevision, appRevision, evaluatorRevision) provide their own adapters
 *
 * ## Usage
 *
 * ```typescript
 * import { snapshotAdapterRegistry } from '@agenta/entities/runnable'
 *
 * // Get adapter for a runnable type
 * const adapter = snapshotAdapterRegistry.get('legacyAppRevision')
 * if (adapter) {
 *     const patch = adapter.buildDraftPatch(revisionId)
 *     adapter.applyDraftPatch(revisionId, patch)
 * }
 *
 * // Or use the helper that throws if adapter is missing
 * const adapter = snapshotAdapterRegistry.getOrThrow('legacyAppRevision')
 * ```
 */

import type {RunnableType} from "./types"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Generic draft patch structure.
 * Each entity can have its own patch shape, but all must be JSON-serializable.
 */
export type RunnableDraftPatch = Record<string, unknown>

/**
 * Result of building a draft patch
 */
export interface BuildDraftPatchResult {
    /** Whether the revision has draft changes */
    hasDraft: boolean
    /** The patch data (null if no draft) */
    patch: RunnableDraftPatch | null
    /** Source revision ID (for local drafts, this is the base revision) */
    sourceRevisionId: string
}

/**
 * Interface that each runnable type must implement for snapshot support.
 *
 * This abstraction allows `agenta-playground` to work with any runnable type
 * without importing entity-specific modules.
 */
export interface RunnableSnapshotAdapter {
    /**
     * The runnable type this adapter handles
     */
    readonly type: RunnableType

    /**
     * Build a draft patch from the current state of a revision.
     *
     * Compares draft state with server data and returns the patch if there are changes.
     * Returns null patch if no draft exists or draft matches server data.
     *
     * @param revisionId - The revision ID to build a patch for
     * @returns BuildDraftPatchResult with patch data or null
     */
    buildDraftPatch(revisionId: string): BuildDraftPatchResult

    /**
     * Apply a draft patch to a revision, creating or updating its draft state.
     *
     * @param revisionId - The revision ID to apply the patch to
     * @param patch - The patch to apply
     * @returns true if patch was applied successfully, false if server data not available
     */
    applyDraftPatch(revisionId: string, patch: RunnableDraftPatch): boolean

    /**
     * Get the current draft for a revision (if any).
     *
     * @param revisionId - The revision ID to check
     * @returns The draft data or null if no draft exists
     */
    getDraft(revisionId: string): unknown | null

    /**
     * Check if an ID represents a local draft (not yet committed).
     *
     * Local drafts have special ID formats (e.g., "local-abc123-timestamp").
     *
     * @param id - The ID to check
     * @returns true if this is a local draft ID
     */
    isLocalDraftId(id: string): boolean

    /**
     * Extract the source revision ID from a local draft ID.
     *
     * For example, "local-abc123-timestamp" → "abc123"
     *
     * @param draftId - The local draft ID
     * @returns The source revision ID, or null if extraction fails
     */
    extractSourceId(draftId: string): string | null

    /**
     * Create a new local draft from a source revision with a patch applied.
     *
     * This is used during hydration to recreate local drafts from URL snapshots.
     * Unlike applyDraftPatch (which modifies an existing revision's draft),
     * this creates a brand new local draft ID.
     *
     * @param sourceRevisionId - The source revision ID to clone from
     * @param patch - The patch to apply to the new local draft
     * @returns The new local draft ID, or null if creation failed
     */
    createLocalDraftWithPatch?(sourceRevisionId: string, patch: RunnableDraftPatch): string | null
}

// ============================================================================
// REGISTRY
// ============================================================================

/**
 * Registry for runnable snapshot adapters.
 *
 * Entity modules register their adapters here, and `agenta-playground`
 * looks them up by runnable type.
 */
class SnapshotAdapterRegistry {
    private adapters = new Map<RunnableType, RunnableSnapshotAdapter>()

    /**
     * Register an adapter for a runnable type.
     *
     * @param adapter - The adapter to register
     */
    register(adapter: RunnableSnapshotAdapter): void {
        this.adapters.set(adapter.type, adapter)
    }

    /**
     * Get an adapter by runnable type.
     *
     * @param type - The runnable type
     * @returns The adapter, or undefined if not registered
     */
    get(type: RunnableType): RunnableSnapshotAdapter | undefined {
        return this.adapters.get(type)
    }

    /**
     * Get an adapter by runnable type, throwing if not found.
     *
     * @param type - The runnable type
     * @returns The adapter
     * @throws Error if adapter is not registered
     */
    getOrThrow(type: RunnableType): RunnableSnapshotAdapter {
        const adapter = this.adapters.get(type)
        if (!adapter) {
            throw new Error(
                `[SnapshotAdapterRegistry] No adapter registered for runnable type: ${type}`,
            )
        }
        return adapter
    }

    /**
     * Check if an adapter is registered for a runnable type.
     *
     * @param type - The runnable type
     * @returns true if an adapter is registered
     */
    has(type: RunnableType): boolean {
        return this.adapters.has(type)
    }

    /**
     * Get all registered runnable types.
     *
     * @returns Array of registered runnable types
     */
    getRegisteredTypes(): RunnableType[] {
        return Array.from(this.adapters.keys())
    }
}

/**
 * Global snapshot adapter registry.
 *
 * Entity modules register their adapters at import time.
 * `agenta-playground` uses this to look up adapters by runnable type.
 */
export const snapshotAdapterRegistry = new SnapshotAdapterRegistry()
