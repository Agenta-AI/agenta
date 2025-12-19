import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {currentColumnsAtom, hasColumnChangesAtom} from "./columnState"
import type {FlattenedTestcase} from "./schema"
import {
    newEntityIdsAtom,
    deletedEntityIdsAtom,
    testcaseIsDirtyAtomFamily,
    testcaseIdsAtom,
    testcaseDraftAtomFamily,
    testcaseServerStateAtomFamily,
} from "./testcaseEntity"
import {
    descriptionChangedAtom,
    hasMetadataChangesAtom,
    testsetNameChangedAtom,
} from "./testsetMetadata"

// ============================================================================
// DIRTY STATE COMPUTATION
// Compares entity data vs server cache to determine if a testcase has changes
// Combines all dirty checks into a single source of truth
// ============================================================================

// Re-export currentColumnKeysAtom for backward compatibility
export {currentColumnKeysAtom} from "./columnState"

/**
 * System fields to exclude from dirty comparison
 */
const DIRTY_COMPARISON_EXCLUDE_FIELDS = new Set([
    "id",
    "key",
    "testset_id",
    "set_id",
    "created_at",
    "updated_at",
    "deleted_at",
    "created_by_id",
    "updated_by_id",
    "deleted_by_id",
    "flags",
    "tags",
    "meta",
    "__isSkeleton",
    "testcase_dedup_id",
])

/**
 * Helper function to check if a testcase is dirty
 * Extracted for reuse in both atomFamily and bulk check
 * Exported for use in callbacks where hooks can't be used
 */
export function checkTestcaseDirty(
    testcaseId: string,
    allEntities: Record<string, {data?: FlattenedTestcase; metadata?: {isDirty?: boolean}}>,
    serverDataMap: Map<string, FlattenedTestcase>,
    currentColumnKeys: Set<string>,
): boolean {
    if (!testcaseId) return false

    const entityData = allEntities[testcaseId]?.data
    const serverData = serverDataMap.get(testcaseId)

    // If entity doesn't exist in store, not dirty
    if (!entityData) return false

    // If server data doesn't exist, this is a new row - check if it has any data
    if (!serverData) {
        // New rows are dirty if they have any non-empty data in current columns
        for (const key of currentColumnKeys) {
            const value = (entityData as Record<string, unknown>)[key]
            if (value !== undefined && value !== null && value !== "") {
                return true
            }
        }
        return false
    }

    // Compare entity data vs server data for current column keys only
    for (const key of currentColumnKeys) {
        if (DIRTY_COMPARISON_EXCLUDE_FIELDS.has(key)) continue

        const entityValue = (entityData as Record<string, unknown>)[key]
        const serverValue = (serverData as Record<string, unknown>)[key]

        // Normalize undefined/null/"" to be equivalent for comparison
        const normalizedEntity = entityValue ?? ""
        const normalizedServer = serverValue ?? ""

        if (normalizedEntity !== normalizedServer) {
            return true
        }
    }

    return false
}

/**
 * Derived atomFamily to check if a specific testcase is dirty
 * Compares draft vs server state from query atom
 *
 * @param testcaseId - The ID of the testcase to check
 * @returns true if the testcase has unsaved changes, false otherwise
 */
export const isTestcaseDirtyAtomFamily = atomFamily((testcaseId: string) =>
    atom((get) => {
        // Use entity-level dirty check (compares draft vs query atom)
        return get(testcaseIsDirtyAtomFamily(testcaseId))
    }),
)

/**
 * Derived atom to check if any testcase is dirty (cell edits only)
 */
export const hasAnyTestcaseDirtyAtom = atom((get) => {
    const serverIds = get(testcaseIdsAtom)

    // Check all displayed testcases for dirty state
    for (const testcaseId of serverIds) {
        if (get(testcaseIsDirtyAtomFamily(testcaseId))) {
            return true
        }
    }
    return false
})

/**
 * Master atom that combines ALL dirty checks
 * This is the single source of truth for "has unsaved changes"
 */
export const hasUnsavedChangesAtom = atom((get) => {
    const newIds = get(newEntityIdsAtom)
    const deletedIds = get(deletedEntityIdsAtom)

    return (
        get(hasAnyTestcaseDirtyAtom) || // Cell edits (drafts)
        get(hasColumnChangesAtom) || // Column schema changes
        newIds.length > 0 || // New entities
        deletedIds.size > 0 || // Deleted entities
        get(hasMetadataChangesAtom) // Name/description changes
    )
})

// ============================================================================
// CHANGES SUMMARY (DERIVED)
// Provides a summary of all pending changes for the commit modal
// ============================================================================

/**
 * Type for changes summary
 */
export interface ChangesSummary {
    modifiedCount: number
    addedCount: number
    deletedCount: number
    nameChanged: boolean
    descriptionChanged: boolean
    originalData?: string
    modifiedData?: string
}

/**
 * Helper to extract only user data fields (exclude metadata)
 */
function extractUserFields(
    data: Record<string, unknown> | undefined,
    currentColumnKeys: Set<string>,
    useCurrentColumns = true,
): Record<string, unknown> {
    if (!data) return {}
    const metadataFields = new Set([
        "id",
        "key",
        "testset_id",
        "set_id",
        "created_at",
        "updated_at",
        "deleted_at",
        "created_by_id",
        "updated_by_id",
        "deleted_by_id",
        "flags",
        "tags",
        "meta",
        "__isSkeleton",
        "testcase_dedup_id",
    ])
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
        if (metadataFields.has(key)) continue
        if (useCurrentColumns && !currentColumnKeys.has(key)) continue
        result[key] = value
    }
    return result
}

/**
 * Derived atom: summary of all pending changes
 * Used by commit modal to show what will be saved
 */
export const changesSummaryAtom = atom((get): ChangesSummary => {
    const columns = get(currentColumnsAtom)
    const currentColumnKeys = new Set(columns.map((c) => c.key))
    const serverIds = get(testcaseIdsAtom)
    const newIds = get(newEntityIdsAtom)
    const deletedIds = get(deletedEntityIdsAtom)
    const nameChanged = get(testsetNameChangedAtom)
    const descriptionChanged = get(descriptionChangedAtom)

    // Count modified testcases (dirty entities - compare draft vs server)
    const modifiedCount = serverIds.filter((id) => {
        const isDirty = get(testcaseIsDirtyAtomFamily(id))
        return isDirty && !deletedIds.has(id)
    }).length

    // Count new testcases
    const addedCount = newIds.length

    // Count deleted testcases
    const deletedCount = deletedIds.size

    // Build diff data - show only meaningful field changes
    let originalData: string | undefined
    let modifiedData: string | undefined

    // Collect changes for diff view
    const originalChanges: Record<string, unknown>[] = []
    const modifiedChanges: Record<string, unknown>[] = []

    // Modified testcases - show original vs modified
    serverIds.forEach((id) => {
        const isDirty = get(testcaseIsDirtyAtomFamily(id))
        if (isDirty && !deletedIds.has(id)) {
            const serverState = get(testcaseServerStateAtomFamily(id))
            const draft = get(testcaseDraftAtomFamily(id))
            const originalFields = extractUserFields(
                serverState as Record<string, unknown>,
                currentColumnKeys,
                false,
            )
            const modifiedFields = extractUserFields(
                draft as Record<string, unknown>,
                currentColumnKeys,
                true,
            )
            originalChanges.push({_type: "modified", ...originalFields})
            modifiedChanges.push({_type: "modified", ...modifiedFields})
        }
    })

    // New testcases
    newIds.forEach((id) => {
        const draft = get(testcaseDraftAtomFamily(id))
        const fields = extractUserFields(draft as Record<string, unknown>, currentColumnKeys)
        modifiedChanges.push({_type: "added", ...fields})
    })

    // Deleted testcases
    deletedIds.forEach((id) => {
        const serverState = get(testcaseServerStateAtomFamily(id))
        const originalFields = extractUserFields(
            serverState as Record<string, unknown>,
            currentColumnKeys,
        )
        originalChanges.push({_type: "deleted", ...originalFields})
    })

    // Only show diff if there are testcase changes
    if (originalChanges.length > 0 || modifiedChanges.length > 0) {
        originalData = JSON.stringify(originalChanges, null, 2)
        modifiedData = JSON.stringify(modifiedChanges, null, 2)
    }

    return {
        modifiedCount,
        addedCount,
        deletedCount,
        nameChanged,
        descriptionChanged,
        originalData,
        modifiedData,
    }
})
