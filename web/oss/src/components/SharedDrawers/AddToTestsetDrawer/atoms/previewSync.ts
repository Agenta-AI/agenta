import {atom} from "jotai"

import {testcase} from "@/oss/state/entities/testcase"
import {currentColumnsAtom} from "@/oss/state/entities/testcase/columnState"
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
function _convertTraceDataWithMappings(
    traceData: TestsetTraceData[],
    mappings: {data: string; column: string; newColumn?: string}[],
    columns: {key: string; name: string}[],
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
            // Preserve objects/arrays as-is, only convert null/undefined to empty string
            formattedItem[targetKey] = value === undefined || value === null ? "" : value
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

    const _filteredTrace = get(filteredTraceDataAtom)
    const _mappings = get(mappingDataAtom)
    const _columns = get(currentColumnsAtom)

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
            set(testcase.actions.delete, oldPreviewIds)
        }

        // 3. Create new preview entities via testcase.actions.create
        // Use create instead of append to get IDs directly (cleaner than tracking before/after)
        if (previewData.length > 0) {
            const result = set(testcase.actions.create, {rows: previewData})
            set(previewEntityIdsAtom, result.ids)

            console.log("✅ [Sync] Updated preview entities:", result.count, "rows")
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
        set(testcase.actions.delete, previewIds)
        set(previewEntityIdsAtom, [])
    }
})
