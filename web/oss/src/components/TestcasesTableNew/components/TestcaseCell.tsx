import {memo, useCallback} from "react"

import {Skeleton} from "antd"

import {useEntityCached, useEntityMutation} from "@/oss/state/entities"
import {testcaseStore} from "@/oss/state/entities/testcase/store"

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
    // Read from entity atom (no fetching - cache only)
    const testcase = useEntityCached(testcaseStore, testcaseId)

    // Get current value
    const value = testcase?.[columnKey]

    // Report missing entity for batch fetch
    if (!testcase && onMissing) {
        onMissing(testcaseId)
    }

    // Show skeleton while entity is not in cache
    if (!testcase) {
        return (
            <div className="testcase-table-cell">
                <Skeleton.Input size="small" active style={{width: "100%", height: 20}} />
            </div>
        )
    }

    // Use custom render if provided
    if (render) {
        return <>{render(value, testcaseId, columnKey)}</>
    }

    // Default: use TestcaseCellContent for smart rendering
    return <TestcaseCellContent value={value} maxLines={maxLines} />
})

/**
 * Hook to get mutation functions for testcase entities
 */
export function useTestcaseMutation() {
    const {update, upsert, remove, invalidate} = useEntityMutation(testcaseStore)

    const updateField = useCallback(
        (testcaseId: string, columnKey: string, value: unknown) => {
            update({
                id: testcaseId,
                updates: {[columnKey]: value},
            })
        },
        [update],
    )

    return {
        updateField,
        update,
        upsert,
        remove,
        invalidate,
    }
}
