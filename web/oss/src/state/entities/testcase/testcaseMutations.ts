import {atom} from "jotai"

import {addColumnAtom, currentColumnsAtom} from "./columnState"
import {testsetIdAtom} from "./queries"
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
    const testsetId = get(testsetIdAtom) || ""
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
// CREATE TESTCASES MUTATION
// Bulk create with full control (prefix, deduplication, etc.)
// ============================================================================

/**
 * Options for createTestcases mutation
 */
export interface CreateTestcasesOptions {
    /** Data rows to create as testcases */
    rows: Record<string, unknown>[]
    /** ID prefix (default: "new-") - use "local-" for drawer preview entities */
    prefix?: string
    /** Skip deduplication check (default: false) */
    skipDeduplication?: boolean
    /** Skip adding new columns from row keys (default: false) */
    skipColumnSync?: boolean
    /** Override testset ID (default: from testsetIdAtom) */
    testsetId?: string
}

/**
 * Result of createTestcases mutation
 */
export interface CreateTestcasesResult {
    /** IDs of created entities (in same order as input rows) */
    ids: string[]
    /** Number of entities created */
    count: number
    /** Number of rows skipped due to deduplication */
    skipped: number
}

/**
 * Write-only atom to create multiple testcases with full control
 *
 * Unlike appendTestcasesAtom, this provides:
 * - Custom ID prefix (for local/preview entities)
 * - Option to skip deduplication
 * - Option to skip column sync
 * - Returns created IDs for caller to track
 *
 * @example
 * ```typescript
 * const createTestcases = useSetAtom(createTestcasesAtom)
 * const result = createTestcases({
 *   rows: [{input: 'hello', output: 'world'}],
 *   prefix: 'local-',
 *   skipDeduplication: true,
 * })
 * // result.ids = ['local-1234567-0']
 * ```
 */
export const createTestcasesAtom = atom(
    null,
    (get, set, options: CreateTestcasesOptions): CreateTestcasesResult => {
        const {
            rows,
            prefix = "new-",
            skipDeduplication = false,
            skipColumnSync = false,
            testsetId: testsetIdOverride,
        } = options

        if (!rows.length) {
            return {ids: [], count: 0, skipped: 0}
        }

        const testsetId = testsetIdOverride ?? get(testsetIdAtom) ?? ""
        const columns = get(currentColumnsAtom)

        // Build deduplication set if needed
        let existingDataSet: Set<string> | null = null
        if (!skipDeduplication) {
            existingDataSet = new Set<string>()
            const serverIds = get(testcaseIdsAtom)
            const newIds = get(newEntityIdsAtom)

            // Add server data
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

            // Add new entity data
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
        }

        // Add new columns if needed
        if (!skipColumnSync) {
            const existingColumnKeys = new Set(columns.map((c) => c.key))
            for (const row of rows) {
                for (const key of Object.keys(row)) {
                    if (!existingColumnKeys.has(key)) {
                        set(addColumnAtom, key)
                        existingColumnKeys.add(key)
                    }
                }
            }
        }

        // Create entities
        const createdIds: string[] = []
        let skipped = 0
        const timestamp = Date.now()

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i]

            // Check deduplication
            if (existingDataSet) {
                const rowDataStr = JSON.stringify(row)
                if (existingDataSet.has(rowDataStr)) {
                    skipped++
                    continue
                }
                existingDataSet.add(rowDataStr)
            }

            const entityId = `${prefix}${timestamp}-${i}-${Math.random().toString(36).slice(2, 7)}`
            const flattenedRow: FlattenedTestcase = {
                id: entityId,
                testset_id: testsetId,
                ...row,
            }

            // Register and create draft
            set(addNewEntityIdAtom, entityId)
            set(testcaseDraftAtomFamily(entityId), flattenedRow)

            createdIds.push(entityId)
        }

        return {
            ids: createdIds,
            count: createdIds.length,
            skipped,
        }
    },
)

// ============================================================================
// APPEND TESTCASES MUTATION
// Bulk add testcases with deduplication (convenience wrapper)
// ============================================================================

/**
 * Write-only atom to append multiple testcases from parsed data
 * - Adds new columns if they don't exist
 * - Removes duplicates by comparing JSON stringified data
 * @returns Count of rows actually added (after deduplication)
 *
 * @deprecated Consider using createTestcasesAtom for more control
 */
export const appendTestcasesAtom = atom(
    null,
    (get, set, rows: Record<string, unknown>[]): number => {
        const result = set(createTestcasesAtom, {rows})
        return result.count
    },
)
