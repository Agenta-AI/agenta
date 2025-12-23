import {memo} from "react"

import {useAtomValue} from "jotai"

import {testcaseEntityAtomFamily} from "@/oss/state/entities/testcase/testcaseEntity"

import TestcaseCellContent from "./TestcaseCellContent"

interface TestcaseCellProps {
    /** Testcase ID (entity atom key) */
    testcaseId: string
    /** Column key to read/write */
    columnKey: string
    /** Max lines to show in cell preview */
    maxLines?: number
    /** Custom render function for the value */
    render?: (value: unknown, testcaseId: string, columnKey: string) => React.ReactNode
    /** Callback when entity is missing (for batch fetch) */
    onMissing?: (testcaseId: string) => void
}

/**
 * Table cell component that reads from entity atoms
 *
 * This component:
 * - Reads testcase data from entity atom (cache)
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
    const value = entity ? (entity as Record<string, unknown>)[columnKey] : undefined

    // Use custom render if provided
    if (render) {
        return <>{render(value, testcaseId, columnKey)}</>
    }

    // Default: use TestcaseCellContent for smart rendering
    return <TestcaseCellContent value={value} maxLines={maxLines} />
})
