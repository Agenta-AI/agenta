import {atom} from "jotai"

import {currentTestsetIdAtom} from "../testset/testsetMetadata"

import {addColumnAtom, currentColumnsAtom} from "./columnState"
import type {FlattenedTestcase} from "./schema"
import {
    addNewEntityIdAtom,
    markDeletedAtom,
    newEntityIdsAtom,
    removeNewEntityIdAtom,
    testcaseDraftAtomFamily,
    testcaseEntityAtomFamily,
    testcaseIdsAtom,
} from "./testcaseEntity"

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
        } else {
            // Mark as deleted
            set(markDeletedAtom, id)
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

    // Add to new entity IDs
    set(addNewEntityIdAtom, newRowId)
    // Create draft for the new entity
    set(testcaseDraftAtomFamily(newRowId), flattenedRow)

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

                // Add to new entity IDs
                set(addNewEntityIdAtom, newRowId)
                // Create draft for the new entity
                set(testcaseDraftAtomFamily(newRowId), flattenedRow)

                existingDataSet.add(rowDataStr)
                addedCount++
            }
        }

        return addedCount
    },
)
