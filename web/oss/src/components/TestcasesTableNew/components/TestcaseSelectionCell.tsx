import {memo} from "react"

import {useAtomValue} from "jotai"

import {testcaseIsDirtyAtom} from "@/oss/state/entities/testcase/dirtyState"

interface TestcaseSelectionCellProps {
    testcaseId: string | undefined
    rowIndex: number
    originNode: React.ReactNode
}

/**
 * Custom selection cell that shows row index on hover via title attribute
 * Also shows dirty indicator for rows with unsaved changes
 * Uses native title instead of Tooltip for better scroll performance
 */
const TestcaseSelectionCell = memo(function TestcaseSelectionCell({
    testcaseId,
    rowIndex,
    originNode,
}: TestcaseSelectionCellProps) {
    // Check if testcase has unsaved changes
    const isDirty = useAtomValue(testcaseIsDirtyAtom(testcaseId || ""))

    // Build tooltip title - always show row number, add dirty indicator if needed
    const tooltipTitle = isDirty ? `Row ${rowIndex + 1} (unsaved changes)` : `Row ${rowIndex + 1}`

    return (
        <div className="flex items-center justify-center w-full h-full" title={tooltipTitle}>
            {originNode}
        </div>
    )
})

export default TestcaseSelectionCell
