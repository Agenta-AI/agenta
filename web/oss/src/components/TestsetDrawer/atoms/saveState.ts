import {atom} from "jotai"

import {currentColumnsAtom} from "@/oss/state/entities/testcase/columnState"
import {getValueAtPath} from "@/oss/state/entities/trace"

import type {Mapping, TestsetTraceData} from "../assets/types"

import {isNewTestsetAtom} from "./cascaderState"
import {localColumnsAtom, mappingDataAtom, traceDataAtom} from "./drawerState"

/**
 * Save State Atoms
 *
 * Manages state related to saving testsets from the drawer.
 * Uses atoms to prevent prop drilling and enable reuse.
 */

// ============================================================================
// PRIMITIVE STATE ATOMS
// ============================================================================

/** Loading state for save operation */
export const isSavingAtom = atom<boolean>(false)

/** Commit message for new revision */
export const commitMessageAtom = atom<string>("")

/** Show confirm save modal */
export const showConfirmSaveAtom = atom<boolean>(false)

/** Local testset columns (for new testsets) - re-exported from drawerState */
export const localTestsetColumnsAtom = localColumnsAtom

/** Local testset rows (existing rows from selected testset) */
export const localTestsetRowsAtom = atom<Record<string, any>[]>([])

// ============================================================================
// DERIVED ATOMS
// ============================================================================

/**
 * Derived: Check if any new columns have been created
 */
export const hasNewColumnsAtom = atom((get) => {
    const columns = get(localColumnsAtom)
    return columns.some((col) => col.isNew)
})

/**
 * Derived: Get the first new column (for display in confirm modal)
 */
export const newColumnCreatedAtom = atom((get) => {
    const columns = get(localColumnsAtom)
    return columns.find((col) => col.isNew)
})

/**
 * Derived: Convert trace data to CSV format using current mappings
 * This is the core data transformation for saving
 */
export const formattedTestsetDataAtom = atom((get) => {
    const traceData = get(traceDataAtom)
    const mappingData = get(mappingDataAtom)
    const isNewTestset = get(isNewTestsetAtom)
    const localColumns = get(localColumnsAtom)
    const currentColumns = get(currentColumnsAtom)

    if (traceData.length === 0 || mappingData.length === 0) {
        return []
    }

    // Build duplicate column map
    const duplicateColumnMap = new Map<string, string[]>()
    mappingData.forEach((mapping) => {
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

    // Format trace data
    const formattedData = traceData.map((item) => {
        const formattedItem: Record<string, any> = {}

        for (const mapping of mappingData) {
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

        // Handle duplicate columns (merge values)
        duplicateColumns.forEach((dataPaths, columnName) => {
            const values = dataPaths
                .map((path) => {
                    const keys = path.split(".")
                    const value = keys.reduce((acc: any, key) => acc?.[key], item)
                    return value === undefined || value === null
                        ? ""
                        : typeof value === "string"
                          ? value
                          : JSON.stringify(value)
                })
                .filter((val) => val !== "")

            formattedItem[columnName] = values.length > 0 ? values.join(" | ") : ""
        })

        // Ensure all columns exist
        const columnsToCheck = isNewTestset
            ? localColumns.map((c) => c.column)
            : currentColumns.map((c) => c.key)

        for (const column of columnsToCheck) {
            if (!(column in formattedItem)) {
                formattedItem[column] = ""
            }
        }

        return formattedItem
    })

    return formattedData
})

/**
 * Derived: Get export data (formatted data + existing rows for non-new testsets)
 */
export const exportTestsetDataAtom = atom((get) => {
    const formattedData = get(formattedTestsetDataAtom)
    const isNewTestset = get(isNewTestsetAtom)
    const localRows = get(localTestsetRowsAtom)

    if (isNewTestset || localRows.length === 0) {
        return formattedData
    }

    // Add existing rows for export
    const allKeys = Array.from(new Set(formattedData.flatMap((item) => Object.keys(item))))

    const exportData = [...formattedData]
    localRows.forEach((row) => {
        const formattedRow: Record<string, any> = {}
        for (const key of allKeys) {
            formattedRow[key] = row[key] ?? ""
        }
        exportData.push(formattedRow)
    })

    return exportData
})

// ============================================================================
// ACTION ATOMS
// ============================================================================

/**
 * Reset local columns and rows
 */
export const resetLocalDataAtom = atom(null, (_get, set) => {
    set(localTestsetColumnsAtom, [])
    set(localTestsetRowsAtom, [])
})

/**
 * Helper to convert trace data using mappings (for external use)
 * This is a write atom that returns the converted data
 */
export const convertTraceDataAtom = atom(
    null,
    (
        get,
        _set,
        params: {
            traceData: TestsetTraceData[]
            mappings: Mapping[]
            columns: string[]
            existingRows?: Record<string, any>[]
        },
    ) => {
        const {traceData, mappings, columns, existingRows = []} = params

        // Build duplicate column map
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

        // Format trace data
        const formattedData = traceData.map((item) => {
            const formattedItem: Record<string, any> = {}

            for (const mapping of mappings) {
                const targetKey =
                    mapping.column === "create" || !mapping.column
                        ? mapping.newColumn
                        : mapping.column

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

            duplicateColumns.forEach((dataPaths, columnName) => {
                const values = dataPaths
                    .map((path) => {
                        const keys = path.split(".")
                        const value = keys.reduce((acc: any, key) => acc?.[key], item)
                        return value === undefined || value === null
                            ? ""
                            : typeof value === "string"
                              ? value
                              : JSON.stringify(value)
                    })
                    .filter((val) => val !== "")

                formattedItem[columnName] = values.length > 0 ? values.join(" | ") : ""
            })

            for (const column of columns) {
                if (!(column in formattedItem)) {
                    formattedItem[column] = ""
                }
            }

            return formattedItem
        })

        // Add existing rows if provided
        if (existingRows.length > 0) {
            const allKeys = Array.from(new Set(formattedData.flatMap((item) => Object.keys(item))))

            existingRows.forEach((row) => {
                const formattedRow: Record<string, any> = {}
                for (const key of allKeys) {
                    formattedRow[key] = row[key] ?? ""
                }
                formattedData.push(formattedRow)
            })
        }

        return formattedData
    },
)

// ============================================================================
// ACTION ATOMS
// ============================================================================

/**
 * Write atom: Reset all save-related state
 * Called when drawer closes or cascader changes
 */
export const resetSaveStateAtom = atom(null, (get, set) => {
    set(isSavingAtom, false)
    set(commitMessageAtom, "")
    set(showConfirmSaveAtom, false)
    set(localTestsetRowsAtom, [])
    set(localColumnsAtom, [])
})
