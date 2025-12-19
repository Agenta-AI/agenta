import {atom} from "jotai"

import {testcasesRevisionIdAtom} from "@/oss/components/TestcasesTableNew/atoms/revisionContext"

import {currentColumnsAtom, hasColumnChangesAtom} from "../testcase/columnState"
import {
    deletedEntityIdsAtom,
    newEntityIdsAtom,
    testcaseDraftAtomFamily,
    testcaseIdsAtom,
    testcaseIsDirtyAtomFamily,
    testcaseServerStateAtomFamily,
} from "../testcase/testcaseEntity"

import {revisionHasDraftAtomFamily} from "./revisionEntity"

// ============================================================================
// REVISION-LEVEL DIRTY STATE
// Aggregates all changes for a revision (testcases + metadata + columns)
// ============================================================================

/**
 * Check if the current revision has any draft changes
 */
export const revisionIsDirtyAtom = atom((get) => {
    const revisionId = get(testcasesRevisionIdAtom)
    if (!revisionId) return false
    return get(revisionHasDraftAtomFamily(revisionId))
})

/**
 * Check if any metadata has changed (name/description via revision draft)
 */
export const hasMetadataChangesAtom = atom((get) => {
    const revisionId = get(testcasesRevisionIdAtom)
    if (!revisionId) return false
    return get(revisionHasDraftAtomFamily(revisionId))
})

/**
 * Check if name has changed (via revision draft)
 */
export const testsetNameChangedAtom = atom((get) => {
    // Name changes are tracked in revision draft - if draft exists with name, it's changed
    // For now, just check if revision has any draft (simplified)
    return get(hasMetadataChangesAtom)
})

/**
 * Check if any testcase has unsaved changes (cell edits only)
 */
export const hasAnyTestcaseDirtyAtom = atom((get) => {
    const serverIds = get(testcaseIdsAtom)

    for (const testcaseId of serverIds) {
        if (get(testcaseIsDirtyAtomFamily(testcaseId))) {
            return true
        }
    }
    return false
})

/**
 * Check if there are ANY unsaved changes in the testset/revision
 *
 * **Use this for save/discard confirmation dialogs.**
 *
 * Combines ALL types of changes:
 * - Cell edits (testcases with drafts)
 * - Column schema changes (add/rename/delete)
 * - New testcases
 * - Deleted testcases
 * - Metadata changes (name/description)
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
// CHANGES SUMMARY
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
    const descriptionChanged = get(revisionIsDirtyAtom) // Description is in revision draft

    // Count modified testcases (use the unified dirty check)
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
