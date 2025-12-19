import {memo} from "react"

import {Tooltip} from "antd"
import {useAtomValue} from "jotai"

import {isTestcaseDirtyAtomFamily} from "@/oss/state/entities/testcase/dirtyState"

interface TestcaseSelectionCellProps {
    testcaseId: string | undefined
    rowIndex: number
    originNode: React.ReactNode
}

/**
 * Custom selection cell that shows tooltip with row index
 * Also shows dirty indicator for rows with unsaved changes
 * Uses isTestcaseDirtyAtomFamily which compares entity data vs server cache
 */
const TestcaseSelectionCell = memo(function TestcaseSelectionCell({
    testcaseId,
    rowIndex,
    originNode,
}: TestcaseSelectionCellProps) {
    // Use the derived dirty atom that compares entity data vs server cache
    const isDirty = useAtomValue(isTestcaseDirtyAtomFamily(testcaseId || ""))

    // Build tooltip title - always show row number, add dirty indicator if needed
    const tooltipTitle = isDirty ? `Row ${rowIndex + 1} (unsaved changes)` : `Row ${rowIndex + 1}`

    return (
        <Tooltip title={tooltipTitle} mouseEnterDelay={0.3} mouseLeaveDelay={0} placement="right">
            <div className="flex items-center justify-center w-full h-full">{originNode}</div>
        </Tooltip>
    )
})

export default TestcaseSelectionCell
