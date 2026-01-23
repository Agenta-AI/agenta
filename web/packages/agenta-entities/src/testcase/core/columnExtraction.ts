/**
 * Column Extraction Utilities
 *
 * Utilities for extracting column definitions from testcase row data.
 * Handles nested objects and JSON strings to discover column structure.
 *
 * @example
 * ```typescript
 * import { extractColumnsFromData, collectColumnPaths } from '@agenta/entities/testcase'
 *
 * // Extract columns from row data
 * const columns = extractColumnsFromData(rows, (row) => row.data)
 *
 * // Or collect paths manually
 * const pathMap = new Map()
 * collectColumnPaths(data, '', pathMap, 0)
 * ```
 */

import {isPlainObject, tryParseAsObject} from "@agenta/shared"

import {isSystemField} from "./schema"
import type {Column} from "./types"

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Maximum depth for nested column extraction
 * Beyond this depth, values are treated as leaf values
 */
export const COLUMN_EXTRACTION_MAX_DEPTH = 3

/**
 * Default number of rows to sample for column discovery
 */
export const DEFAULT_SAMPLE_SIZE = 20

// ============================================================================
// COLUMN PATH COLLECTION
// ============================================================================

/**
 * Column path info collected during traversal
 */
export interface ColumnPathInfo {
    /** Parent key path (undefined for top-level columns) */
    parentKey?: string
}

/**
 * Recursively collect column paths from nested objects.
 * Also handles JSON strings that represent objects.
 *
 * @param obj - Object to collect paths from
 * @param parentPath - Current path prefix
 * @param results - Map to store results (path -> info)
 * @param depth - Current recursion depth
 * @param maxDepth - Maximum depth to recurse (default: COLUMN_EXTRACTION_MAX_DEPTH)
 */
export function collectColumnPaths(
    obj: Record<string, unknown>,
    parentPath: string,
    results: Map<string, ColumnPathInfo>,
    depth: number,
    maxDepth: number = COLUMN_EXTRACTION_MAX_DEPTH,
): void {
    if (depth >= maxDepth) return

    for (const [key, value] of Object.entries(obj)) {
        // Skip system fields and private fields
        if (isSystemField(key) || key.startsWith("_")) continue

        const fullPath = parentPath ? `${parentPath}.${key}` : key

        // Check if value is already an object
        if (isPlainObject(value) && Object.keys(value).length > 0) {
            // Nested object - recurse into it
            collectColumnPaths(value, fullPath, results, depth + 1, maxDepth)
            continue
        }

        // Check if value is a JSON string that represents an object
        const parsedJson = typeof value === "string" ? tryParseAsObject(value) : null
        if (parsedJson && Object.keys(parsedJson).length > 0) {
            // JSON string containing object - recurse into parsed object
            collectColumnPaths(parsedJson, fullPath, results, depth + 1, maxDepth)
            continue
        }

        // Leaf value (primitive, array, empty object, or non-object JSON)
        results.set(fullPath, {parentKey: parentPath || undefined})
    }
}

// ============================================================================
// COLUMN EXTRACTION
// ============================================================================

/**
 * Options for column extraction
 */
export interface ExtractColumnsOptions {
    /** Maximum number of rows to sample (default: DEFAULT_SAMPLE_SIZE) */
    sampleSize?: number
    /** Maximum depth for nested extraction (default: COLUMN_EXTRACTION_MAX_DEPTH) */
    maxDepth?: number
}

/**
 * Extract columns from an array of data objects.
 * Samples rows to discover column structure, handling nested objects and JSON strings.
 *
 * @param data - Array of data objects to extract columns from
 * @param options - Extraction options
 * @returns Array of Column definitions compatible with groupColumns utility
 *
 * @example
 * ```typescript
 * const rows = [
 *   { id: '1', name: 'Test', config: { model: 'gpt-4' } },
 *   { id: '2', name: 'Test 2', config: { model: 'gpt-3.5' } },
 * ]
 * const columns = extractColumnsFromData(rows)
 * // Returns: [
 * //   { key: 'name', label: 'name' },
 * //   { key: 'config.model', label: 'model', parentKey: 'config' },
 * // ]
 * ```
 */
export function extractColumnsFromData(
    data: Record<string, unknown>[],
    options?: ExtractColumnsOptions,
): Column[] {
    const {sampleSize = DEFAULT_SAMPLE_SIZE, maxDepth = COLUMN_EXTRACTION_MAX_DEPTH} = options ?? {}

    const columnMap = new Map<string, ColumnPathInfo>()

    // Sample rows to discover columns
    for (const row of data.slice(0, sampleSize)) {
        if (!row) continue
        collectColumnPaths(row, "", columnMap, 0, maxDepth)
    }

    // Convert to Column[] (compatible with groupColumns utility)
    return Array.from(columnMap.entries()).map(([key, info]) => {
        const lastDot = key.lastIndexOf(".")
        const label = lastDot === -1 ? key : key.substring(lastDot + 1)
        return {key, label, parentKey: info.parentKey}
    })
}

/**
 * Extract columns from testcase rows with a custom data accessor.
 * Useful when rows have different structures (e.g., local vs server rows).
 *
 * @param rows - Array of rows to extract columns from
 * @param getDataSource - Function to extract data object from a row
 * @param options - Extraction options
 * @returns Array of Column definitions compatible with groupColumns utility
 *
 * @example
 * ```typescript
 * const columns = extractColumnsWithAccessor(
 *   rows,
 *   (row) => row.__isNew ? molecule.get.data(row.id) : row,
 *   { sampleSize: 10 }
 * )
 * ```
 */
export function extractColumnsWithAccessor<T>(
    rows: T[],
    getDataSource: (row: T) => Record<string, unknown> | null,
    options?: ExtractColumnsOptions,
): Column[] {
    const {sampleSize = DEFAULT_SAMPLE_SIZE, maxDepth = COLUMN_EXTRACTION_MAX_DEPTH} = options ?? {}

    const columnMap = new Map<string, ColumnPathInfo>()

    // Sample rows to discover columns
    for (const row of rows.slice(0, sampleSize)) {
        const dataSource = getDataSource(row)
        if (!dataSource) continue
        collectColumnPaths(dataSource, "", columnMap, 0, maxDepth)
    }

    // Convert to Column[] (compatible with groupColumns utility)
    return Array.from(columnMap.entries()).map(([key, info]) => {
        const lastDot = key.lastIndexOf(".")
        const label = lastDot === -1 ? key : key.substring(lastDot + 1)
        return {key, label, parentKey: info.parentKey}
    })
}
