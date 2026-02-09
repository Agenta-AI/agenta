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

import {isLocalDraftId, extractSourceIdFromDraft} from "../../shared/utils/revisionLabel"
import type {LegacyAppRevisionData} from "../core"
import {cloneAsLocalDraft as cloneAsLocalDraftFactory} from "../core/factory"
import {resolveRootSourceId} from "../utils/sourceResolution"

import {
    legacyAppRevisionServerDataAtomFamily,
    legacyAppRevisionEntityWithBridgeAtomFamily,
    legacyAppRevisionIsDirtyWithBridgeAtomFamily,
    setLocalDraftsAtoms,
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

/**
 * Current app ID atom - set by OSS code via setCurrentAppIdAtom
 * Used to scope local drafts to the current app.
 */
let _currentAppIdAtom: ReturnType<typeof atom<string | null>> | null = null

/**
 * Set the current app ID atom (called from OSS code to avoid circular deps)
 */
export function setCurrentAppIdAtom(appIdAtom: ReturnType<typeof atom<string | null>>): void {
    _currentAppIdAtom = appIdAtom
}

/**
 * Get current app ID from the registered atom, fallback to "__global__"
 */
function getCurrentAppId(get: <T>(atom: Atom<T>) => T): string {
    if (_currentAppIdAtom) {
        const appId = get(_currentAppIdAtom)
        if (appId && typeof appId === "string") return appId
    }
    return "__global__"
}

/**
 * Atom tracking local draft IDs for the CURRENT app.
 *
 * This is the primary read interface for local draft IDs.
 * It automatically filters to only show drafts for the current app.
 */
export const localDraftIdsAtom = atom<string[]>((get) => {
    const appId = getCurrentAppId(get)
    const allDrafts = get(localDraftIdsByAppAtom)
    return allDrafts[appId] || []
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
 * Derived atom that returns all local drafts with their full data.
 *
 * Useful for displaying in selection dropdowns or draft management UI.
 * Filters out IDs that no longer have valid data (stale entries).
 */
export const localDraftsListAtom = atom<LocalDraftEntry[]>((get) => {
    const localIds = get(localDraftIdsAtom)

    return localIds
        .map((id) => {
            const data = get(legacyAppRevisionEntityWithBridgeAtomFamily(id))
            if (!data) return null

            return {
                id,
                data,
                sourceRevisionId: extractSourceIdFromDraft(id),
                isDirty: get(legacyAppRevisionIsDirtyWithBridgeAtomFamily(id)),
            }
        })
        .filter((entry): entry is LocalDraftEntry => entry !== null)
})

/**
 * Clean up stale local draft IDs from localStorage.
 * Call this on app initialization to remove IDs that no longer have valid data.
 */
export function cleanupStaleLocalDrafts(): number {
    const store = getDefaultStore()
    const localIds = store.get(localDraftIdsAtom)

    const validIds = localIds.filter((id) => {
        const data = store.get(legacyAppRevisionEntityWithBridgeAtomFamily(id))
        return data !== null
    })

    const removedCount = localIds.length - validIds.length
    if (removedCount > 0) {
        // Write to the underlying per-app storage atom (localDraftIdsAtom is read-only derived)
        const appId = _currentAppIdAtom
            ? store.get(_currentAppIdAtom) || "__global__"
            : "__global__"
        const allDrafts = {...store.get(localDraftIdsByAppAtom)}
        allDrafts[appId] = validIds
        store.set(localDraftIdsByAppAtom, allDrafts)
    }

    return removedCount
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
 * @returns The new local draft ID, or null if source data is not available
 *
 * @example
 * ```typescript
 * const localId = createLocalDraftFromRevision(revisionId)
 * // localId = "local-1706300000000-abc123" or null if source not ready
 * ```
 */
export function createLocalDraftFromRevision(sourceRevisionId: string): string | null {
    const store = getDefaultStore()

    // Get source data from molecule
    const sourceData = store.get(legacyAppRevisionEntityWithBridgeAtomFamily(sourceRevisionId))

    if (!sourceData) {
        console.warn("[createLocalDraftFromRevision] no sourceData for:", sourceRevisionId)
        return null
    }

    // Check if variantId is available - it's required for cloning
    // variantId is typically set by useSetRevisionVariantContext after revision data loads
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

    // Type for accessing internal metadata fields on source data
    type SourceDataWithMetadata = LegacyAppRevisionData & {
        _sourceRevisionId?: string
        _sourceVariantId?: string
        _baseId?: string
        baseId?: string
    }
    const sourceWithMeta = sourceData as SourceDataWithMetadata

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

    // Track in local drafts list, scoped by app ID
    // Use the registered current app ID atom as fallback when dataWithSource.appId is missing.
    // This happens when cloning from a local draft whose source data doesn't have appId set.
    // The read side (localDraftIdsAtom) uses getCurrentAppId which reads from _currentAppIdAtom,
    // so the write side must match to avoid storing under "__global__" while reading under the real app ID.
    let appId = dataWithSource.appId
    if (!appId) {
        appId = _currentAppIdAtom ? (store.get(_currentAppIdAtom) ?? "__global__") : "__global__"
    }

    store.set(localDraftIdsByAppAtom, (prev) => {
        const appDrafts = prev[appId] || []
        if (appDrafts.includes(localId)) return prev
        return {...prev, [appId]: [...appDrafts, localId]}
    })

    return localId
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

    // Clear molecule data
    store.set(legacyAppRevisionServerDataAtomFamily(localDraftId), null)

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

    // Clear each draft's data
    allIds.forEach((id) => {
        store.set(legacyAppRevisionServerDataAtomFamily(id), null)
    })

    // Clear the tracking storage
    store.set(localDraftIdsByAppAtom, {})

    return allIds.length
}

// ============================================================================
// WRITE ATOMS (for use with useSetAtom)
// ============================================================================

/**
 * Write atom for creating a local draft from a revision.
 *
 * @example
 * ```typescript
 * const createDraft = useSetAtom(createLocalDraftAtom)
 * const draftId = createDraft(sourceRevisionId) // may be null if source not ready
 * ```
 */
export const createLocalDraftAtom = atom(
    null,
    (_get, _set, sourceRevisionId: string): string | null => {
        return createLocalDraftFromRevision(sourceRevisionId)
    },
)

/**
 * Write atom for discarding a local draft.
 *
 * @example
 * ```typescript
 * const discard = useSetAtom(discardLocalDraftAtom)
 * discard(localDraftId)
 * ```
 */
export const discardLocalDraftAtom = atom(null, (_get, _set, localDraftId: string): boolean => {
    return discardLocalDraft(localDraftId)
})

/**
 * Write atom for discarding all local drafts.
 *
 * @example
 * ```typescript
 * const discardAll = useSetAtom(discardAllLocalDraftsAtom)
 * const count = discardAll()
 * ```
 */
export const discardAllLocalDraftsAtom = atom(null, (_get, _set): number => {
    return discardAllLocalDrafts()
})

// ============================================================================
// RE-EXPORTS for convenience
// ============================================================================

export {isLocalDraftId, extractSourceIdFromDraft}

// ============================================================================
// REGISTRATION - Wire up atoms to store for list composition
// ============================================================================

// Register local draft atoms with store to enable list composition
// This avoids circular dependencies by using a setter function
setLocalDraftsAtoms(localDraftIdsAtom, localDraftsListAtom as ReturnType<typeof atom<unknown[]>>)
