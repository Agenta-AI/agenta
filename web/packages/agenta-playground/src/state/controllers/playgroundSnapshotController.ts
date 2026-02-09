/**
 * Playground Snapshot Controller
 *
 * Provides compound actions for creating and hydrating playground snapshots.
 * This controller encapsulates the business logic for URL snapshot sharing.
 *
 * ## Usage
 *
 * ```typescript
 * import { playgroundSnapshotController } from '@agenta/playground'
 *
 * // Create a snapshot from current selection
 * const createSnapshot = useSetAtom(playgroundSnapshotController.actions.createSnapshot)
 * const result = createSnapshot(['rev-123', 'local-abc-456'])
 *
 * // Hydrate a snapshot (restore state from URL)
 * const hydrateSnapshot = useSetAtom(playgroundSnapshotController.actions.hydrateSnapshot)
 * const selection = hydrateSnapshot(decodedSnapshot)
 * ```
 */

import {legacyAppRevisionSnapshotAdapter} from "@agenta/entities/legacyAppRevision"
import {
    snapshotAdapterRegistry,
    type RunnableDraftPatch,
    type RunnableType,
} from "@agenta/entities/runnable"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {v4 as uuidv4} from "uuid"

import {
    encodeSnapshot,
    type PlaygroundSnapshot,
    type SelectionItem,
    type SnapshotDraftEntry,
    type EncodeResult,
    SNAPSHOT_VERSION,
} from "../../snapshot"

// Explicitly register the legacyAppRevision adapter
// Side-effect imports don't work reliably across package boundaries
snapshotAdapterRegistry.register(legacyAppRevisionSnapshotAdapter)

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for creating a snapshot - includes runnable type per revision.
 */
export interface SnapshotSelectionInput {
    /** Revision ID */
    id: string
    /** Runnable type for this revision */
    runnableType: RunnableType
}

/**
 * Result of creating a snapshot.
 */
export interface CreateSnapshotResult {
    /** Whether the snapshot was created successfully */
    ok: boolean
    /** The snapshot object (before encoding) */
    snapshot?: PlaygroundSnapshot
    /** The encoded snapshot string (URL-safe) */
    encoded?: string
    /** Error message if creation failed */
    error?: string
    /** Warning if snapshot is large */
    warning?: boolean
    /** Encoded length in bytes */
    length?: number
    /** Warnings about adapter issues during creation */
    warnings?: string[]
}

/**
 * Result of hydrating a snapshot.
 */
export interface HydrateSnapshotResult {
    /** Whether hydration was successful */
    ok: boolean
    /** The new selection (revision IDs to select) */
    selection?: string[]
    /** Mapping from draftKey to source revision ID (used for patch application) */
    draftKeyToSourceRevisionId?: Record<string, string>
    /** Error message if hydration failed */
    error?: string
    /** Warnings for partial failures */
    warnings?: string[]
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a unique draft key for snapshot serialization.
 * Uses UUID v4 for guaranteed uniqueness.
 */
function generateDraftKey(): string {
    return `dk-${uuidv4()}`
}

// ============================================================================
// CREATE SNAPSHOT ACTION
// ============================================================================

/**
 * Create a snapshot from the current playground selection.
 *
 * This compound action:
 * 1. Iterates through selected revision IDs with their runnable types
 * 2. For each revision, uses the appropriate adapter to check for draft changes
 * 3. Builds patches for drafts, creates commit references for clean revisions
 * 4. Encodes the snapshot for URL sharing
 *
 * @param selection - Array of revision inputs with IDs and runnable types
 * @returns CreateSnapshotResult with encoded snapshot or error
 */
const createSnapshotAtom = atom(
    null,
    (_get, _set, selection: SnapshotSelectionInput[]): CreateSnapshotResult => {
        try {
            const snapshotSelection: SelectionItem[] = []
            const drafts: SnapshotDraftEntry[] = []
            const warnings: string[] = []

            for (const {id: revisionId, runnableType} of selection) {
                // Get adapter for this runnable type
                const adapter = snapshotAdapterRegistry.get(runnableType)

                if (!adapter) {
                    warnings.push(`No adapter for runnable type: ${runnableType}`)
                    // Fall back to commit without draft check
                    snapshotSelection.push({kind: "commit", id: revisionId, runnableType})
                    continue
                }

                // Check if this is a local draft
                const isLocalDraft = adapter.isLocalDraftId(revisionId)

                if (isLocalDraft) {
                    // Local draft - need to extract source and build patch
                    const sourceId = adapter.extractSourceId(revisionId)

                    if (!sourceId) {
                        // Can't determine source - skip with warning
                        warnings.push(`Cannot extract source ID from local draft: ${revisionId}`)
                        continue
                    }

                    // Build patch from the local draft's current state
                    const patchResult = adapter.buildDraftPatch(revisionId)

                    // IMPORTANT: Local drafts should ALWAYS be included as drafts in the snapshot,
                    // even if they have no actual changes yet. This is because local drafts are
                    // separate entities that need to be recreated on page reload.
                    // Without this, clicking "Compare" and reloading would lose the comparison.
                    const draftKey = generateDraftKey()

                    if (patchResult.hasDraft && patchResult.patch) {
                        // Has draft changes - include patch
                        drafts.push({
                            draftKey,
                            sourceRevisionId: sourceId,
                            runnableType,
                            patch: patchResult.patch,
                        })
                    } else {
                        // No draft changes - include empty patch to indicate "create local copy"
                        // The empty parameters object means "use source parameters as-is"
                        drafts.push({
                            draftKey,
                            sourceRevisionId: sourceId,
                            runnableType,
                            patch: {parameters: {}},
                        })
                    }

                    snapshotSelection.push({kind: "draft", draftKey, runnableType})
                } else {
                    // Check if committed revision has draft changes
                    const patchResult = adapter.buildDraftPatch(revisionId)

                    if (patchResult.hasDraft && patchResult.patch) {
                        // Has draft changes - include as draft
                        const draftKey = generateDraftKey()
                        drafts.push({
                            draftKey,
                            sourceRevisionId: revisionId,
                            runnableType,
                            patch: patchResult.patch,
                        })
                        snapshotSelection.push({kind: "draft", draftKey, runnableType})
                    } else {
                        // No draft changes - include as commit
                        snapshotSelection.push({kind: "commit", id: revisionId, runnableType})
                    }
                }
            }

            // Build snapshot
            const snapshot: PlaygroundSnapshot = {
                v: SNAPSHOT_VERSION,
                selection: snapshotSelection,
                drafts,
            }

            // Encode
            const encodeResult: EncodeResult = encodeSnapshot(snapshot)

            if (!encodeResult.ok) {
                return {
                    ok: false,
                    error: encodeResult.error,
                }
            }

            return {
                ok: true,
                snapshot,
                encoded: encodeResult.encoded,
                warning: encodeResult.warning,
                length: encodeResult.length,
                warnings: warnings.length > 0 ? warnings : undefined,
            }
        } catch (err) {
            return {
                ok: false,
                error: `Failed to create snapshot: ${err instanceof Error ? err.message : String(err)}`,
            }
        }
    },
)

// ============================================================================
// HYDRATE SNAPSHOT ACTION
// ============================================================================

/**
 * Pending hydration data - stored when we need to wait for revision data to load.
 */
interface PendingHydration {
    /** The draftKey from the snapshot (unique per draft entry) */
    draftKey: string
    /** The source revision ID to apply the patch to */
    sourceRevisionId: string
    /** The runnable type (determines which adapter applies the patch) */
    runnableType: RunnableType
    /** The patch to apply */
    patch: RunnableDraftPatch
    /** Whether this hydration should create a new local draft (for compare mode support) */
    createLocalDraft: boolean
    /** Index in the selection array where this draft should be placed */
    selectionIndex: number
    /** Placeholder ID used in selection (for compare mode to avoid deduplication) */
    placeholderId?: string
}

/**
 * Generate a unique placeholder ID for pending hydrations.
 * This prevents deduplication when the same source revision appears multiple times.
 */
function generatePlaceholderId(draftKey: string): string {
    return `__pending_hydration__${draftKey}`
}

/**
 * Check if an ID is a placeholder ID.
 */
export function isPlaceholderId(id: string): boolean {
    return id.startsWith("__pending_hydration__")
}

/**
 * Jotai atom holding the map of draftKey to pending hydration patches.
 * Keyed by draftKey (not sourceRevisionId) to support multiple drafts from the same source.
 * When the revision data loads, we apply the patch via applyPendingHydration.
 *
 * This is an atom (not a plain Map) so that derived atoms like hydrationCompleteAtom
 * can reactively track changes.
 */
export const pendingHydrationsAtom = atom(new Map<string, PendingHydration>())

// Imperative helpers for reading/writing the atom from plain functions
function getPendingHydrations(): Map<string, PendingHydration> {
    return getDefaultStore().get(pendingHydrationsAtom)
}

function setPendingHydrations(next: Map<string, PendingHydration>): void {
    getDefaultStore().set(pendingHydrationsAtom, next)
}

function deletePendingHydration(draftKey: string): void {
    const current = getPendingHydrations()
    if (!current.has(draftKey)) return
    const next = new Map(current)
    next.delete(draftKey)
    setPendingHydrations(next)
}

/**
 * @deprecated Use pendingHydrationsAtom instead. This getter exists for backward compatibility.
 */
export const pendingHydrations = {
    get size() {
        return getPendingHydrations().size
    },
    get(key: string) {
        return getPendingHydrations().get(key)
    },
    has(key: string) {
        return getPendingHydrations().has(key)
    },
    entries() {
        return getPendingHydrations().entries()
    },
    [Symbol.iterator]() {
        return getPendingHydrations()[Symbol.iterator]()
    },
}

/**
 * Callback to update selection when a local draft is created from pending hydration.
 * Set by the OSS layer to integrate with playground selection state.
 */
let selectionUpdateCallback:
    | ((sourceId: string, localDraftId: string, index: number) => void)
    | null = null

/**
 * Register a callback to update selection when pending hydrations create local drafts.
 * Call this from the OSS layer to integrate with playground selection state.
 */
export function setSelectionUpdateCallback(
    callback: ((sourceId: string, localDraftId: string, index: number) => void) | null,
): void {
    selectionUpdateCallback = callback
}

/**
 * Hydrate a snapshot, restoring playground state from URL.
 *
 * This compound action:
 * 1. Iterates through snapshot selection items
 * 2. For commit items, adds the revision ID directly to selection
 * 3. For draft items, adds the source revision ID to selection and queues the patch
 * 4. Returns the new selection array (source revision IDs for drafts)
 *
 * The patches are applied later when the revision data loads, via applyPendingHydration.
 *
 * @param snapshot - The decoded and validated snapshot (v2)
 * @returns HydrateSnapshotResult with new selection or error
 */
const hydrateSnapshotAtom = atom(
    null,
    (_get, set, snapshot: PlaygroundSnapshot): HydrateSnapshotResult => {
        try {
            const newSelection: string[] = []
            const draftKeyToSourceRevisionId: Record<string, string> = {}
            const warnings: string[] = []

            // Start with a fresh pending hydrations map
            const nextPending = new Map<string, PendingHydration>()

            // Build a map of draftKey -> draft entry for quick lookup
            const draftMap = new Map<string, SnapshotDraftEntry>()
            for (const draft of snapshot.drafts) {
                draftMap.set(draft.draftKey, draft)
            }

            // PASS 1: Count how many times each source revision ID appears in the selection
            // This is needed to determine which drafts need separate local drafts
            const sourceIdCounts = new Map<string, number>()
            for (const item of snapshot.selection) {
                if (item.kind === "commit") {
                    const count = sourceIdCounts.get(item.id) || 0
                    sourceIdCounts.set(item.id, count + 1)
                } else if (item.kind === "draft") {
                    const draftEntry = draftMap.get(item.draftKey)
                    if (draftEntry) {
                        const count = sourceIdCounts.get(draftEntry.sourceRevisionId) || 0
                        sourceIdCounts.set(draftEntry.sourceRevisionId, count + 1)
                    }
                }
            }

            // Track which source IDs we've already processed (for determining needsLocalDraft)
            const processedSourceIds = new Set<string>()

            // PASS 2: Process each selection item
            for (const item of snapshot.selection) {
                if (item.kind === "commit") {
                    // Commit - add directly to selection
                    newSelection.push(item.id)
                    processedSourceIds.add(item.id)
                } else if (item.kind === "draft") {
                    // Draft - need to create a new local draft with the patch applied
                    const draftEntry = draftMap.get(item.draftKey)

                    if (!draftEntry) {
                        warnings.push(`Draft key "${item.draftKey}" not found`)
                        continue
                    }

                    // Get adapter for this runnable type
                    const adapter = snapshotAdapterRegistry.get(draftEntry.runnableType)

                    if (!adapter) {
                        warnings.push(`No adapter for runnable type: ${draftEntry.runnableType}`)
                        // Fall back to source revision
                        newSelection.push(draftEntry.sourceRevisionId)
                        processedSourceIds.add(draftEntry.sourceRevisionId)
                        continue
                    }

                    // Check if we need to create a separate local draft.
                    // This is needed when:
                    // 1. The source revision ID appears more than once in the selection, AND
                    // 2. We've already processed this source ID (so this is the 2nd+ occurrence)
                    const sourceIdCount = sourceIdCounts.get(draftEntry.sourceRevisionId) || 0
                    const alreadyProcessed = processedSourceIds.has(draftEntry.sourceRevisionId)
                    const needsLocalDraft = sourceIdCount > 1 && alreadyProcessed

                    // Mark this source ID as processed
                    processedSourceIds.add(draftEntry.sourceRevisionId)

                    if (needsLocalDraft) {
                        // Try to create a local draft with the patch immediately
                        // This requires the source revision data to be available
                        if (adapter.createLocalDraftWithPatch) {
                            const localDraftId = adapter.createLocalDraftWithPatch(
                                draftEntry.sourceRevisionId,
                                draftEntry.patch,
                            )

                            if (localDraftId) {
                                // Successfully created local draft - add to selection
                                newSelection.push(localDraftId)
                                draftKeyToSourceRevisionId[item.draftKey] =
                                    draftEntry.sourceRevisionId
                                continue
                            }
                        }

                        // If immediate creation failed (source data not loaded yet),
                        // use a placeholder ID to avoid deduplication
                        // The placeholder will be replaced with the actual local draft ID later
                        const placeholderId = generatePlaceholderId(item.draftKey)
                        const selectionIndex = newSelection.length
                        newSelection.push(placeholderId)

                        // Queue the patch to be applied when revision data loads
                        // Mark this as needing to create a local draft
                        nextPending.set(item.draftKey, {
                            draftKey: item.draftKey,
                            sourceRevisionId: draftEntry.sourceRevisionId,
                            runnableType: draftEntry.runnableType,
                            patch: draftEntry.patch,
                            createLocalDraft: true,
                            selectionIndex,
                            placeholderId,
                        })
                    } else {
                        // Single draft or first occurrence - just apply patch to source revision
                        // Add source revision to selection
                        const selectionIndex = newSelection.length
                        newSelection.push(draftEntry.sourceRevisionId)

                        // Queue the patch to be applied when revision data loads
                        // Don't create a local draft - just apply the patch to the source
                        nextPending.set(item.draftKey, {
                            draftKey: item.draftKey,
                            sourceRevisionId: draftEntry.sourceRevisionId,
                            runnableType: draftEntry.runnableType,
                            patch: draftEntry.patch,
                            createLocalDraft: false,
                            selectionIndex,
                        })
                    }

                    // Track mapping for reference
                    draftKeyToSourceRevisionId[item.draftKey] = draftEntry.sourceRevisionId
                }
            }

            // Commit the new pending hydrations map atomically
            set(pendingHydrationsAtom, nextPending)

            return {
                ok: true,
                selection: newSelection,
                draftKeyToSourceRevisionId,
                warnings: warnings.length > 0 ? warnings : undefined,
            }
        } catch (err) {
            console.error("[Snapshot Controller] Hydration error:", err)
            return {
                ok: false,
                error: `Failed to hydrate snapshot: ${err instanceof Error ? err.message : String(err)}`,
            }
        }
    },
)

/**
 * Apply pending hydration patch for a specific draft key.
 * Call this when revision data becomes available.
 *
 * IMPORTANT: If a draft already exists for this revision, we skip applying the patch.
 * This prevents overwriting newer edits made after the initial hydration.
 *
 * @param draftKey - The draft key to check for pending hydration
 * @returns true if a patch was applied or skipped (done), false if not found or failed
 */
export function applyPendingHydration(draftKey: string): boolean {
    const currentPending = getPendingHydrations()
    const pending = currentPending.get(draftKey)
    if (!pending) {
        return false
    }

    const {sourceRevisionId, runnableType, patch, createLocalDraft, selectionIndex, placeholderId} =
        pending

    if (process.env.NODE_ENV !== "production") {
        console.log("[Hydration] applyPendingHydration", {
            draftKey,
            sourceRevisionId,
            createLocalDraft,
            selectionIndex,
            placeholderId,
        })
    }

    // Get adapter for this runnable type
    const adapter = snapshotAdapterRegistry.get(runnableType)
    if (!adapter) {
        console.warn(`[Snapshot Controller] No adapter for runnable type: ${runnableType}`)
        deletePendingHydration(draftKey)
        return false
    }

    // If this hydration should create a new local draft (for compare mode support)
    if (createLocalDraft && adapter.createLocalDraftWithPatch) {
        const localDraftId = adapter.createLocalDraftWithPatch(sourceRevisionId, patch)

        if (process.env.NODE_ENV !== "production") {
            console.log("[Hydration] createLocalDraftWithPatch result", {
                draftKey,
                sourceRevisionId,
                localDraftId,
                hasCallback: !!selectionUpdateCallback,
            })
        }

        if (localDraftId) {
            // Successfully created local draft - update selection via callback
            // Use placeholderId if available (for compare mode), otherwise use sourceRevisionId
            if (selectionUpdateCallback) {
                const idToReplace = placeholderId ?? sourceRevisionId
                selectionUpdateCallback(idToReplace, localDraftId, selectionIndex)
            }
            deletePendingHydration(draftKey)
            return true
        }

        // Creation failed - source data not ready yet, keep pending for retry
        if (process.env.NODE_ENV !== "production") {
            console.warn("[Hydration] createLocalDraftWithPatch returned null - source not ready", {
                draftKey,
                sourceRevisionId,
            })
        }
        return false
    }

    // Check if a draft already exists - if so, don't overwrite it
    // This handles the case where:
    // 1. User visits deep link, patch is queued
    // 2. User makes new edits (creates/updates draft)
    // 3. User reloads - we shouldn't overwrite the new edits with the old patch
    const existingDraft = adapter.getDraft(sourceRevisionId)
    if (existingDraft) {
        // Remove from pending since we're intentionally skipping
        deletePendingHydration(draftKey)
        return true // Return true to indicate we're done with this hydration
    }

    // Apply the patch using the adapter
    const success = adapter.applyDraftPatch(sourceRevisionId, patch)

    // Only remove from pending on success - keep it for retry if server data wasn't ready
    if (success) {
        deletePendingHydration(draftKey)
    }

    return success
}

/**
 * Apply all pending hydrations for a given source revision ID.
 * Useful when revision data loads and you want to apply all queued patches for that revision.
 *
 * IMPORTANT: Hydrations that create local drafts are processed BEFORE those that
 * apply draft patches to the source revision. This ensures local copies are cloned
 * from clean server data, before any draft patches modify the source revision's
 * merged (server + draft) state.
 *
 * @param sourceRevisionId - The source revision ID to apply pending hydrations for
 * @returns Number of patches successfully applied
 */
export function applyPendingHydrationsForRevision(sourceRevisionId: string): number {
    let applied = 0
    const currentPending = getPendingHydrations()

    // Collect entries for this source revision
    const entries: [string, PendingHydration][] = []
    for (const [draftKey, pending] of currentPending.entries()) {
        if (pending.sourceRevisionId === sourceRevisionId) {
            entries.push([draftKey, pending])
        }
    }

    // Process createLocalDraft entries FIRST, then applyDraftPatch entries.
    // createLocalDraftFromRevision reads the merged entity data (server + draft).
    // If a draft patch was already applied to the source revision, the local copy
    // would inherit those draft changes — which is incorrect when the local copy
    // had no changes of its own.
    entries.sort((a, b) => {
        if (a[1].createLocalDraft && !b[1].createLocalDraft) return -1
        if (!a[1].createLocalDraft && b[1].createLocalDraft) return 1
        return 0
    })

    for (const [draftKey] of entries) {
        if (applyPendingHydration(draftKey)) {
            applied++
        }
    }

    return applied
}

/**
 * Clear all pending hydrations.
 * Useful for manual cleanup when navigating away from a snapshot URL.
 */
export function clearPendingHydrations(): void {
    setPendingHydrations(new Map())
}

// ============================================================================
// CONTROLLER EXPORT
// ============================================================================

export const playgroundSnapshotController = {
    /**
     * Compound actions for snapshot operations.
     */
    actions: {
        /**
         * Create a snapshot from current selection.
         * Returns encoded string for URL sharing.
         */
        createSnapshot: createSnapshotAtom,

        /**
         * Hydrate a snapshot, restoring state from URL.
         * Returns new selection array with local draft IDs.
         */
        hydrateSnapshot: hydrateSnapshotAtom,
    },
}
