import {memo} from "react"

import {useAtomValue} from "jotai"

import {testcaseEntityAtomFamily} from "@/oss/state/entities/testcase/testcaseEntity"

import TestcaseCellContent from "./TestcaseCellContent"

interface TestcaseCellProps {
    /** Testcase ID (entity atom key) */
    testcaseId: string
    /** Column key to read/write - supports dot notation for nested values (e.g., "event.type") */
    columnKey: string
    /** Max lines to show in cell preview */
    maxLines?: number
    /** Custom render function for the value */
    render?: (value: unknown, testcaseId: string, columnKey: string) => React.ReactNode
    /** Callback when entity is missing (for batch fetch) */
    onMissing?: (testcaseId: string) => void
}

/**
 * Try to parse a value as an object (handles JSON strings)
 */
function tryParseAsObject(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>
    }
    if (typeof value === "string") {
        const trimmed = value.trim()
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            try {
                const parsed = JSON.parse(trimmed)
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    return parsed as Record<string, unknown>
                }
            } catch {
                // Not valid JSON
            }
        }
    }
    return null
}

/**
 * Get a nested value from an object using dot notation
 * e.g., getNestedValue(obj, "event.type") returns obj.event.type
 * Handles JSON strings at any level of nesting
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".")
    let current: unknown = obj

    for (const part of parts) {
        if (current === null || current === undefined) return undefined

        // Try to parse as object if it's a JSON string
        const asObject = tryParseAsObject(current)
        if (asObject) {
            current = asObject[part]
        } else if (typeof current === "object") {
            current = (current as Record<string, unknown>)[part]
        } else {
            return undefined
        }
    }

    return current
}

/**
 * Table cell component that reads from entity atoms
 *
 * This component:
 * - Reads testcase data from entity atom (cache)
 * - Supports dot notation for nested values (e.g., "event.type")
 * - Reports missing entities for batch fetching
 * - Uses TestcaseCellContent for rendering
 *
 * @example
 * ```tsx
 * <TestcaseCell
 *   testcaseId="tc-123"
 *   columnKey="input"
 *   maxLines={10}
 * />
 * // Or for nested values:
 * <TestcaseCell
 *   testcaseId="tc-123"
 *   columnKey="event.type"
 *   maxLines={10}
 * />
 * ```
 */
export const TestcaseCell = memo(function TestcaseCell({
    testcaseId,
    columnKey,
    maxLines,
    render,
    onMissing,
}: TestcaseCellProps) {
    // Read entity directly from entity atom family
    // Don't use useMemo - atomFamily already caches atoms by key
    const entity = useAtomValue(testcaseEntityAtomFamily(testcaseId))

    // Extract the cell value from the entity
    // Supports dot notation for nested values (e.g., "event.type")
    const value = entity ? getNestedValue(entity as Record<string, unknown>, columnKey) : undefined

    // Use custom render if provided
    if (render) {
        return <>{render(value, testcaseId, columnKey)}</>
    }

    // Default: use TestcaseCellContent for smart rendering
    return <TestcaseCellContent value={value} maxLines={maxLines} />
})
