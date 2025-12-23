import {atom} from "jotai"

import {traceSpanAtomFamily, type TraceSpan} from "@/oss/state/entities/trace"

import type {Mapping, TestsetTraceData} from "../assets/types"

/**
 * Drawer State Atoms
 *
 * Clean state management for TestsetDrawer using Jotai atoms.
 * Eliminates useEffect dependency cycles by using derived atoms.
 * Integrates with the trace span entity system for cross-component access.
 */

// ============================================================================
// PRIMITIVE STATE ATOMS
// ============================================================================

/** Mapping configurations (trace paths -> testset columns) */
export const mappingDataAtom = atom<Mapping[]>([])

/** Trace data from observability/spans */
export const traceDataAtom = atom<TestsetTraceData[]>([])

/** Span IDs associated with current trace data (for entity lookup) */
export const traceSpanIdsAtom = atom<string[]>([])

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

// ============================================================================
// SPAN ENTITY INTEGRATION
// ============================================================================

/**
 * Derived: Get span entities from cache for current trace data
 * Returns spans that exist in the entity cache, keyed by span_id
 */
export const cachedSpansAtom = atom((get) => {
    const spanIds = get(traceSpanIdsAtom)
    const spans = new Map<string, TraceSpan>()

    for (const spanId of spanIds) {
        const span = get(traceSpanAtomFamily(spanId))
        if (span) {
            spans.set(spanId, span)
        }
    }

    return spans
})

/**
 * Derived: Get a specific span from the entity cache
 * Usage: const span = useAtomValue(spanByIdAtomFamily(spanId))
 */
export const spanByIdAtomFamily = traceSpanAtomFamily
