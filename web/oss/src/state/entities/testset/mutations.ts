import {atom} from "jotai"

import {
    patchTestsetRevision,
    type TestsetRevisionPatchOperations,
} from "@/oss/services/testsets/api"

import {
    clearPendingAddedColumnsAtom,
    clearPendingDeletedColumnsAtom,
    clearPendingRenamesAtom,
    currentColumnsAtom,
    pendingAddedColumnsAtom,
    pendingColumnRenamesAtom,
    pendingDeletedColumnsAtom,
    resetColumnsAtom,
} from "../testcase/columnState"
import {currentRevisionIdAtom, testsetNameQueryAtom} from "../testcase/queries"
import {unflattenTestcase} from "../testcase/schema"
import {
    clearDeletedIdsAtom,
    clearNewEntityIdsAtom,
    deletedEntityIdsAtom,
    discardAllDraftsAtom,
    newEntityIdsAtom,
    testcaseDraftAtomFamily,
    testcaseEntityAtomFamily,
    testcaseHasDraftAtomFamily,
    testcaseIdsAtom,
} from "../testcase/testcaseEntity"

import {revisionIsDirtyAtom, testsetNameChangedAtom} from "./dirtyState"
import {clearRevisionDraftAtom, revisionDraftAtomFamily} from "./revisionEntity"

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

        // Get testset name from draft or query
        const currentRevId = get(currentRevisionIdAtom)
        const draft = currentRevId ? get(revisionDraftAtomFamily(currentRevId)) : null
        const nameQuery = get(testsetNameQueryAtom)
        const testsetName = draft?.name ?? nameQuery.data ?? ""

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
            const descriptionChanged = get(revisionIsDirtyAtom)
            const description = draft?.description ?? ""

            // Build patch operations from local changes
            const operations: TestsetRevisionPatchOperations = {}
            const currentColumnKeys = new Set(columns.map((c) => c.key))

            // Get pending column operations
            const pendingRenames = get(pendingColumnRenamesAtom)
            const pendingAdded = get(pendingAddedColumnsAtom)
            const pendingDeleted = get(pendingDeletedColumnsAtom)

            // 0. Build column operations (applied to ALL testcases by backend)
            if (pendingRenames.size > 0 || pendingAdded.size > 0 || pendingDeleted.size > 0) {
                operations.columns = {}

                if (pendingRenames.size > 0) {
                    operations.columns.rename = Array.from(pendingRenames.entries()).map(
                        ([oldName, newName]) => ({old_name: oldName, new_name: newName}),
                    )
                }

                if (pendingAdded.size > 0) {
                    operations.columns.add = Array.from(pendingAdded)
                }

                if (pendingDeleted.size > 0) {
                    operations.columns.delete = Array.from(pendingDeleted)
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

            // Check if there are any operations to apply
            const hasColumnOperations =
                (operations.columns?.rename?.length ?? 0) > 0 ||
                (operations.columns?.add?.length ?? 0) > 0 ||
                (operations.columns?.delete?.length ?? 0) > 0
            const hasTestcaseOperations =
                (operations.update?.length ?? 0) > 0 ||
                (operations.create?.length ?? 0) > 0 ||
                (operations.delete?.length ?? 0) > 0

            if (
                !hasColumnOperations &&
                !hasTestcaseOperations &&
                !testsetNameChanged &&
                !descriptionChanged
            ) {
                return {success: true, newRevisionId: revisionId || undefined}
            }

            // Patch revision with delta changes
            const response = await patchTestsetRevision(
                testsetId,
                operations,
                commitMessage || undefined,
                revisionId ?? undefined,
                descriptionChanged ? description : undefined,
                testsetName, // Pass testset name as revision name
            )

            if (response?.testset_revision) {
                const newRevisionId = response.testset_revision.id as string

                // Clear local edit state (drafts)
                // Note: No need to update server state - page redirects to new revision
                // which triggers fresh fetch of revision entity data
                set(resetColumnsAtom)
                set(clearPendingRenamesAtom)
                set(clearPendingAddedColumnsAtom)
                set(clearPendingDeletedColumnsAtom)
                // Clear revision draft (name/description)
                if (currentRevId) {
                    set(clearRevisionDraftAtom, currentRevId)
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

            // Create new testset via simple API
            const {createNewTestset} = await import("@/oss/services/testsets/api")
            const response = await createNewTestset(testsetName, testcaseData)

            if (response.data?.revisionId) {
                // Clear local state after successful save
                set(resetColumnsAtom)
                set(clearPendingRenamesAtom)
                set(clearPendingAddedColumnsAtom)
                set(clearPendingDeletedColumnsAtom)
                set(discardAllDraftsAtom)
                set(clearNewEntityIdsAtom)
                set(clearDeletedIdsAtom)

                return {
                    success: true,
                    revisionId: response.data.revisionId,
                    testsetId: response.data.testset?.id,
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
export const clearChangesAtom = atom(null, (_get, set) => {
    // Reset column state
    set(resetColumnsAtom)
    set(clearPendingRenamesAtom)
    set(clearPendingAddedColumnsAtom)
    set(clearPendingDeletedColumnsAtom)

    // Reset metadata (name/description) - need to get current revision ID
    // Note: This is a simplified version - in practice the page redirects after save
    // so this is mainly for the discard changes flow

    // Clear new and deleted entity tracking
    set(clearNewEntityIdsAtom)
    set(clearDeletedIdsAtom)

    // Clear all drafts
    set(discardAllDraftsAtom)
})
