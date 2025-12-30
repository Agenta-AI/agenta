import {memo, useMemo} from "react"

import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {testcaseCellAtomFamily} from "@/oss/state/entities/testcase/testcaseEntity"

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
 * Table cell component that reads from cell atoms for fine-grained reactivity
 *
 * This component:
 * - Reads cell value from testcaseCellAtomFamily (fine-grained subscription)
 * - Only re-renders when THIS specific cell value changes
 * - Uses selectAtom internally with custom equality checking
 * - Supports dot notation for nested values (e.g., "event.type")
 * - Uses TestcaseCellContent for rendering
 * - Defers updates during scroll with LOW_PRIORITY scheduling
 *
 * Performance benefits:
 * - Cell-level subscriptions prevent unnecessary re-renders
 * - Editing one cell only re-renders that cell, not the entire row
 * - selectAtom with custom equality prevents spurious updates
 * - LOW_PRIORITY scheduling defers updates during rapid scrolling
 *
 * Note: Does not check column visibility - InfiniteVirtualTable handles column virtualization.
 * Per-cell visibility checks cause "Maximum update depth exceeded" errors during scroll.
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
}: TestcaseCellProps) {
    // Subscribe to specific cell value using fine-grained cell atom
    // This atom uses selectAtom internally to only re-render when THIS cell's value changes
    // The composite key {id, column} ensures proper atom deduplication
    const cellAtom = useMemo(
        () => testcaseCellAtomFamily({id: testcaseId, column: columnKey}),
        [testcaseId, columnKey],
    )

    // Use LOW_PRIORITY scheduling to defer updates during rapid scrolling
    // This prevents jank when scrolling through large tables
    const value = useAtomValueWithSchedule(cellAtom, {priority: LOW_PRIORITY})

    console.log(`[TestcaseCell] testcaseId=${testcaseId}, columnKey=${columnKey}, value=`, value)

    // Use custom render if provided
    if (render) {
        return <>{render(value, testcaseId, columnKey)}</>
    }

    // Default: use TestcaseCellContent for smart rendering
    return <TestcaseCellContent value={value} maxLines={maxLines} />
})
