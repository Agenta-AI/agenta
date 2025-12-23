import {atom} from "jotai"

import {revisionHasDraftAtomFamily} from "../testset/revisionEntity"

import {
    pendingAddedColumnsAtom,
    pendingColumnRenamesAtom,
    pendingDeletedColumnsAtom,
} from "./columnState"
import {currentRevisionIdAtom} from "./queries"
import {
    deletedEntityIdsAtom,
    newEntityIdsAtom,
    testcaseIdsAtom,
    testcaseIsDirtyAtomFamily,
} from "./testcaseEntity"

// ============================================================================
// CONSOLIDATED DIRTY STATE
// Single source of truth for all unsaved changes
// ============================================================================

/**
 * Consolidated dirty state structure
 * Single source of truth for checking "has unsaved changes?"
 */
export interface ConsolidatedDirtyState {
    /** IDs of testcases with unsaved edits */
    modifiedTestcaseIds: Set<string>
    /** IDs of newly created testcases (not yet saved) */
    newTestcaseIds: Set<string>
    /** IDs of deleted testcases (soft delete, pending save) */
    deletedTestcaseIds: Set<string>

    /** Column changes */
    columns: {
        added: Set<string>
        renamed: Map<string, string>
        deleted: Set<string>
    }

    /** Metadata changes (tracked separately in testset dirty state) */
    metadata: {
        nameChanged: boolean
        descriptionChanged: boolean
    }
}

/**
 * Derived atom that consolidates all dirty state into a single structure
 * This is the single source of truth for checking if there are unsaved changes
 *
 * Benefits:
 * - Single atom subscription instead of multiple
 * - Easy to check "has changes?"
 * - Clear overview of all pending changes
 */
export const consolidatedDirtyStateAtom = atom<ConsolidatedDirtyState>((get) => {
    // Get all testcase IDs currently loaded
    const allTestcaseIds = get(testcaseIdsAtom)
    const newIds = get(newEntityIdsAtom)
    const deletedIds = get(deletedEntityIdsAtom)

    // Find modified testcases (have draft state)
    const modifiedIds = new Set<string>()
    allTestcaseIds.forEach((id) => {
        // Skip new and deleted testcases
        if (newIds.includes(id) || deletedIds.has(id)) return

        // Check if this testcase has unsaved changes
        if (get(testcaseIsDirtyAtomFamily(id))) {
            modifiedIds.add(id)
        }
    })

    // Get column changes
    const addedColumns = get(pendingAddedColumnsAtom)
    const renamedColumns = get(pendingColumnRenamesAtom)
    const deletedColumns = get(pendingDeletedColumnsAtom)

    // Check metadata changes (name/description)
    const revisionId = get(currentRevisionIdAtom)
    const hasMetadataChanges = revisionId ? get(revisionHasDraftAtomFamily(revisionId)) : false

    return {
        modifiedTestcaseIds: modifiedIds,
        newTestcaseIds: new Set(newIds),
        deletedTestcaseIds: deletedIds,
        columns: {
            added: addedColumns,
            renamed: renamedColumns,
            deleted: deletedColumns,
        },
        metadata: {
            // Metadata changes are tracked via revision draft
            // If revision has draft, then name/description may have changed
            nameChanged: hasMetadataChanges,
            descriptionChanged: hasMetadataChanges,
        },
    }
})

/**
 * Derived atom: Does the testcase data have any unsaved changes?
 * (Excludes metadata changes like name/description)
 *
 * Use this for a quick "has changes?" check
 */
export const hasUnsavedTestcaseChangesAtom = atom((get) => {
    const state = get(consolidatedDirtyStateAtom)

    return (
        state.modifiedTestcaseIds.size > 0 ||
        state.newTestcaseIds.size > 0 ||
        state.deletedTestcaseIds.size > 0 ||
        state.columns.added.size > 0 ||
        state.columns.renamed.size > 0 ||
        state.columns.deleted.size > 0
    )
})

/**
 * Derived atom: Total count of unsaved changes
 * Useful for showing "X unsaved changes" in UI
 */
export const unsavedChangesCountAtom = atom((get) => {
    const state = get(consolidatedDirtyStateAtom)

    return (
        state.modifiedTestcaseIds.size +
        state.newTestcaseIds.size +
        state.deletedTestcaseIds.size +
        state.columns.added.size +
        state.columns.renamed.size +
        state.columns.deleted.size
    )
})

/**
 * Derived atom: Summary of changes for display
 * Returns a human-readable summary like "2 modified, 3 new, 1 deleted"
 */
export const changesSummaryTextAtom = atom((get) => {
    const state = get(consolidatedDirtyStateAtom)

    const parts: string[] = []

    if (state.modifiedTestcaseIds.size > 0) {
        parts.push(`${state.modifiedTestcaseIds.size} modified`)
    }
    if (state.newTestcaseIds.size > 0) {
        parts.push(`${state.newTestcaseIds.size} new`)
    }
    if (state.deletedTestcaseIds.size > 0) {
        parts.push(`${state.deletedTestcaseIds.size} deleted`)
    }

    const columnChanges =
        state.columns.added.size + state.columns.renamed.size + state.columns.deleted.size
    if (columnChanges > 0) {
        parts.push(`${columnChanges} column change${columnChanges > 1 ? "s" : ""}`)
    }

    if (parts.length === 0) return "No changes"

    return parts.join(", ")
})

/**
 * Example usage in components:
 *
 * ```tsx
 * // Simple dirty check
 * const hasChanges = useAtomValue(hasUnsavedTestcaseChangesAtom)
 *
 * // Show count
 * const count = useAtomValue(unsavedChangesCountAtom)
 *
 * // Show summary
 * const summary = useAtomValue(changesSummaryTextAtom)
 *
 * // Get full state for detailed display
 * const dirtyState = useAtomValue(consolidatedDirtyStateAtom)
 * console.log(`Modified IDs: ${Array.from(dirtyState.modifiedTestcaseIds)}`)
 * ```
 */
