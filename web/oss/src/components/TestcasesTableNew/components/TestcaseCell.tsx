import {memo, useDeferredValue, useMemo} from "react"

import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {useColumnVisibilityFlag} from "@/oss/components/InfiniteVirtualTable/context/ColumnVisibilityFlagContext"
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
/**
 * Inner cell component that does the heavy lifting
 * Only rendered when the column is visible in the viewport
 * This avoids atom subscriptions and value extraction for invisible columns
 */
const TestcaseCellInner = memo(function TestcaseCellInner({
    testcaseId,
    columnKey,
    maxLines,
    render,
}: Omit<TestcaseCellProps, "onMissing">) {
    // Subscribe to the entire entity once per row
    // The atomFamily ensures the same atom instance is reused for the same testcaseId
    // This is more efficient than per-cell subscriptions because:
    // 1. Jotai deduplicates subscriptions to the same atom
    // 2. LOW_PRIORITY defers updates during scroll
    const entityAtom = useMemo(() => testcaseEntityAtomFamily(testcaseId), [testcaseId])
    const entity = useAtomValueWithSchedule(entityAtom, {priority: LOW_PRIORITY})

    // Extract value from entity using column key
    // Supports dot notation for nested values (e.g., "event.type")
    const value = useMemo(() => {
        if (!entity) return undefined

        const isNestedPath = columnKey.includes(".")
        const rootColumn = isNestedPath ? columnKey.split(".")[0] : columnKey
        const rootValue = (entity as Record<string, unknown>)[rootColumn]

        if (!isNestedPath) return rootValue
        if (rootValue === undefined || rootValue === null) return undefined

        // For nested paths, parse the parent value and extract the nested property
        const remainingPath = columnKey.substring(rootColumn.length + 1)
        const asObject = tryParseAsObject(rootValue)
        if (asObject) {
            return getNestedValue(asObject, remainingPath)
        }
        return undefined
    }, [entity, columnKey])

    // Use custom render if provided
    if (render) {
        return <>{render(value, testcaseId, columnKey)}</>
    }

    // Default: use TestcaseCellContent for smart rendering
    return <TestcaseCellContent value={value} maxLines={maxLines} />
})

/**
 * Lightweight wrapper that checks column visibility first
 * Only mounts TestcaseCellInner when the column is visible
 * This prevents atom subscriptions and heavy computation for invisible columns
 */
export const TestcaseCell = memo(function TestcaseCell({
    testcaseId,
    columnKey,
    maxLines,
    render,
}: TestcaseCellProps) {
    // Check if this column is visible in the horizontal viewport
    const isColumnVisible = useColumnVisibilityFlag(columnKey)

    // Defer the visibility value to prevent rapid mount/unmount cycles
    // This helps avoid "Maximum update depth exceeded" errors during fast scrolling
    const deferredIsVisible = useDeferredValue(isColumnVisible)

    // Skip mounting the inner component for columns outside the horizontal viewport
    // This is critical for scroll performance - prevents atom subscriptions for hidden cells
    if (!deferredIsVisible) {
        return <div className="testcase-table-cell w-full min-h-[24px]" />
    }

    return (
        <TestcaseCellInner
            testcaseId={testcaseId}
            columnKey={columnKey}
            maxLines={maxLines}
            render={render}
        />
    )
})
