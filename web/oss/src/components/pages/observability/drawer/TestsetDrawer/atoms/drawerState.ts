import {atom} from "jotai"

import type {Mapping, Preview, TestsetTraceData} from "../assets/types"

/**
 * Drawer State Atoms
 *
 * Clean state management for TestsetDrawer using Jotai atoms.
 * Eliminates useEffect dependency cycles by using derived atoms.
 */

// ============================================================================
// PRIMITIVE STATE ATOMS
// ============================================================================

/** Mapping configurations (trace paths -> testset columns) */
export const mappingDataAtom = atom<Mapping[]>([])

/** Trace data from observability/spans */
export const traceDataAtom = atom<TestsetTraceData[]>([])

/** Preview selection key ("all" or specific trace key) */
export const previewKeyAtom = atom<string>("all")

/** Current selected revision ID */
export const selectedRevisionIdAtom = atom<string>("")

/** Flag for duplicate column mappings */
export const hasDuplicateColumnsAtom = atom<boolean>(false)

/** Preview entity IDs (for cleanup) - stored in atom instead of useState */
export const previewEntityIdsAtom = atom<string[]>([])

// ============================================================================
// DERIVED ATOMS (READ-ONLY)
// ============================================================================

/**
 * Derived: Check if any valid mappings exist
 */
export const hasValidMappingsAtom = atom((get) => {
    const mappings = get(mappingDataAtom)
    return mappings.some((mapping) => {
        const targetKey =
            mapping.column === "create" || !mapping.column ? mapping.newColumn : mapping.column
        return !!targetKey
    })
})

/**
 * Derived: Filtered trace data based on preview selection
 */
export const filteredTraceDataAtom = atom((get) => {
    const traceData = get(traceDataAtom)
    const previewKey = get(previewKeyAtom)

    if (previewKey === "all") {
        return traceData
    }

    return traceData.filter((trace) => trace.key === previewKey)
})

/**
 * Derived: Active column names from mappings
 */
export const mappingColumnNamesAtom = atom((get) => {
    const mappings = get(mappingDataAtom)
    return mappings
        .map((m) => (m.column === "create" || !m.column ? m.newColumn : m.column))
        .filter((col): col is string => !!col)
})
