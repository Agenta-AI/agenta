/**
 * Testset Mutation Atoms
 *
 * Jotai atoms for testset/revision mutations (save, clear, track changes).
 * These are core entity behaviors, not layer-specific.
 */

import {projectIdAtom} from "@agenta/shared"
import {atom} from "jotai"

import {
    // Testcase atoms
    currentRevisionIdAtom,
    testcaseIdsAtom,
    newEntityIdsAtom,
    deletedEntityIdsAtom,
    testcaseDraftAtomFamily,
    testcaseEntityAtomFamily,
    testcaseHasDraftAtomFamily,
    discardAllDraftsAtom,
    clearNewEntityIdsAtom,
    clearDeletedIdsAtom,
    // Schema utilities
    unflattenTestcase,
} from "../../testcase"
import {fetchRevision, fetchVariantDetail} from "../api/api"
import {
    patchRevision,
    createTestset,
    archiveTestsets,
    cloneTestset as cloneTestsetApi,
} from "../api/mutations"
import type {TestsetRevisionDelta} from "../core"

import {
    pendingColumnOpsAtomFamily,
    pendingRowOpsAtomFamily,
    clearPendingOpsReducer,
} from "./revisionTableState"
import {revisionDraftAtomFamily} from "./store"

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

// System fields to exclude from column operations
const SYSTEM_FIELDS = new Set(["id", "__id", "__isSkeleton", "key", "created_at", "updated_at"])

interface Column {
    key: string
    name: string
}

// Derive current columns from testcase entities + revision-level pending ops
const currentColumnsAtom = atom<Column[]>((get) => {
    const revisionId = get(currentRevisionIdAtom)
    const serverIds = get(testcaseIdsAtom)
    const newIds = get(newEntityIdsAtom)
    const allIds = [...serverIds, ...newIds]

    // Get revision-level pending column ops
    const pendingColumnOps = revisionId ? get(pendingColumnOpsAtomFamily(revisionId)) : null
    const deletedCols = new Set(pendingColumnOps?.remove ?? [])
    const addedCols = new Set(pendingColumnOps?.add ?? [])

    // Collect unique keys from all entities
    const keySet = new Set<string>()
    for (const id of allIds) {
        const entity = get(testcaseEntityAtomFamily(id))
        if (!entity) continue
        for (const key of Object.keys(entity)) {
            if (!SYSTEM_FIELDS.has(key)) {
                keySet.add(key)
            }
        }
    }

    // Filter out pending deleted columns
    const columns: Column[] = []
    for (const key of keySet) {
        if (!deletedCols.has(key)) {
            columns.push({key, name: key})
        }
    }

    // Add pending added columns that aren't already present
    for (const key of addedCols) {
        if (!keySet.has(key) && !deletedCols.has(key)) {
            columns.push({key, name: key})
        }
    }

    return columns
})

// Clear revision draft
const clearRevisionDraftAtom = atom(null, (_get, set, revisionId: string) => {
    set(revisionDraftAtomFamily(revisionId), null)
})

// ============================================================================
// SAVE TESTSET MUTATION
// Creates a new revision with all pending changes
// ============================================================================

/**
 * Input parameters for save mutation
 */
export interface SaveTestsetParams {
    projectId: string
    testsetId: string
    revisionId?: string | null
    commitMessage?: string
}

/**
 * Result of save mutation
 */
export interface SaveTestsetResult {
    success: boolean
    newRevisionId?: string
    error?: Error
}

/**
 * Write-only atom to save testset changes
 * Creates a new revision using the patch API with delta changes
 *
 * Returns the new revision ID on success for redirect purposes
 */
export const saveTestsetAtom = atom(
    null,
    async (get, set, params: SaveTestsetParams): Promise<SaveTestsetResult> => {
        const {projectId, testsetId, revisionId, commitMessage} = params

        if (!projectId || !testsetId) {
            return {success: false, error: new Error("Missing projectId or testsetId")}
        }

        // Get testset name from revision or testset entity
        // Use the passed revisionId parameter, fallback to currentRevisionIdAtom
        const effectiveRevisionId = revisionId || get(currentRevisionIdAtom)

        // Fetch revision data from server and merge with any local draft
        let revisionData = null
        if (effectiveRevisionId) {
            try {
                const serverRevision = await fetchRevision({id: effectiveRevisionId, projectId})
                const draft = get(revisionDraftAtomFamily(effectiveRevisionId))
                revisionData = draft ? {...serverRevision, ...draft} : serverRevision
            } catch (error) {
                console.error("[saveTestsetAtom] Failed to fetch revision:", error)
            }
        }

        // Get variant ID from revision (name and description are stored in variant, not testset)
        const variantId = revisionData?.testset_variant_id

        // Fetch variant to get name and description
        let variant = null
        if (variantId) {
            try {
                variant = await fetchVariantDetail({id: variantId, projectId})
            } catch (error) {
                console.error("[saveTestsetAtom] Failed to fetch variant:", error)
            }
        }

        const testsetName = revisionData?.name ?? variant?.name ?? ""

        if (!testsetName.trim()) {
            console.error(
                "[saveTestsetAtom] Testset name is empty! revisionData:",
                revisionData,
                "variant:",
                variant,
            )
            return {success: false, error: new Error("Testset name is required")}
        }

        try {
            // Get all required state
            const columns = get(currentColumnsAtom)
            const serverIds = get(testcaseIdsAtom)
            const newIds = get(newEntityIdsAtom)
            const deletedIds = get(deletedEntityIdsAtom)

            // Build patch operations from local changes
            const operations: TestsetRevisionDelta = {}
            const currentColumnKeys = new Set(columns.map((c) => c.key))

            // Get pending column operations from revision-level state
            const pendingColumnOps = effectiveRevisionId
                ? get(pendingColumnOpsAtomFamily(effectiveRevisionId))
                : null

            // 0. Build column operations (applied to ALL testcases by backend)
            const hasRenames = (pendingColumnOps?.rename.length ?? 0) > 0
            const hasAdded = (pendingColumnOps?.add.length ?? 0) > 0
            const hasDeleted = (pendingColumnOps?.remove.length ?? 0) > 0

            if (hasRenames || hasAdded || hasDeleted) {
                operations.columns = {}

                if (hasRenames && pendingColumnOps) {
                    operations.columns.replace = pendingColumnOps.rename.map((r) => [
                        r.oldKey,
                        r.newKey,
                    ])
                }

                if (hasAdded && pendingColumnOps) {
                    operations.columns.add = [...pendingColumnOps.add]
                }

                if (hasDeleted && pendingColumnOps) {
                    operations.columns.remove = [...pendingColumnOps.remove]
                }
            }

            // 1. Collect updated testcases (entities with drafts, excluding deleted)
            const updatedTestcases = serverIds
                .filter((id) => {
                    // Has draft and not deleted
                    const hasDraft = get(testcaseHasDraftAtomFamily(id))
                    return hasDraft && !deletedIds.has(id)
                })
                .map((id) => {
                    const entity = get(testcaseEntityAtomFamily(id))
                    if (!entity) return null
                    const unflattened = unflattenTestcase(entity)
                    const filteredData: Record<string, unknown> = {}
                    if (unflattened.data) {
                        for (const key of Object.keys(unflattened.data)) {
                            if (currentColumnKeys.has(key)) {
                                filteredData[key] = unflattened.data[key]
                            }
                        }
                    }
                    return {
                        id: unflattened.id!,
                        data: filteredData,
                    }
                })
                .filter(Boolean) as {id: string; data: Record<string, unknown>}[]

            if (updatedTestcases.length > 0) {
                operations.rows = {
                    ...(operations.rows || {}),
                    replace: updatedTestcases,
                }
            }

            // 2. Collect new testcases (from newEntityIdsAtom)
            const newTestcasesData = newIds
                .map((id) => {
                    const draft = get(testcaseDraftAtomFamily(id))
                    if (!draft) return null
                    const unflattened = unflattenTestcase(draft)
                    const filteredData: Record<string, unknown> = {}
                    if (unflattened.data) {
                        for (const key of Object.keys(unflattened.data)) {
                            if (currentColumnKeys.has(key)) {
                                filteredData[key] = unflattened.data[key]
                            }
                        }
                    }
                    return {data: filteredData}
                })
                .filter(Boolean) as {data: Record<string, unknown>}[]

            if (newTestcasesData.length > 0) {
                operations.rows = {
                    ...(operations.rows || {}),
                    add: newTestcasesData,
                }
            }

            // 3. Collect deleted testcase IDs
            const deletedIdsArray = Array.from(deletedIds)
            if (deletedIdsArray.length > 0) {
                operations.rows = {
                    ...(operations.rows || {}),
                    remove: deletedIdsArray,
                }
            }

            // Check if there are any operations to apply
            const hasColumnOperations =
                (operations.columns?.replace?.length ?? 0) > 0 ||
                (operations.columns?.add?.length ?? 0) > 0 ||
                (operations.columns?.remove?.length ?? 0) > 0
            const hasTestcaseOperations =
                (operations.rows?.replace?.length ?? 0) > 0 ||
                (operations.rows?.add?.length ?? 0) > 0 ||
                (operations.rows?.remove?.length ?? 0) > 0

            if (!hasColumnOperations && !hasTestcaseOperations) {
                return {success: true, newRevisionId: revisionId || undefined}
            }

            // Patch revision with delta changes
            const response = await patchRevision({
                projectId,
                testsetId,
                operations,
                message: commitMessage || undefined,
                baseRevisionId: effectiveRevisionId ?? undefined,
            })

            if (response?.testset_revision) {
                const newRevisionId = response.testset_revision.id as string

                // Clear local edit state (drafts)
                if (effectiveRevisionId) {
                    set(clearPendingOpsReducer, effectiveRevisionId)
                    set(clearRevisionDraftAtom, effectiveRevisionId)
                }
                // Discard drafts BEFORE clearing IDs (discardAllDraftsAtom reads from newEntityIdsAtom)
                set(discardAllDraftsAtom)
                set(clearNewEntityIdsAtom)
                set(clearDeletedIdsAtom)

                return {success: true, newRevisionId}
            }

            return {success: false, error: new Error("No revision returned from API")}
        } catch (error) {
            return {success: false, error: error as Error}
        }
    },
)

// ============================================================================
// SAVE NEW TESTSET MUTATION
// Creates a new testset with local data (for "Create from scratch" flow)
// ============================================================================

/**
 * Input parameters for save new testset mutation
 */
export interface SaveNewTestsetParams {
    projectId: string
    testsetName: string
}

/**
 * Result of save new testset mutation
 */
export interface SaveNewTestsetResult {
    success: boolean
    revisionId?: string
    testsetId?: string
    testcases?: Record<string, unknown>[]
    error?: Error
}

/**
 * Write-only atom to save a new testset
 * Creates a new testset using the simple API with local testcase data
 */
export const saveNewTestsetAtom = atom(
    null,
    async (get, set, params: SaveNewTestsetParams): Promise<SaveNewTestsetResult> => {
        const {projectId, testsetName} = params

        if (!projectId || !testsetName.trim()) {
            return {success: false, error: new Error("Missing projectId or testsetName")}
        }

        try {
            // Get local testcase data
            const columns = get(currentColumnsAtom)
            const newIds = get(newEntityIdsAtom)
            const currentColumnKeys = new Set(columns.map((c) => c.key))

            // Collect testcase data from new entities
            const testcaseData = newIds
                .map((id) => {
                    const draft = get(testcaseDraftAtomFamily(id))
                    if (!draft) return null
                    // Filter to only include current columns
                    const filteredData: Record<string, unknown> = {}
                    for (const key of Object.keys(draft)) {
                        if (currentColumnKeys.has(key)) {
                            filteredData[key] = draft[key]
                        }
                    }
                    return filteredData
                })
                .filter(Boolean) as Record<string, unknown>[]

            // Create new testset via API
            const response = await createTestset({
                projectId,
                name: testsetName,
                testcases: testcaseData,
            })

            if (response?.revisionId) {
                // Clear local state after successful save
                const currentRevisionId = get(currentRevisionIdAtom)
                if (currentRevisionId) {
                    set(clearPendingOpsReducer, currentRevisionId)
                }
                set(discardAllDraftsAtom)
                set(clearNewEntityIdsAtom)
                set(clearDeletedIdsAtom)

                return {
                    success: true,
                    revisionId: response.revisionId,
                    testsetId: response.testset?.id,
                    testcases: testcaseData,
                }
            }

            return {success: false, error: new Error("No revision ID returned from API")}
        } catch (error) {
            return {success: false, error: error as Error}
        }
    },
)

// ============================================================================
// CLEAR CHANGES MUTATION
// Resets all local state back to server state
// ============================================================================

/**
 * Write-only atom to clear all local changes
 * Resets columns, metadata, new/deleted entities, and discards all drafts
 */
export const clearChangesAtom = atom(null, (get, set) => {
    // Get current revision ID for revision-scoped operations
    const revisionId = get(currentRevisionIdAtom)

    // Clear revision-level pending column/row operations
    if (revisionId) {
        set(clearPendingOpsReducer, revisionId)
    }

    // Clear new and deleted entity tracking
    set(clearNewEntityIdsAtom)
    set(clearDeletedIdsAtom)

    // Clear all drafts
    set(discardAllDraftsAtom)
})

// ============================================================================
// CHANGES SUMMARY
// Provides summary of unsaved changes for UI display
// ============================================================================

/**
 * Summary of all pending changes
 */
export interface ChangesSummary {
    newTestcases: number
    updatedTestcases: number
    deletedTestcases: number
    renamedColumns: number
    addedColumns: number
    deletedColumns: number
    hasChanges: boolean
}

/**
 * Read-only atom that provides a summary of all pending changes
 */
export const changesSummaryAtom = atom<ChangesSummary>((get) => {
    const revisionId = get(currentRevisionIdAtom)
    const newIds = get(newEntityIdsAtom)
    const deletedIds = get(deletedEntityIdsAtom)
    const serverIds = get(testcaseIdsAtom)

    // Get revision-level pending column ops
    const pendingColumnOps = revisionId ? get(pendingColumnOpsAtomFamily(revisionId)) : null
    const pendingRowOps = revisionId ? get(pendingRowOpsAtomFamily(revisionId)) : null

    // Count updated testcases (server entities with drafts, excluding deleted)
    let updatedCount = 0
    for (const id of serverIds) {
        if (!deletedIds.has(id) && get(testcaseHasDraftAtomFamily(id))) {
            updatedCount++
        }
    }

    const newTestcases = newIds.length + (pendingRowOps?.add.length ?? 0)
    const updatedTestcases = updatedCount
    const deletedTestcases = deletedIds.size + (pendingRowOps?.remove.length ?? 0)
    const renamedColumns = pendingColumnOps?.rename.length ?? 0
    const addedColumns = pendingColumnOps?.add.length ?? 0
    const deletedColumnsCount = pendingColumnOps?.remove.length ?? 0

    const hasChanges =
        newTestcases > 0 ||
        updatedTestcases > 0 ||
        deletedTestcases > 0 ||
        renamedColumns > 0 ||
        addedColumns > 0 ||
        deletedColumnsCount > 0

    return {
        newTestcases,
        updatedTestcases,
        deletedTestcases,
        renamedColumns,
        addedColumns,
        deletedColumns: deletedColumnsCount,
        hasChanges,
    }
})

/**
 * Simple boolean atom for checking if there are any unsaved changes
 */
export const hasUnsavedChangesAtom = atom<boolean>((get) => {
    const summary = get(changesSummaryAtom)
    return summary.hasChanges
})

// ============================================================================
// UNIFIED SAVE REDUCER
// Simplified save interface that handles both new and existing testsets
// ============================================================================

/**
 * Save operation state (isSaving, error)
 */
export interface SaveState {
    isSaving: boolean
    error: Error | null
}

/**
 * Atom tracking save operation state
 */
export const saveStateAtom = atom<SaveState>({
    isSaving: false,
    error: null,
})

/**
 * Parameters for unified save reducer
 */
export interface SaveParams {
    projectId: string
    revisionId?: string | null
    testsetName?: string
    commitMessage?: string
}

// ============================================================================
// DELETE REDUCER
// Used by EntityDeleteModal via adapter
// ============================================================================

/**
 * Delete (archive) testsets by IDs
 *
 * Used by the EntityDeleteModal via the testset adapter.
 * Reads projectId from the shared projectIdAtom.
 *
 * @param ids Array of testset IDs to delete
 */
export const deleteTestsetsReducer = atom(null, async (get, _set, ids: string[]): Promise<void> => {
    const projectId = get(projectIdAtom)
    if (!projectId || ids.length === 0) return

    await archiveTestsets({projectId, testsetIds: ids})

    // Note: Cache invalidation should be handled by the caller
    // or via a query invalidation after the modal closes
})

// ============================================================================
// CLONE REDUCERS
// Two-layer clone: local (no API) and backend (API call)
// ============================================================================

/**
 * Parameters for local clone
 */
export interface CloneLocalParams {
    /** Source revision ID to clone from */
    sourceRevisionId: string
    /** Optional new name (defaults to "Copy of {original}") */
    newName?: string
}

/**
 * Result of local clone
 */
export interface CloneLocalResult {
    success: boolean
    /** New local revision ID (temporary, not persisted) */
    localRevisionId?: string
    error?: Error
}

/**
 * Parameters for backend clone
 */
export interface CloneBackendParams {
    /** Source testset ID to clone */
    sourceTestsetId: string
    /** Name for the cloned testset */
    newName: string
}

/**
 * Result of backend clone
 */
export interface CloneBackendResult {
    success: boolean
    /** New revision ID from server */
    revisionId?: string
    /** New testset ID from server */
    testsetId?: string
    error?: Error
}

/**
 * Local clone - creates a new local entity with same data but unique ID
 *
 * This is a client-side only operation. The cloned entity exists only in
 * local state until saved. Useful for:
 * - Quick duplication in Playground
 * - Draft copies before modifications
 * - Offline-first workflows
 *
 * @returns Local revision ID that can be used to navigate/edit
 */
export const cloneLocalReducer = atom(
    null,
    async (get, set, params: CloneLocalParams): Promise<CloneLocalResult> => {
        const {sourceRevisionId, newName} = params
        const projectId = get(projectIdAtom)

        if (!projectId || !sourceRevisionId) {
            return {success: false, error: new Error("Missing projectId or sourceRevisionId")}
        }

        try {
            // Fetch source revision data
            const sourceRevision = await fetchRevision({id: sourceRevisionId, projectId})
            if (!sourceRevision) {
                return {success: false, error: new Error("Source revision not found")}
            }

            // Generate a new local ID for the cloned entity
            const localRevisionId = `local-clone-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

            // Determine the new name
            const clonedName = newName || `Copy of ${sourceRevision.name || "Testset"}`

            // Create draft with cloned data
            set(revisionDraftAtomFamily(localRevisionId), {
                ...sourceRevision,
                id: localRevisionId,
                name: clonedName,
                version: 0, // Reset version for new entity
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })

            // Clone testcases to new entity IDs
            // Note: testcases are fetched separately via fetchRevisionWithTestcases
            // For local clone, we only clone the revision metadata.
            // Testcases will be loaded when the user navigates to the cloned revision.

            return {success: true, localRevisionId}
        } catch (error) {
            return {success: false, error: error as Error}
        }
    },
)

/**
 * Backend clone - creates a new testset on the server by cloning an existing one
 *
 * This makes an API call to clone the testset on the backend.
 * The server handles all the cloning logic and returns a new testset/revision.
 *
 * @returns New revision ID and testset ID from server
 */
export const cloneBackendReducer = atom(
    null,
    async (get, _set, params: CloneBackendParams): Promise<CloneBackendResult> => {
        const {sourceTestsetId, newName} = params
        const projectId = get(projectIdAtom)

        if (!projectId || !sourceTestsetId || !newName.trim()) {
            return {
                success: false,
                error: new Error("Missing projectId, sourceTestsetId, or newName"),
            }
        }

        try {
            const response = await cloneTestsetApi({
                projectId,
                sourceTestsetId,
                newName,
            })

            if (response?.revisionId) {
                return {
                    success: true,
                    revisionId: response.revisionId,
                    testsetId: response.testset?.id,
                }
            }

            return {success: false, error: new Error("No revision ID returned from clone API")}
        } catch (error) {
            return {success: false, error: error as Error}
        }
    },
)

/**
 * Unified save reducer that handles both new and existing testsets
 *
 * - For new testsets (revisionId is "new" or undefined): creates a new testset
 * - For existing testsets: patches the revision with delta changes
 *
 * Manages isSaving/error state internally via saveStateAtom
 *
 * @returns The new revision ID on success, null on failure
 */
export const saveReducer = atom(
    null,
    async (get, set, params: SaveParams): Promise<string | null> => {
        const {projectId, revisionId, testsetName, commitMessage} = params
        const isNew = !revisionId || revisionId === "new"

        // Set saving state
        set(saveStateAtom, {isSaving: true, error: null})

        try {
            if (isNew) {
                // New testset flow
                if (!testsetName?.trim()) {
                    throw new Error("Testset name is required for new testset")
                }

                const result = await set(saveNewTestsetAtom, {
                    projectId,
                    testsetName,
                })

                if (!result.success) {
                    throw result.error || new Error("Failed to create testset")
                }

                set(saveStateAtom, {isSaving: false, error: null})
                return result.revisionId ?? null
            } else {
                // Existing testset flow - need to get testsetId from revision
                const revisionData = await fetchRevision({id: revisionId, projectId})
                const testsetId = revisionData?.testset_id

                if (!testsetId) {
                    throw new Error("Could not determine testset ID from revision")
                }

                const result = await set(saveTestsetAtom, {
                    projectId,
                    testsetId,
                    revisionId,
                    commitMessage,
                })

                if (!result.success) {
                    throw result.error || new Error("Failed to save testset")
                }

                set(saveStateAtom, {isSaving: false, error: null})
                return result.newRevisionId ?? null
            }
        } catch (error) {
            set(saveStateAtom, {isSaving: false, error: error as Error})
            return null
        }
    },
)
