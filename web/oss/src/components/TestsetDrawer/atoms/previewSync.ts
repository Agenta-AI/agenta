import {atom} from "jotai"

import {currentColumnsAtom} from "@/oss/state/entities/testcase/columnState"
import {
    appendTestcasesAtom,
    deleteTestcasesAtom,
} from "@/oss/state/entities/testcase/mutations"
import {newEntityIdsAtom} from "@/oss/state/entities/testcase/testcaseEntity"
import {currentRevisionIdAtom} from "@/oss/state/entities/testset"

import type {TestsetTraceData} from "../assets/types"
import {
    filteredTraceDataAtom,
    hasDuplicateColumnsAtom,
    hasValidMappingsAtom,
    mappingDataAtom,
    previewEntityIdsAtom,
    selectedRevisionIdAtom as drawerRevisionIdAtom,
} from "./drawerState"

/**
 * Preview Sync Atoms
 *
 * Handles syncing preview data from mappings to entity atoms.
 * Write-only atoms provide a clean API for triggering updates.
 */

/**
 * Helper: Convert trace data using mappings
 * This is the core conversion logic extracted from the component
 */
function convertTraceDataWithMappings(
    traceData: TestsetTraceData[],
    mappings: Array<{data: string; column: string; newColumn?: string}>,
    columns: Array<{key: string; name: string}>,
    getValueAtPath: (obj: any, path: string) => any,
): Record<string, any>[] {
    if (mappings.length === 0 || traceData.length === 0) {
        return []
    }

    // Identify duplicate columns
    const duplicateColumnMap = new Map<string, string[]>()
    mappings.forEach((mapping) => {
        const targetKey =
            mapping.column === "create" || !mapping.column ? mapping.newColumn : mapping.column

        if (targetKey) {
            if (!duplicateColumnMap.has(targetKey)) {
                duplicateColumnMap.set(targetKey, [mapping.data])
            } else {
                duplicateColumnMap.get(targetKey)!.push(mapping.data)
            }
        }
    })

    const duplicateColumns = new Map(
        Array.from(duplicateColumnMap.entries()).filter(([_, paths]) => paths.length > 1),
    )

    // Convert each trace item
    return traceData.map((item) => {
        const formattedItem: Record<string, any> = {}

        // Apply mappings (skip duplicates)
        for (const mapping of mappings) {
            const targetKey =
                mapping.column === "create" || !mapping.column ? mapping.newColumn : mapping.column

            if (!targetKey || duplicateColumns.has(targetKey)) {
                continue
            }

            const value = getValueAtPath(item, mapping.data)
            formattedItem[targetKey] =
                value === undefined || value === null
                    ? ""
                    : typeof value === "string"
                      ? value
                      : JSON.stringify(value)
        }

        // Ensure all columns exist (fill with empty strings)
        const columnsToCheck = columns.map((c) => c.key)
        for (const column of columnsToCheck) {
            if (!(column in formattedItem)) {
                formattedItem[column] = ""
            }
        }

        return formattedItem
    })
}

/**
 * Derived: Converted preview data ready for entities
 * This atom computes the preview data from mappings + trace data
 */
export const previewDataAtom = atom((get) => {
    const hasDuplicates = get(hasDuplicateColumnsAtom)
    const hasValidMappings = get(hasValidMappingsAtom)

    if (hasDuplicates || !hasValidMappings) {
        return []
    }

    const filteredTrace = get(filteredTraceDataAtom)
    const mappings = get(mappingDataAtom)
    const columns = get(currentColumnsAtom)

    // We need getValueAtPath from the component - for now return empty
    // This will be filled in when we integrate with the component
    return []
})

/**
 * Write-only atom: Sync preview data to entity atoms
 *
 * Call this atom to trigger a sync of current preview data to entities.
 * Handles cleanup of old preview entities and creation of new ones.
 *
 * Usage:
 *   const syncPreview = useSetAtom(syncPreviewToEntitiesAtom)
 *   syncPreview(previewData)
 */
export const syncPreviewToEntitiesAtom = atom(
    null,
    (get, set, previewData: Record<string, any>[]) => {
        // Guard: Don't sync if invalid
        if (get(hasDuplicateColumnsAtom) || !get(hasValidMappingsAtom)) {
            return
        }

        // 1. Set revision context FIRST
        const revisionId = get(drawerRevisionIdAtom) || "draft"
        set(currentRevisionIdAtom, revisionId)

        // 2. Clean up old preview entities
        const oldPreviewIds = get(previewEntityIdsAtom)
        if (oldPreviewIds.length > 0) {
            set(deleteTestcasesAtom, oldPreviewIds)
        }

        // 3. Get baseline entity IDs (before append)
        const baselineNewIds = new Set(get(newEntityIdsAtom))

        // 4. Append new preview data to entities
        if (previewData.length > 0) {
            set(appendTestcasesAtom, previewData)

            // 5. Track new entity IDs as preview IDs
            const updatedIds = get(newEntityIdsAtom)
            const appendedIds = updatedIds.filter((id) => !baselineNewIds.has(id))
            set(previewEntityIdsAtom, appendedIds)

            console.log("✅ [Sync] Updated preview entities:", appendedIds.length, "rows")
        } else {
            set(previewEntityIdsAtom, [])
        }
    },
)

/**
 * Write-only atom: Clear preview entities
 *
 * Call this to clean up preview entities (e.g., on drawer close)
 */
export const clearPreviewEntitiesAtom = atom(null, (get, set) => {
    const previewIds = get(previewEntityIdsAtom)
    if (previewIds.length > 0) {
        set(deleteTestcasesAtom, previewIds)
        set(previewEntityIdsAtom, [])
    }
})
