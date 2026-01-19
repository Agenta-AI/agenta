/**
 * InputMappingModal Utilities
 *
 * Helper functions for input mapping operations.
 */

import type {InputMapping, PathInfo} from "@agenta/entities/runnable"
import {MagicWand, Warning} from "@phosphor-icons/react"

import type {MappingStatusInfo} from "./types"

// ============================================================================
// STATUS HELPERS
// ============================================================================

/**
 * Get status indicator for a mapping
 */
export function getMappingStatus(
    mapping: InputMapping | undefined,
    isRequired: boolean,
): MappingStatusInfo {
    if (!mapping) {
        return isRequired
            ? {color: "red", label: "Missing", icon: <Warning size={12} />}
            : {color: "default", label: "Optional", icon: null}
    }

    if (mapping.status === "missing_source") {
        return {color: "red", label: "Invalid Path", icon: <Warning size={12} />}
    }

    if (mapping.status === "type_mismatch") {
        return {color: "orange", label: "Type Mismatch", icon: <Warning size={12} />}
    }

    if (mapping.isAutoMapped) {
        return {color: "blue", label: "Auto", icon: <MagicWand size={12} />}
    }

    return {color: "green", label: "Manual", icon: null}
}

// ============================================================================
// PATH EXTRACTION
// ============================================================================

/**
 * Extract paths from an object value recursively
 * Returns PathInfo objects for each discoverable path in the data
 */
export function extractPathsFromValue(value: unknown, prefix = "", maxDepth = 3): PathInfo[] {
    const paths: PathInfo[] = []

    if (maxDepth <= 0) return paths

    if (value === null || value === undefined) {
        return paths
    }

    if (Array.isArray(value)) {
        // For arrays, add the array itself as a path
        const pathString = prefix || "output"
        paths.push({
            path: pathString,
            pathString,
            label: prefix.split(".").pop() || "output",
            type: "array",
            valueType: "array",
            source: "output",
        })
        // Also extract from first item if it's an object
        if (value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
            const itemPaths = extractPathsFromValue(
                value[0],
                prefix ? `${prefix}.0` : "0",
                maxDepth - 1,
            )
            paths.push(...itemPaths)
        }
    } else if (typeof value === "object") {
        // For objects, add each property as a path
        for (const [key, val] of Object.entries(value)) {
            const currentPath = prefix ? `${prefix}.${key}` : key
            let valueType = "unknown"

            if (val === null || val === undefined) {
                valueType = "unknown"
            } else if (Array.isArray(val)) {
                valueType = "array"
            } else if (typeof val === "object") {
                valueType = "object"
            } else if (typeof val === "string") {
                valueType = "string"
            } else if (typeof val === "number") {
                valueType = "number"
            } else if (typeof val === "boolean") {
                valueType = "boolean"
            }

            paths.push({
                path: currentPath,
                pathString: currentPath,
                label: key,
                type: valueType,
                valueType,
                source: "output",
                sampleValue: val,
            })

            // Recursively extract from nested objects
            if (typeof val === "object" && val !== null && !Array.isArray(val)) {
                const nestedPaths = extractPathsFromValue(val, currentPath, maxDepth - 1)
                paths.push(...nestedPaths)
            }
        }
    } else {
        // Primitive value at root
        let valueType = "unknown"
        if (typeof value === "string") valueType = "string"
        else if (typeof value === "number") valueType = "number"
        else if (typeof value === "boolean") valueType = "boolean"

        const pathString = prefix || "output"
        paths.push({
            path: pathString,
            pathString,
            label: prefix.split(".").pop() || "output",
            type: valueType,
            valueType,
            source: "output",
            sampleValue: value,
        })
    }

    return paths
}

// ============================================================================
// PATH BUILDING
// ============================================================================

/**
 * Build available paths from source output, testcase columns, and discovered paths
 */
export function buildAvailablePaths(
    sourceOutputPaths: PathInfo[] | undefined,
    testcaseColumns: {key: string; name?: string; type?: string}[],
    discoveredPaths: PathInfo[] = [],
): PathInfo[] {
    const paths: PathInfo[] = []
    const seenPaths = new Set<string>()

    // Add paths from upstream output (schema-based)
    if (sourceOutputPaths) {
        sourceOutputPaths.forEach((p) => {
            const pathKey = p.pathString || p.path
            if (!seenPaths.has(pathKey)) {
                seenPaths.add(pathKey)
                paths.push(p)
            }
        })
    }

    // Add discovered paths from test run (with actual values)
    discoveredPaths.forEach((p) => {
        const pathKey = p.pathString || p.path
        if (!seenPaths.has(pathKey)) {
            seenPaths.add(pathKey)
            paths.push(p)
        }
    })

    // Add testcase columns as source paths
    testcaseColumns.forEach((col) => {
        const pathString = `testcase.${col.key}`
        if (seenPaths.has(pathString)) return

        let valueType = "unknown"
        if (col.type === "integer") {
            valueType = "number"
        } else if (col.type) {
            valueType = col.type
        }
        seenPaths.add(pathString)
        paths.push({
            path: pathString,
            pathString,
            label: col.name || col.key,
            type: valueType,
            valueType,
            source: "testcase",
        })
    })

    return paths
}
