/**
 * Draft Persistence
 *
 * Provides localStorage-backed persistence for playground draft state.
 * This ensures draft changes survive page refreshes even when the URL
 * snapshot encoding fails (e.g., when parameters exceed the 8KB URL limit).
 *
 * Two types of drafts are persisted:
 * 1. **Regular drafts**: Edits to server revisions — only raw `parameters`
 *    are stored (same format as URL snapshot patches).
 * 2. **Local drafts**: Full copies with `local-*` IDs — serializable subset
 *    of LegacyAppRevisionData is stored since they have no server counterpart.
 *
 * @example
 * ```typescript
 * import {
 *     persistDraftPatch,
 *     clearPersistedDraft,
 *     restorePersistedDraft,
 *     getPersistedDraftPatches,
 * } from '@agenta/entities/legacyAppRevision'
 *
 * // Persist current draft state
 * persistDraftPatch(revisionId)
 *
 * // Restore on page load
 * const success = restorePersistedDraft(revisionId)
 *
 * // Clear on discard/commit
 * clearPersistedDraft(revisionId)
 * ```
 */

import {atomWithStorage} from "jotai/utils"
import {getDefaultStore} from "jotai/vanilla"

import type {LegacyAppRevisionData} from "../core"
import {buildLegacyAppRevisionDraftPatch, applyLegacyAppRevisionDraftPatch} from "../snapshot"

import {
    legacyAppRevisionServerDataAtomFamily,
    legacyAppRevisionEntityWithBridgeAtomFamily,
} from "./store"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Persisted draft patch for a regular (server-backed) revision.
 * Stores only raw parameters — enhanced data is re-derived on restore.
 */
export interface PersistedDraftPatch {
    /** Raw parameters (ag_config) */
    parameters: Record<string, unknown>
    /** Timestamp when persisted (epoch ms) */
    timestamp: number
}

/**
 * Persisted data for a local draft (no server-side counterpart).
 * Stores the serializable subset of LegacyAppRevisionData.
 */
export interface PersistedLocalDraftData {
    id: string
    revision?: number
    variantId?: string
    variantName?: string
    appId?: string
    parameters?: Record<string, unknown>
    uri?: string
    runtimePrefix?: string
    routePath?: string
    configName?: string
    /** Source revision metadata */
    _sourceRevisionId?: string
    _sourceVariantId?: string
    _baseId?: string
    _sourceRevision?: number
    /** Timestamp when persisted (epoch ms) */
    timestamp: number
}

// ============================================================================
// STORAGE ATOMS
// ============================================================================

/**
 * Persisted draft patches for server-backed revisions.
 * Key: revisionId, Value: { parameters, timestamp }
 */
const persistedDraftPatchesAtom = atomWithStorage<Record<string, PersistedDraftPatch>>(
    "agenta:draft-patches-v1",
    {},
)

/**
 * Persisted data for local drafts.
 * Key: localDraftId, Value: { ...serializable fields, timestamp }
 */
const persistedLocalDraftDataAtom = atomWithStorage<Record<string, PersistedLocalDraftData>>(
    "agenta:local-draft-data-v1",
    {},
)

// ============================================================================
// REGULAR DRAFT PERSISTENCE
// ============================================================================

/**
 * Persist the current draft state for a server-backed revision.
 *
 * Uses `buildLegacyAppRevisionDraftPatch` to extract only raw parameters.
 * If the draft is clean (matches server data), removes the persisted entry.
 */
export function persistDraftPatch(revisionId: string): void {
    try {
        const store = getDefaultStore()
        const result = buildLegacyAppRevisionDraftPatch(revisionId)

        const current = store.get(persistedDraftPatchesAtom)

        if (result.hasDraft && result.patch) {
            store.set(persistedDraftPatchesAtom, {
                ...current,
                [revisionId]: {
                    parameters: result.patch.parameters,
                    timestamp: Date.now(),
                },
            })
        } else if (current[revisionId]) {
            // Draft is clean — remove persisted entry
            const {[revisionId]: _, ...rest} = current
            store.set(persistedDraftPatchesAtom, rest)
        }
    } catch {
        // Silently handle localStorage quota errors
    }
}

/**
 * Remove a persisted draft patch.
 * Call on discard or commit.
 */
export function clearPersistedDraft(revisionId: string): void {
    try {
        const store = getDefaultStore()
        const current = store.get(persistedDraftPatchesAtom)
        if (!current[revisionId]) return

        const {[revisionId]: _, ...rest} = current
        store.set(persistedDraftPatchesAtom, rest)
    } catch {
        // Silently handle localStorage errors
    }
}

/**
 * Restore a persisted draft patch for a revision.
 *
 * Reads the patch from localStorage and applies it via
 * `applyLegacyAppRevisionDraftPatch`. On success, removes the entry.
 *
 * @returns true if restored successfully, false if not found or server data unavailable
 */
export function restorePersistedDraft(revisionId: string): boolean {
    try {
        const store = getDefaultStore()
        const current = store.get(persistedDraftPatchesAtom)
        const entry = current[revisionId]
        if (!entry) return false

        const success = applyLegacyAppRevisionDraftPatch(revisionId, {
            parameters: entry.parameters,
        })

        if (success) {
            // Remove from storage after successful restore
            const {[revisionId]: _, ...rest} = current
            store.set(persistedDraftPatchesAtom, rest)
        }

        return success
    } catch {
        return false
    }
}

/**
 * Get all persisted draft patches (for checking on mount).
 */
export function getPersistedDraftPatches(): Record<string, PersistedDraftPatch> {
    try {
        const store = getDefaultStore()
        return store.get(persistedDraftPatchesAtom)
    } catch {
        return {}
    }
}

// ============================================================================
// LOCAL DRAFT PERSISTENCE
// ============================================================================

/**
 * Extract serializable fields from LegacyAppRevisionData.
 * Strips `enhancedPrompts` and `enhancedCustomProperties` which contain
 * session-specific `__id` and `__metadata` hashes.
 */
function toSerializableLocalDraft(data: LegacyAppRevisionData): PersistedLocalDraftData {
    const withMeta = data as LegacyAppRevisionData & {
        _sourceRevisionId?: string
        _sourceVariantId?: string
        _baseId?: string
        _sourceRevision?: number
    }

    return {
        id: data.id,
        revision: data.revision,
        variantId: data.variantId,
        variantName: data.variantName,
        appId: data.appId,
        parameters: data.parameters,
        uri: data.uri,
        runtimePrefix: data.runtimePrefix,
        routePath: data.routePath,
        configName: data.configName,
        _sourceRevisionId: withMeta._sourceRevisionId,
        _sourceVariantId: withMeta._sourceVariantId,
        _baseId: withMeta._baseId,
        _sourceRevision: withMeta._sourceRevision,
        timestamp: Date.now(),
    }
}

/**
 * Persist a local draft's data to localStorage.
 */
export function persistLocalDraftData(localDraftId: string): void {
    try {
        const store = getDefaultStore()
        const data = store.get(legacyAppRevisionEntityWithBridgeAtomFamily(localDraftId))
        if (!data) return

        const current = store.get(persistedLocalDraftDataAtom)
        store.set(persistedLocalDraftDataAtom, {
            ...current,
            [localDraftId]: toSerializableLocalDraft(data),
        })
    } catch {
        // Silently handle localStorage quota errors
    }
}

/**
 * Remove a persisted local draft's data.
 */
export function clearPersistedLocalDraftData(localDraftId: string): void {
    try {
        const store = getDefaultStore()
        const current = store.get(persistedLocalDraftDataAtom)
        if (!current[localDraftId]) return

        const {[localDraftId]: _, ...rest} = current
        store.set(persistedLocalDraftDataAtom, rest)
    } catch {
        // Silently handle localStorage errors
    }
}

/**
 * Restore a single local draft's data from localStorage.
 * Sets the data into `legacyAppRevisionServerDataAtomFamily`.
 *
 * @returns true if restored, false if not found
 */
export function restoreLocalDraftData(localDraftId: string): boolean {
    try {
        const store = getDefaultStore()
        const current = store.get(persistedLocalDraftDataAtom)
        const entry = current[localDraftId]
        if (!entry) return false

        // Check if data is already present in memory
        const existing = store.get(legacyAppRevisionEntityWithBridgeAtomFamily(localDraftId))
        if (existing) return true // Already loaded

        // Build a LegacyAppRevisionData-compatible object from persisted data
        const restoredData: LegacyAppRevisionData = {
            id: entry.id,
            revision: entry.revision ?? 0,
            variantId: entry.variantId,
            variantName: entry.variantName,
            appId: entry.appId,
            parameters: entry.parameters,
            uri: entry.uri,
            runtimePrefix: entry.runtimePrefix,
            routePath: entry.routePath,
            configName: entry.configName,
            // Enhanced data intentionally omitted — will be re-derived
        }

        // Attach source metadata
        const dataWithMeta = restoredData as LegacyAppRevisionData & {
            _sourceRevisionId?: string
            _sourceVariantId?: string
            _baseId?: string
            _sourceRevision?: number
        }
        if (entry._sourceRevisionId) dataWithMeta._sourceRevisionId = entry._sourceRevisionId
        if (entry._sourceVariantId) dataWithMeta._sourceVariantId = entry._sourceVariantId
        if (entry._baseId) dataWithMeta._baseId = entry._baseId
        if (entry._sourceRevision) dataWithMeta._sourceRevision = entry._sourceRevision

        // Set into the server data atom (local drafts use serverDataAtomFamily, not draftAtomFamily)
        store.set(legacyAppRevisionServerDataAtomFamily(localDraftId), dataWithMeta)

        // Remove from persistence after successful restore
        const {[localDraftId]: _, ...rest} = current
        store.set(persistedLocalDraftDataAtom, rest)

        return true
    } catch {
        return false
    }
}

/**
 * Restore all persisted local draft data.
 * Call on app initialization before `cleanupStaleLocalDrafts`.
 *
 * @returns Number of drafts restored
 */
export function restoreAllLocalDraftData(): number {
    try {
        const store = getDefaultStore()
        const current = store.get(persistedLocalDraftDataAtom)
        let count = 0

        for (const localDraftId of Object.keys(current)) {
            if (restoreLocalDraftData(localDraftId)) {
                count++
            }
        }

        return count
    } catch {
        return 0
    }
}

// ============================================================================
// CLEANUP
// ============================================================================

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Remove persisted entries older than the given threshold.
 *
 * @param maxAgeMs - Maximum age in milliseconds (default: 7 days)
 * @returns Number of entries removed
 */
export function cleanupStalePersistedDrafts(maxAgeMs: number = SEVEN_DAYS_MS): number {
    try {
        const store = getDefaultStore()
        const now = Date.now()
        let removed = 0

        // Clean regular draft patches
        const patches = store.get(persistedDraftPatchesAtom)
        const cleanedPatches: Record<string, PersistedDraftPatch> = {}
        for (const [id, entry] of Object.entries(patches)) {
            if (now - entry.timestamp > maxAgeMs) {
                removed++
            } else {
                cleanedPatches[id] = entry
            }
        }
        if (removed > 0) {
            store.set(persistedDraftPatchesAtom, cleanedPatches)
        }

        // Clean local draft data
        const localData = store.get(persistedLocalDraftDataAtom)
        const cleanedLocal: Record<string, PersistedLocalDraftData> = {}
        let localRemoved = 0
        for (const [id, entry] of Object.entries(localData)) {
            if (now - entry.timestamp > maxAgeMs) {
                localRemoved++
            } else {
                cleanedLocal[id] = entry
            }
        }
        if (localRemoved > 0) {
            store.set(persistedLocalDraftDataAtom, cleanedLocal)
        }

        return removed + localRemoved
    } catch {
        return 0
    }
}

// ============================================================================
// EXPORTS (atoms for direct access if needed)
// ============================================================================

export {persistedDraftPatchesAtom, persistedLocalDraftDataAtom}
