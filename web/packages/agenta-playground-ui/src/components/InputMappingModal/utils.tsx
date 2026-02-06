/**
 * InputMappingModal Utilities
 *
 * Helper functions for input mapping operations.
 * Uses shared utilities from @agenta/shared for core logic.
 */

import type {InputMapping, PathInfo} from "@agenta/entities/runnable"
import {
    determineMappingStatus,
    getMappingStatusConfig,
    extractTypedPaths,
    combineTypedPaths,
    buildTestcaseColumnPaths,
    type MappingStatus,
} from "@agenta/shared/utils"
import {MagicWand, Warning} from "@phosphor-icons/react"

import type {MappingStatusInfo} from "./types"

// ============================================================================
// STATUS HELPERS
// ============================================================================

/**
 * Get icon for a mapping status
 */
function getStatusIcon(status: MappingStatus, size: number): React.ReactNode {
    switch (status) {
        case "auto":
            return <MagicWand size={size} />
        case "missing":
        case "invalid_path":
        case "type_mismatch":
            return <Warning size={size} />
        default:
            return null
    }
}

/**
 * Get status indicator for a mapping
 * Uses shared determineMappingStatus for core logic, adds React icons for UI
 */
export function getMappingStatus(
    mapping: InputMapping | undefined,
    isRequired: boolean,
): MappingStatusInfo {
    const status = determineMappingStatus(mapping, isRequired)
    const config = getMappingStatusConfig(status)

    // Map shared color to component color type
    const colorMap: Record<string, MappingStatusInfo["color"]> = {
        blue: "blue",
        green: "green",
        red: "red",
        orange: "orange",
        gray: "default",
    }

    return {
        color: colorMap[config.color] || "default",
        label: config.label,
        icon: getStatusIcon(status, 12),
    }
}

// ============================================================================
// PATH EXTRACTION
// ============================================================================

/**
 * Extract paths from an object value recursively
 * Returns PathInfo objects for each discoverable path in the data
 *
 * Uses extractTypedPaths from @agenta/shared for core logic
 */
export function extractPathsFromValue(value: unknown, prefix = "", maxDepth = 3): PathInfo[] {
    // Use shared utility for extraction
    const typedPaths = extractTypedPaths(value, {
        prefix,
        maxDepth,
        source: "output",
        includeSampleValues: true,
    })

    // Convert TypedPathInfo to PathInfo (they're compatible)
    return typedPaths as PathInfo[]
}

// ============================================================================
// PATH BUILDING
// ============================================================================

/**
 * Build available paths from source output, testcase columns, and discovered paths
 *
 * Uses combineTypedPaths and buildTestcaseColumnPaths from @agenta/shared
 */
export function buildAvailablePaths(
    sourceOutputPaths: PathInfo[] | undefined,
    testcaseColumns: {key: string; name?: string; type?: string}[],
    discoveredPaths: PathInfo[] = [],
): PathInfo[] {
    // Build testcase column paths using shared utility
    const testcasePaths = buildTestcaseColumnPaths(testcaseColumns)

    // Combine all paths using shared utility (handles deduplication)
    const combined = combineTypedPaths(sourceOutputPaths, discoveredPaths, testcasePaths)

    return combined as PathInfo[]
}
