import type {TraceSpan, TraceSpanNode} from "./schema"

/**
 * Trace Entity Selectors
 *
 * Reusable selectors and helpers for extracting data from trace spans.
 * These are commonly used patterns across observability features.
 */

// ============================================================================
// PATH EXTRACTION UTILITIES
// ============================================================================

/**
 * Standard data path prefixes for trace spans
 */
export const TRACE_DATA_PATHS = {
    INPUTS: "data.inputs",
    OUTPUTS: "data.outputs",
    INTERNALS: "data.internals",
    DATA: "data",
} as const

/**
 * Split a dot-notation path, handling escaped dots
 */
const splitPath = (path: string): string[] =>
    path.split(/(?<!\\)\./g).map((p) => p.replace(/\\\./g, "."))

/**
 * Get a value from an object using dot-notation path
 * Handles nested objects and escaped dots in keys
 */
export const getValueAtPath = (obj: any, rawPath: string): any => {
    if (obj == null || !rawPath) return undefined

    // Quick direct hit (entire path is a literal key on the current object)
    if (Object.prototype.hasOwnProperty.call(obj, rawPath)) return obj[rawPath]

    const parts = splitPath(rawPath)
    let cur: any = obj

    for (let i = 0; i < parts.length; i++) {
        if (cur == null) return undefined

        const key = parts[i]

        if (Object.prototype.hasOwnProperty.call(cur, key)) {
            cur = cur[key]
            continue
        }

        // Fallback: treat the remaining segments as one literal key containing dots
        const remainder = parts.slice(i).join(".")
        if (Object.prototype.hasOwnProperty.call(cur, remainder)) {
            return cur[remainder]
        }

        return undefined
    }

    return cur
}

/**
 * Collect all key paths from an object recursively
 * Special handling for 'outputs' key (doesn't recurse into it)
 * Only returns leaf paths (primitives/arrays) by default
 * Set includeObjectPaths=true to also include intermediate object paths
 */
export const collectKeyPaths = (obj: any, prefix = "", includeObjectPaths = false): string[] => {
    const paths: string[] = []
    if (!obj || typeof obj !== "object") return paths

    for (const [key, value] of Object.entries(obj)) {
        const fullPath = prefix ? `${prefix}.${key}` : key

        // Don't recurse into outputs - treat as single value
        if (key === "outputs") {
            paths.push(fullPath)
            continue
        }

        if (value && typeof value === "object" && !Array.isArray(value)) {
            // Optionally add the object path itself (for mapping entire objects)
            if (includeObjectPaths) {
                paths.push(fullPath)
            }
            // Also add nested paths
            const nestedPaths = collectKeyPaths(value, fullPath, includeObjectPaths)
            paths.push(...nestedPaths)
        } else {
            paths.push(fullPath)
        }
    }

    return paths
}

/**
 * Filter paths to only include input/output/internals data paths
 */
export const filterDataPaths = (paths: string[]): string[] => {
    return paths.filter(
        (path) =>
            path.startsWith(TRACE_DATA_PATHS.INPUTS) ||
            path === TRACE_DATA_PATHS.OUTPUTS ||
            path.startsWith(`${TRACE_DATA_PATHS.OUTPUTS}.`) ||
            path.startsWith(TRACE_DATA_PATHS.INTERNALS),
    )
}

/**
 * Extract the column name from a data path
 * e.g., "data.inputs.question" -> "question"
 *       "data.outputs" -> "outputs"
 */
export const getColumnNameFromPath = (path: string): string => {
    return path.split(".").pop() || path
}

// ============================================================================
// SPAN DATA EXTRACTION
// ============================================================================

/**
 * Extract input data from a span's attributes
 */
export const extractInputs = (span: TraceSpan | TraceSpanNode | null): Record<string, any> => {
    if (!span?.attributes) return {}

    const agData = (span.attributes as any)?.["ag.data"] || (span.attributes as any)?.ag?.data
    return agData?.inputs || {}
}

/**
 * Extract output data from a span's attributes
 */
export const extractOutputs = (span: TraceSpan | TraceSpanNode | null): any => {
    if (!span?.attributes) return undefined

    const agData = (span.attributes as any)?.["ag.data"] || (span.attributes as any)?.ag?.data
    return agData?.outputs
}

/**
 * Extract internals data from a span's attributes
 */
export const extractInternals = (span: TraceSpan | TraceSpanNode | null): Record<string, any> => {
    if (!span?.attributes) return {}

    const agData = (span.attributes as any)?.["ag.data"] || (span.attributes as any)?.ag?.data
    return agData?.internals || {}
}

/**
 * Extract all ag.data from a span's attributes
 */
export const extractAgData = (span: TraceSpan | TraceSpanNode | null): Record<string, any> => {
    if (!span?.attributes) return {}

    return (span.attributes as any)?.["ag.data"] || (span.attributes as any)?.ag?.data || {}
}

/**
 * Convert span data to the format used by TestsetDrawer
 * Returns all ag.data fields (inputs, outputs, parameters, internals, etc.)
 */
export const spanToTraceData = (
    span: TraceSpan | TraceSpanNode,
    index: number,
): {key: string; data: Record<string, any>; id: number} => {
    const agData = extractAgData(span)

    return {
        key: span.span_id,
        id: index + 1,
        data: agData,
    }
}

/**
 * Extract testset-relevant data from ag.data
 * Only includes inputs and outputs - excludes parameters, internals, etc.
 * This ensures consistent data shape between playground and observability
 *
 * Accepts any span-like object with attributes property
 */
export const extractTestsetData = (
    span: {attributes?: any} | null | undefined,
): Record<string, any> | null => {
    if (!span) return null

    // Extract ag.data from attributes (handles both formats)
    const agData =
        (span.attributes as any)?.["ag.data"] || (span.attributes as any)?.ag?.data || null

    if (!agData) return null

    return {
        inputs: agData.inputs || {},
        outputs: agData.outputs,
    }
}

// ============================================================================
// ATOM FAMILIES FOR SPAN DATA ACCESS
// ============================================================================

// Note: Atom families that depend on traceSpanAtomFamily are defined in store.ts
// to avoid circular dependencies. Import them from the main index.ts:
//
// import { spanInputsAtomFamily, spanOutputsAtomFamily, spanAgDataAtomFamily } from "@/oss/state/entities/trace"
//
// These are created using the extraction functions defined above.

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Collect all unique data paths from multiple spans
 */
export const collectPathsFromSpans = (spans: (TraceSpan | TraceSpanNode)[]): string[] => {
    const uniquePaths = new Set<string>()

    for (const span of spans) {
        const agData = extractAgData(span)
        if (agData) {
            const paths = collectKeyPaths(agData, "data")
            paths.forEach((path) => uniquePaths.add(path))
        }
    }

    return Array.from(uniquePaths)
}

/**
 * Collect filtered data paths (inputs/outputs/internals) from multiple spans
 */
export const collectDataPathsFromSpans = (spans: (TraceSpan | TraceSpanNode)[]): string[] => {
    const allPaths = collectPathsFromSpans(spans)
    return filterDataPaths(allPaths)
}

/**
 * Convert data paths to select options format
 */
export const pathsToSelectOptions = (paths: string[]): {value: string; label: string}[] => {
    return paths.map((path) => ({value: path, label: path}))
}

// ============================================================================
// AUTO-MAPPING HELPERS
// ============================================================================

/**
 * Suggested column name mappings for common output paths
 */
export const COLUMN_NAME_MAPPINGS: Record<string, string> = {
    outputs: "correct_answer",
}

/**
 * Get suggested column name for a data path
 * Returns the last segment of the path, with special handling for known mappings
 */
export const getSuggestedColumnName = (path: string): string => {
    const columnName = getColumnNameFromPath(path)
    return COLUMN_NAME_MAPPINGS[columnName] || columnName
}

/**
 * Auto-generate mapping suggestions from data paths
 * Returns array of { data: path, suggestedColumn: columnName }
 */
export const generateMappingSuggestions = (
    paths: string[],
): {data: string; suggestedColumn: string}[] => {
    return paths.map((path) => ({
        data: path,
        suggestedColumn: getSuggestedColumnName(path),
    }))
}

/**
 * Match suggested columns with existing testset columns
 * Returns mappings with matched or suggested column names
 */
export const matchColumnsWithSuggestions = (
    suggestions: {data: string; suggestedColumn: string}[],
    existingColumns: string[],
): {data: string; column: string; isNew: boolean}[] => {
    const existingColumnsLower = new Set(existingColumns.map((c) => c.toLowerCase()))

    return suggestions.map(({data, suggestedColumn}) => {
        const suggestedLower = suggestedColumn.toLowerCase()

        // Find exact case match in existing columns
        const matchedColumn = existingColumns.find((col) => col.toLowerCase() === suggestedLower)

        if (matchedColumn) {
            return {data, column: matchedColumn, isNew: false}
        }

        // Check if suggested column already exists (case-insensitive)
        if (existingColumnsLower.has(suggestedLower)) {
            const existing = existingColumns.find((c) => c.toLowerCase() === suggestedLower)
            return {data, column: existing || suggestedColumn, isNew: false}
        }

        // New column
        return {data, column: suggestedColumn, isNew: true}
    })
}
