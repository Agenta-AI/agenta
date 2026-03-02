/**
 * LegacyAppRevision Local Drafts
 *
 * Provides entity-level local draft management for legacyAppRevision.
 * Local drafts are revision copies that exist only in browser memory
 * and haven't been committed to the server.
 *
 * This module centralizes draft lifecycle management that was previously
 * scattered across OSS playground atoms.
 *
 * @example
 * ```typescript
 * import {
 *     localDraftIdsAtom,
 *     localDraftsListAtom,
 *     createLocalDraftFromRevision,
 *     discardLocalDraft,
 * } from '@agenta/entities/legacyAppRevision'
 *
 * // Get all local draft IDs
 * const draftIds = useAtomValue(localDraftIdsAtom)
 *
 * // Get drafts with full data
 * const drafts = useAtomValue(localDraftsListAtom)
 *
 * // Create a draft from an existing revision
 * const draftId = createLocalDraftFromRevision(revisionId)
 *
 * // Discard a draft
 * discardLocalDraft(draftId)
 * ```
 */

import type {Atom} from "jotai"
import {atom, getDefaultStore} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {atomFamily} from "jotai-family"

import {isLocalDraftId, extractSourceIdFromDraft} from "../../shared/utils/revisionLabel"
import type {LegacyAppRevisionData} from "../core"
import {cloneAsLocalDraft as cloneAsLocalDraftFactory} from "../core/factory"
import {resolveRootSourceId} from "../utils/sourceResolution"

import {
    persistLocalDraftData,
    clearPersistedLocalDraftData,
    restoreAllLocalDraftData,
} from "./draftPersistence"
import {
    legacyAppRevisionServerDataAtomFamily,
    legacyAppRevisionEntityWithBridgeAtomFamily,
    legacyAppRevisionIsDirtyWithBridgeAtomFamily,
    localDraftSourceRefsByIdAtom,
    discardLegacyAppRevisionDraftAtom,
    variantsListWithDraftsAtomFamily,
    revisionsListWithDraftsAtomFamily,
    setLocalDraftsAtoms,
    getRegisteredAppId,
} from "./store"

// ============================================================================
// LOCAL DRAFT ID TRACKING (APP-SCOPED)
// ============================================================================

/**
 * Internal storage atom tracking all local draft IDs per app.
 *
 * Uses atomWithStorage to persist draft IDs across page reloads.
 * The actual draft data is stored in the molecule's serverData atom.
 *
 * Format: Record<appId, draftIds[]> (e.g., {"app-123": ["local-abc", "local-def"]})
 */
const localDraftIdsByAppAtom = atomWithStorage<Record<string, string[]>>(
    "agenta:local-draft-ids-v2",
    {},
)

// ============================================================================
// APP-PARAMETERIZED ATOM FAMILIES (Primary API)
// ============================================================================

/**
 * Atom family tracking local draft IDs for a specific app.
 *
 * This is the preferred read interface when appId is available.
 * Consumers in atoms/hooks that already have appId should use this
 * instead of the global `localDraftIdsAtom`.
 */
export const localDraftIdsAtomFamily = atomFamily((appId: string) =>
    atom<string[]>((get) => {
        const allDrafts = get(localDraftIdsByAppAtom)
        return allDrafts[appId] || []
    }),
)

/**
 * Atom tracking local draft IDs for the CURRENT app.
 *
 * @deprecated Prefer `localDraftIdsAtomFamily(appId)` when appId is available.
 * This global atom uses the registered app ID atom as fallback.
 */
export const localDraftIdsAtom = atom<string[]>((get) => {
    const appId = getRegisteredAppId(get)
    return get(localDraftIdsAtomFamily(appId))
})

// ============================================================================
// LOCAL DRAFTS LIST (with full data)
// ============================================================================

/**
 * Local draft entry with full data and metadata.
 */
export interface LocalDraftEntry {
    /** Local draft ID */
    id: string
    /** Full revision data */
    data: LegacyAppRevisionData
    /** Source revision ID this draft was cloned from */
    sourceRevisionId: string | null
    /** Whether the draft has unsaved changes */
    isDirty: boolean
}

/**
 * Helper to map local draft IDs to full entries.
 */
const mapDraftIdsToEntries = (localIds: string[], get: <T>(a: Atom<T>) => T): LocalDraftEntry[] => {
    return localIds
        .map((id) => {
            const data = get(legacyAppRevisionEntityWithBridgeAtomFamily(id))
            if (!data) return null

            return {
                id,
                data,
                sourceRevisionId:
                    (data as LegacyAppRevisionData & {_sourceRevisionId?: string})
                        ._sourceRevisionId ?? extractSourceIdFromDraft(id),
                isDirty: get(legacyAppRevisionIsDirtyWithBridgeAtomFamily(id)),
            }
        })
        .filter((entry): entry is LocalDraftEntry => entry !== null)
}

/**
 * Atom family returning all local drafts with full data for a specific app.
 *
 * This is the preferred read interface when appId is available.
 */
export const localDraftsListAtomFamily = atomFamily((appId: string) =>
    atom<LocalDraftEntry[]>((get) => {
        const localIds = get(localDraftIdsAtomFamily(appId))
        return mapDraftIdsToEntries(localIds, get)
    }),
)

/**
 * Derived atom that returns all local drafts with their full data.
 *
 * @deprecated Prefer `localDraftsListAtomFamily(appId)` when appId is available.
 */
export const localDraftsListAtom = atom<LocalDraftEntry[]>((get) => {
    const localIds = get(localDraftIdsAtom)
    return mapDraftIdsToEntries(localIds, get)
})

/**
 * Clean up stale local draft IDs from localStorage.
 * Call this on app initialization to remove IDs that no longer have valid data.
 *
 * @param appId - The app ID to clean up drafts for. Falls back to registered app ID.
 */
export function cleanupStaleLocalDrafts(appId?: string): number {
    const store = getDefaultStore()
    const resolvedAppId = appId || getRegisteredAppId(store.get)
    const localIds = store.get(localDraftIdsAtomFamily(resolvedAppId))

    const validIds = localIds.filter((id) => {
        const data = store.get(legacyAppRevisionEntityWithBridgeAtomFamily(id))
        return data !== null
    })

    const removedCount = localIds.length - validIds.length
    if (removedCount > 0) {
        const allDrafts = {...store.get(localDraftIdsByAppAtom)}
        allDrafts[resolvedAppId] = validIds
        store.set(localDraftIdsByAppAtom, allDrafts)

        const validSet = new Set(validIds)
        store.set(localDraftSourceRefsByIdAtom, (prev) => {
            const next = {...prev}
            for (const id of localIds) {
                if (!validSet.has(id)) delete next[id]
            }
            return next
        })
    }

    return removedCount
}

/**
 * Initialize local drafts from persisted storage.
 *
 * Call this on app initialization, BEFORE cleanupStaleLocalDrafts runs.
 * Restores local draft data from localStorage so that IDs tracked
 * in `localDraftIdsByAppAtom` have their corresponding data available.
 *
 * @returns Number of local drafts restored from localStorage
 */
export function initializeLocalDrafts(): number {
    // Restore local draft data from localStorage first
    const restored = restoreAllLocalDraftData()
    // Then clean up IDs that still have no data (truly stale)
    cleanupStaleLocalDrafts()
    return restored
}

/**
 * Selector to check if there are any local drafts.
 */
export const hasLocalDraftsAtom = atom<boolean>((get) => {
    const ids = get(localDraftIdsAtom)
    return ids.length > 0
})

/**
 * Selector to check if there are any unsaved local drafts.
 * Used for page unload warnings.
 */
export const hasUnsavedLocalDraftsAtom = atom<boolean>((get) => {
    const drafts = get(localDraftsListAtom)
    return drafts.some((draft) => draft.isDirty)
})

// ============================================================================
// LOCAL DRAFT ACTIONS
// ============================================================================

/**
 * Create a local draft by cloning an existing revision.
 *
 * This function:
 * 1. Retrieves the source revision data from the molecule
 * 2. Creates a new local draft with a unique ID
 * 3. Initializes the draft in the molecule's serverData
 * 4. Tracks the draft ID in localDraftIdsAtom
 *
 * @param sourceRevisionId - The ID of the committed revision to clone
 * @param appId - Optional app ID for scoping. Falls back to source data's appId, then registered app ID.
 * @returns The new local draft ID, or null if source data is not available
 *
 * @example
 * ```typescript
 * const localId = createLocalDraftFromRevision(revisionId, appId)
 * // localId = "local-1706300000000-abc123" or null if source not ready
 * ```
 */
export function createLocalDraftFromRevision(
    sourceRevisionId: string,
    appId?: string,
): string | null {
    const store = getDefaultStore()

    // Type for accessing internal metadata fields on source data
    type DataWithExtras = LegacyAppRevisionData & {
        _sourceRevisionId?: string
        _sourceVariantId?: string
        _baseId?: string
        baseId?: string
        isLatestRevision?: boolean
    }

    // Get source data from entity atom
    let sourceData: LegacyAppRevisionData | null = store.get(
        legacyAppRevisionEntityWithBridgeAtomFamily(sourceRevisionId),
    )

    // ── Enrichment: fill missing variantId / baseId from variants list ──
    // This can happen when:
    // - Data comes from a direct query which doesn't include variantId
    // - Cloning from a local draft
    // - Entity atom hasn't been populated yet for this revision

    // If source is a local draft, resolve original source ID for lookups
    let variantIdSource = sourceRevisionId
    if (isLocalDraftId(sourceRevisionId) && sourceData) {
        const originalSourceId = (sourceData as DataWithExtras)._sourceRevisionId
        if (originalSourceId) {
            variantIdSource = originalSourceId
        }
    }

    if (!sourceData || !sourceData.variantId || !(sourceData as DataWithExtras).baseId) {
        // Shallow-clone so we can safely add/modify properties (atom data may be frozen)
        if (sourceData) {
            sourceData = {...sourceData}
        }

        const enrichAppId = appId || getRegisteredAppId(store.get)
        if (enrichAppId !== "__global__") {
            const variantsList =
                store.get(variantsListWithDraftsAtomFamily(enrichAppId))?.data ?? []

            // If sourceData is entirely missing, try to build it from the revision list
            if (!sourceData) {
                for (const variant of variantsList) {
                    if (!variant?.id) continue
                    const revQuery = store.get(revisionsListWithDraftsAtomFamily(variant.id))
                    const revisions = revQuery?.data ?? []
                    const match = revisions.find((r) => r.id === variantIdSource)
                    if (match) {
                        sourceData = {
                            id: sourceRevisionId,
                            variantId: variant.id,
                            appId: enrichAppId,
                            revision: match.revision,
                            variantName: variant.name || variant.baseName || "",
                            parameters: match.parameters ?? {},
                            uri: match.uri,
                        } as LegacyAppRevisionData
                        break
                    }
                }
            }

            // If variantId is missing, find it by looking up which variant owns this revision
            if (sourceData && !sourceData.variantId) {
                for (const variant of variantsList) {
                    if (!variant?.id) continue
                    const revQuery = store.get(revisionsListWithDraftsAtomFamily(variant.id))
                    const revisions = revQuery?.data ?? []
                    const found = revisions.find((r) => r.id === variantIdSource)
                    if (found) {
                        sourceData = {...sourceData, variantId: variant.id}
                        break
                    }
                }
            }

            // Ensure baseId is available from the variants list
            if (sourceData?.variantId && !(sourceData as DataWithExtras).baseId) {
                const parentVariant = variantsList.find((v) => v.id === sourceData?.variantId)
                if (parentVariant?.baseId) {
                    ;(sourceData as DataWithExtras).baseId = parentVariant.baseId
                }
            }

            // Persist enriched data so subsequent reads have it
            if (sourceData?.variantId) {
                store.set(legacyAppRevisionServerDataAtomFamily(sourceRevisionId), sourceData)
            }
        }
    }

    // ── End enrichment ──

    if (!sourceData) {
        console.warn("[createLocalDraftFromRevision] no sourceData for:", sourceRevisionId)
        return null
    }

    if (!sourceData.variantId) {
        console.warn("[createLocalDraftFromRevision] no variantId for:", sourceRevisionId)
        return null
    }

    // Resolve to root server revision ID if source is a local draft
    // This ensures _sourceRevisionId always points to a server revision, not another local draft
    const rootSourceRevisionId = resolveRootSourceId(sourceRevisionId) ?? sourceRevisionId

    // Get the root source data for the revision number (if different from immediate source)
    const rootSourceData =
        rootSourceRevisionId !== sourceRevisionId
            ? store.get(legacyAppRevisionEntityWithBridgeAtomFamily(rootSourceRevisionId))
            : sourceData

    // Create local draft using factory
    const {id: localId, data: draftData} = cloneAsLocalDraftFactory(sourceData, {
        variantName: `${sourceData.variantName ?? "Variant (Draft)"}`,
    })

    // When creating a draft-of-draft, inherit the ORIGINAL source info
    // This ensures we always trace back to the root server revision
    const isSourceALocalDraft = isLocalDraftId(sourceRevisionId)

    const sourceWithMeta = sourceData as DataWithExtras

    // Get the original source revision ID (always points to a server revision)
    // Use rootSourceRevisionId when available as it's the ultimate server revision
    const originalSourceRevisionId = isSourceALocalDraft
        ? (sourceWithMeta._sourceRevisionId ?? rootSourceRevisionId)
        : rootSourceRevisionId

    // Get the original variant ID (needed for API calls)
    const originalSourceVariantId = isSourceALocalDraft
        ? (sourceWithMeta._sourceVariantId ?? sourceData.variantId)
        : sourceData.variantId

    // Get the original base ID (needed for create variant API)
    const originalBaseId = isSourceALocalDraft
        ? (sourceWithMeta._baseId ?? sourceWithMeta.baseId)
        : sourceWithMeta.baseId

    // Store all source info in the data for reference
    // _sourceRevision uses root source data when available for accurate version tracking
    const dataWithSource = {
        ...draftData,
        _sourceRevisionId: originalSourceRevisionId,
        _sourceVariantId: originalSourceVariantId,
        _baseId: originalBaseId,
        _sourceRevision: rootSourceData?.revision ?? sourceData.revision,
    } as LegacyAppRevisionData

    // Initialize in molecule's serverData (this makes it available via entityAtom)
    store.set(legacyAppRevisionServerDataAtomFamily(localId), dataWithSource)

    // Persist local draft data to localStorage for page-reload survival
    persistLocalDraftData(localId)

    // Track in local drafts list, scoped by app ID
    // Priority: explicit appId param > source data's appId > registered app ID atom
    const resolvedAppId = appId || dataWithSource.appId || getRegisteredAppId(store.get)

    store.set(localDraftIdsByAppAtom, (prev) => {
        const appDrafts = prev[resolvedAppId] || []
        if (appDrafts.includes(localId)) return prev
        return {...prev, [resolvedAppId]: [...appDrafts, localId]}
    })

    // Persist source/base references so local draft can be rehydrated after reload.
    store.set(localDraftSourceRefsByIdAtom, (prev) => ({
        ...prev,
        [localId]: {
            sourceRevisionId: originalSourceRevisionId ?? null,
            sourceVariantId: originalSourceVariantId ?? null,
            baseId: originalBaseId ?? null,
            appId: resolvedAppId || null,
            createdAt: Date.now(),
        },
    }))

    return localId
}

/**
 * Extract the source revision ID from a local draft.
 * Reads from entity data where the _sourceRevisionId field is stored.
 * Returns null if the ID is not a local draft or source data is unavailable.
 *
 * @param localDraftId - The local draft ID to inspect
 * @returns The source revision ID, or null
 *
 * @example
 * ```typescript
 * const sourceId = getSourceRevisionId("local-abc-123")
 * // sourceId = "revision-uuid" or null
 * ```
 */
export function getSourceRevisionId(localDraftId: string): string | null {
    if (!isLocalDraftId(localDraftId)) return null

    const store = getDefaultStore()
    const data = store.get(legacyAppRevisionEntityWithBridgeAtomFamily(localDraftId))
    return (data as LegacyAppRevisionData & {_sourceRevisionId?: string})?._sourceRevisionId ?? null
}

/**
 * Discard a local draft, removing it from tracking and clearing molecule data.
 *
 * @param localDraftId - The local draft ID to discard
 * @returns true if the draft was discarded, false if it wasn't a local draft
 *
 * @example
 * ```typescript
 * discardLocalDraft("local-abc-123")
 * ```
 */
export function discardLocalDraft(localDraftId: string): boolean {
    if (!isLocalDraftId(localDraftId)) {
        return false
    }

    const store = getDefaultStore()

    // Get the draft's app ID before clearing it
    const draftData = store.get(legacyAppRevisionEntityWithBridgeAtomFamily(localDraftId))
    const appId = draftData?.appId || "__global__"

    // Remove from tracking list (app-scoped)
    store.set(localDraftIdsByAppAtom, (prev) => {
        const appDrafts = prev[appId] || []
        const filtered = appDrafts.filter((id) => id !== localDraftId)
        if (filtered.length === 0) {
            // Remove the app entry if no drafts remain
            const {[appId]: _, ...rest} = prev
            return rest
        }
        return {...prev, [appId]: filtered}
    })

    // Clear molecule data and persisted storage
    store.set(legacyAppRevisionServerDataAtomFamily(localDraftId), null)
    clearPersistedLocalDraftData(localDraftId)
    store.set(localDraftSourceRefsByIdAtom, (prev) => {
        const next = {...prev}
        delete next[localDraftId]
        return next
    })

    return true
}

/**
 * Discard all local drafts across all apps.
 *
 * @returns Number of drafts discarded
 */
export function discardAllLocalDrafts(): number {
    const store = getDefaultStore()
    const allDraftsByApp = store.get(localDraftIdsByAppAtom)

    // Collect all draft IDs
    const allIds = Object.values(allDraftsByApp).flat()

    // Clear each draft's data and persisted storage
    allIds.forEach((id) => {
        store.set(legacyAppRevisionServerDataAtomFamily(id), null)
        clearPersistedLocalDraftData(id)
    })

    // Clear the tracking storage
    store.set(localDraftIdsByAppAtom, {})
    store.set(localDraftSourceRefsByIdAtom, {})

    return allIds.length
}

// ============================================================================
// UNIFIED DISCARD DRAFT ATOM
// Clears molecule draft + local draft tracking in one step
// ============================================================================

/**
 * Unified atom for discarding all draft changes for a revision.
 *
 * Clears:
 * 1. Molecule draft state (enhanced prompts & custom properties)
 * 2. For local drafts: also removes from localDraftIdsAtom tracking and clears serverData
 *
 * Usage:
 * ```typescript
 * const discardDraft = useSetAtom(discardRevisionDraftAtom)
 * discardDraft(revisionId)
 * ```
 */
export const discardRevisionDraftAtom = atom(null, (_get, set, revisionId: string) => {
    if (!revisionId) return

    // 1. Use molecule's discard to clear enhanced prompts and custom properties drafts
    set(discardLegacyAppRevisionDraftAtom, revisionId)

    // 2. For local drafts, also remove from tracking and clear serverData
    if (isLocalDraftId(revisionId)) {
        discardLocalDraft(revisionId)
    }
})

// ============================================================================
// RE-EXPORTS for convenience
// ============================================================================

export {isLocalDraftId, extractSourceIdFromDraft}

// ============================================================================
// REGISTRATION - Wire up atoms to store for list composition
// ============================================================================

// Register local draft atom families with store to enable list composition
// This avoids circular dependencies by using a setter function
setLocalDraftsAtoms(localDraftIdsAtomFamily, localDraftsListAtomFamily)
