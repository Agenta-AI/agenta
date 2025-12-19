import {atom} from "jotai"

import {
    patchTestsetRevision,
    updateTestset,
    type TestsetRevisionPatchOperations,
} from "@/oss/services/testsets/api"

import {
    addColumnAtom,
    clearPendingAddedColumnsAtom,
    clearPendingDeletedColumnsAtom,
    clearPendingRenamesAtom,
    currentColumnsAtom,
    resetColumnsAtom,
} from "./columnState"
import {testcaseDraftStore} from "./draftStore"
import type {FlattenedTestcase} from "./schema"
import {unflattenTestcase} from "./schema"
import {testcaseStore} from "./store"
import {
    addNewEntityIdAtom,
    clearDeletedIdsAtom,
    clearNewEntityIdsAtom,
    deletedEntityIdsAtom,
    discardAllDraftsAtom,
    markDeletedAtom,
    newEntityIdsAtom,
    removeNewEntityIdAtom,
    testcaseDraftAtomFamily,
    testcaseEntityAtomFamily,
    testcaseHasDraftAtomFamily,
    testcaseIdsAtom,
} from "./testcaseEntity"
import {
    currentDescriptionAtom,
    currentTestsetIdAtom,
    currentTestsetNameAtom,
    descriptionChangedAtom,
    resetMetadataAtom,
    testsetNameChangedAtom,
} from "./testsetMetadata"

// ============================================================================
// SAVE TESTSET MUTATION
// Handles all the heavy lifting for saving testset changes
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

        const testsetName = get(currentTestsetNameAtom)
        if (!testsetName.trim()) {
            return {success: false, error: new Error("Testset name is required")}
        }

        try {
            // Get all required state
            const columns = get(currentColumnsAtom)
            const serverIds = get(testcaseIdsAtom)
            const newIds = get(newEntityIdsAtom)
            const deletedIds = get(deletedEntityIdsAtom)
            const testsetNameChanged = get(testsetNameChangedAtom)
            const descriptionChanged = get(descriptionChangedAtom)
            const description = get(currentDescriptionAtom)

            // Build patch operations from local changes
            const operations: TestsetRevisionPatchOperations = {}
            const currentColumnKeys = new Set(columns.map((c) => c.key))

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
                operations.update = updatedTestcases
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
                operations.create = newTestcasesData
            }

            // 3. Collect deleted testcase IDs
            const deletedIdsArray = Array.from(deletedIds)
            if (deletedIdsArray.length > 0) {
                operations.delete = deletedIdsArray
            }

            // Update testset name if changed
            if (testsetNameChanged) {
                await updateTestset(testsetId, testsetName, [])
            }

            // Check if there are any operations to apply
            const hasOperations =
                (operations.update?.length ?? 0) > 0 ||
                (operations.create?.length ?? 0) > 0 ||
                (operations.delete?.length ?? 0) > 0

            if (!hasOperations && !testsetNameChanged && !descriptionChanged) {
                return {success: true, newRevisionId: revisionId || undefined}
            }

            // Patch revision with delta changes
            const response = await patchTestsetRevision(
                testsetId,
                operations,
                commitMessage || undefined,
                revisionId ?? undefined,
                descriptionChanged ? description : undefined,
            )

            if (response?.testset_revision) {
                const newRevisionId = response.testset_revision.id as string

                // Clear local edit state (new architecture)
                set(resetColumnsAtom)
                set(clearPendingRenamesAtom)
                set(clearPendingAddedColumnsAtom)
                set(clearPendingDeletedColumnsAtom)
                set(resetMetadataAtom)
                set(clearNewEntityIdsAtom)
                set(clearDeletedIdsAtom)
                set(discardAllDraftsAtom)

                // Also clear old store for backward compatibility
                set(testcaseStore.clearNewDeletedAtom)
                set(testcaseStore.clearAllAtom)

                return {success: true, newRevisionId}
            }

            return {success: false, error: new Error("No revision returned from API")}
        } catch (error) {
            console.error("[saveTestsetAtom] Failed to save testset:", error)
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
    // Reset column state
    set(resetColumnsAtom)
    set(clearPendingRenamesAtom)
    set(clearPendingAddedColumnsAtom)
    set(clearPendingDeletedColumnsAtom)

    // Reset metadata (name/description)
    set(resetMetadataAtom)

    // Clear new and deleted entity tracking (from testcaseEntity)
    set(clearNewEntityIdsAtom)
    set(clearDeletedIdsAtom)

    // Clear all drafts (from testcaseEntity)
    set(discardAllDraftsAtom)

    // Also clear old entity store for backward compatibility
    set(testcaseStore.clearNewDeletedAtom)
    set(testcaseDraftStore.clearAllDrafts)
})

// ============================================================================
// DELETE TESTCASES MUTATION
// Handles deletion of both new and existing rows
// ============================================================================

/**
 * Write-only atom to delete testcases
 * - New rows (not yet on server): removes from newEntities
 * - Existing rows: marks as deleted
 */
export const deleteTestcasesAtom = atom(null, (get, set, rowKeys: string[]) => {
    const newIds = new Set(get(newEntityIdsAtom))

    rowKeys.forEach((id) => {
        const isNewRow = newIds.has(id)
        if (isNewRow) {
            // Remove from new entity IDs
            set(removeNewEntityIdAtom, id)
            // Also remove from old store for backward compatibility
            set(testcaseStore.removeNewEntityAtom, id)
        } else {
            // Mark as deleted in new architecture
            set(markDeletedAtom, id)
            // Also mark in old store for backward compatibility
            set(testcaseStore.markDeletedAtom, id)
        }
    })
})

// ============================================================================
// ADD TESTCASE MUTATION
// Creates a new testcase row with current columns
// ============================================================================

/**
 * Result of addTestcase mutation
 */
export interface AddTestcaseResult {
    id: string
    data: FlattenedTestcase
}

/**
 * Write-only atom to add a new testcase
 * Creates a row with all current columns initialized to empty strings
 */
export const addTestcaseAtom = atom(null, (get, set): AddTestcaseResult => {
    const testsetId = get(currentTestsetIdAtom) || ""
    const columns = get(currentColumnsAtom)

    const newRowId = `new-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const flattenedRow: FlattenedTestcase = {
        id: newRowId,
        testset_id: testsetId,
        ...Object.fromEntries(columns.map((col) => [col.key, ""])),
    }

    // Add to new entity IDs (new architecture)
    set(addNewEntityIdAtom, newRowId)
    // Create draft for the new entity
    set(testcaseDraftAtomFamily(newRowId), flattenedRow)

    // Also add to old store for backward compatibility
    set(testcaseStore.createEntityAtom, flattenedRow)

    return {id: newRowId, data: flattenedRow}
})

// ============================================================================
// APPEND TESTCASES MUTATION
// Bulk add testcases with deduplication
// ============================================================================

/**
 * Write-only atom to append multiple testcases from parsed data
 * - Adds new columns if they don't exist
 * - Removes duplicates by comparing JSON stringified data
 * @returns Count of rows actually added (after deduplication)
 */
export const appendTestcasesAtom = atom(
    null,
    (get, set, rows: Record<string, unknown>[]): number => {
        if (!rows.length) return 0

        const testsetId = get(currentTestsetIdAtom) || ""
        const columns = get(currentColumnsAtom)
        const serverIds = get(testcaseIdsAtom)
        const newIds = get(newEntityIdsAtom)

        // Get existing row data for deduplication
        const existingDataSet = new Set<string>()

        // Add server data (from entity atoms)
        for (const id of serverIds) {
            const entity = get(testcaseEntityAtomFamily(id))
            if (entity) {
                const dataOnly: Record<string, unknown> = {}
                for (const col of columns) {
                    dataOnly[col.key] = (entity as Record<string, unknown>)[col.key]
                }
                existingDataSet.add(JSON.stringify(dataOnly))
            }
        }

        // Add new entity data from drafts
        for (const id of newIds) {
            const draft = get(testcaseDraftAtomFamily(id))
            if (draft) {
                const dataOnly: Record<string, unknown> = {}
                for (const col of columns) {
                    dataOnly[col.key] = (draft as Record<string, unknown>)[col.key]
                }
                existingDataSet.add(JSON.stringify(dataOnly))
            }
        }

        // Add new columns from incoming data if they don't exist
        const existingColumnKeys = new Set(columns.map((c) => c.key))
        for (const row of rows) {
            for (const key of Object.keys(row)) {
                if (!existingColumnKeys.has(key)) {
                    set(addColumnAtom, key)
                    existingColumnKeys.add(key)
                }
            }
        }

        // Add rows that aren't duplicates
        let addedCount = 0
        for (const row of rows) {
            const rowDataStr = JSON.stringify(row)
            if (!existingDataSet.has(rowDataStr)) {
                const newRowId = `new-${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${addedCount}`
                const flattenedRow: FlattenedTestcase = {
                    id: newRowId,
                    testset_id: testsetId,
                    ...row,
                }

                // Add to new entity IDs (new architecture)
                set(addNewEntityIdAtom, newRowId)
                // Create draft for the new entity
                set(testcaseDraftAtomFamily(newRowId), flattenedRow)

                // Also add to old store for backward compatibility
                set(testcaseStore.createEntityAtom, flattenedRow)

                existingDataSet.add(rowDataStr)
                addedCount++
            }
        }

        return addedCount
    },
)
