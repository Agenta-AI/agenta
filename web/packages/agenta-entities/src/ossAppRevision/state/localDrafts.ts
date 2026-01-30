/**
 * OssAppRevision Local Drafts
 *
 * Provides entity-level local draft management for ossAppRevision.
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
 * } from '@agenta/entities/ossAppRevision'
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

import {atom, getDefaultStore} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {isLocalDraftId, extractSourceIdFromDraft} from "../../shared/utils/revisionLabel"
import type {OssAppRevisionData} from "../core"
import {cloneAsLocalDraft as cloneAsLocalDraftFactory} from "../core/factory"

import {
    ossAppRevisionServerDataAtomFamily,
    ossAppRevisionEntityWithBridgeAtomFamily,
    ossAppRevisionIsDirtyWithBridgeAtomFamily,
    setLocalDraftsAtoms,
} from "./store"

// ============================================================================
// LOCAL DRAFT ID TRACKING
// ============================================================================

/**
 * Atom tracking all local draft IDs in the current session.
 *
 * Uses atomWithStorage to persist draft IDs across page reloads.
 * The actual draft data is stored in the molecule's serverData atom.
 *
 * Format: Array of local draft IDs (e.g., ["local-abc-123", "local-def-456"])
 */
export const localDraftIdsAtom = atomWithStorage<string[]>("agenta:local-draft-ids", [])

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
    data: OssAppRevisionData
    /** Source revision ID this draft was cloned from */
    sourceRevisionId: string | null
    /** Whether the draft has unsaved changes */
    isDirty: boolean
}

/**
 * Derived atom that returns all local drafts with their full data.
 *
 * Useful for displaying in selection dropdowns or draft management UI.
 */
export const localDraftsListAtom = atom<LocalDraftEntry[]>((get) => {
    const localIds = get(localDraftIdsAtom)

    return localIds
        .map((id) => {
            const data = get(ossAppRevisionEntityWithBridgeAtomFamily(id))
            if (!data) return null

            return {
                id,
                data,
                sourceRevisionId: extractSourceIdFromDraft(id),
                isDirty: get(ossAppRevisionIsDirtyWithBridgeAtomFamily(id)),
            }
        })
        .filter((entry): entry is LocalDraftEntry => entry !== null)
})

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
 * @returns The new local draft ID
 * @throws Error if source revision data is not found
 *
 * @example
 * ```typescript
 * const localId = createLocalDraftFromRevision(revisionId)
 * // localId = "local-1706300000000-abc123"
 * ```
 */
export function createLocalDraftFromRevision(sourceRevisionId: string): string {
    const store = getDefaultStore()

    // Get source data from molecule
    const sourceData = store.get(ossAppRevisionEntityWithBridgeAtomFamily(sourceRevisionId))

    if (!sourceData) {
        throw new Error(`Source revision not found: ${sourceRevisionId}`)
    }

    // Create local draft using factory
    const {id: localId, data: draftData} = cloneAsLocalDraftFactory(sourceData, {
        variantName: `${sourceData.variantName ?? "Variant (Draft)"}`,
    })

    // Store the source revision ID in the data for reference
    const dataWithSource = {
        ...draftData,
        _sourceRevisionId: sourceRevisionId,
        _sourceRevision: sourceData.revision,
    } as OssAppRevisionData

    // Initialize in molecule's serverData (this makes it available via entityAtom)
    store.set(ossAppRevisionServerDataAtomFamily(localId), dataWithSource)

    // Track in local drafts list
    store.set(localDraftIdsAtom, (prev) => {
        if (prev.includes(localId)) return prev
        return [...prev, localId]
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

    // Remove from tracking list
    store.set(localDraftIdsAtom, (prev) => prev.filter((id) => id !== localDraftId))

    // Clear molecule data
    store.set(ossAppRevisionServerDataAtomFamily(localDraftId), null)

    return true
}

/**
 * Discard all local drafts.
 *
 * @returns Number of drafts discarded
 */
export function discardAllLocalDrafts(): number {
    const store = getDefaultStore()
    const ids = store.get(localDraftIdsAtom)

    // Clear each draft's data
    ids.forEach((id) => {
        store.set(ossAppRevisionServerDataAtomFamily(id), null)
    })

    // Clear the tracking list
    store.set(localDraftIdsAtom, [])

    return ids.length
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
 * const draftId = createDraft(sourceRevisionId)
 * ```
 */
export const createLocalDraftAtom = atom(null, (_get, _set, sourceRevisionId: string): string => {
    return createLocalDraftFromRevision(sourceRevisionId)
})

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
