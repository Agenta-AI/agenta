import {memo, useMemo} from "react"

import {useAtomValue} from "jotai"

import {testcase} from "@/oss/state/entities/testcase"

interface TestcaseSelectionCellProps {
    testcaseId: string | undefined
    rowIndex: number
    originNode: React.ReactNode
    mode?: "edit" | "view"
}

/**
 * Custom selection cell that shows row index on hover via title attribute
 * Also shows dirty indicator for rows with unsaved changes via background color
 *
 * Uses testcaseIsDirtyAtomFamily for reactive dirty state detection:
 * - Checks draft state vs server state
 * - Accounts for pending column changes (renames/deletes/adds)
 * - New rows are always considered dirty
 *
 * Uses native title instead of Tooltip for better scroll performance
 */
const TestcaseSelectionCell = memo(function TestcaseSelectionCell({
    testcaseId,
    rowIndex,
    originNode,
    mode = "edit",
}: TestcaseSelectionCellProps) {
    // Check if testcase has unsaved changes using controller selector
    // This includes both draft edits AND pending column changes
    const isDirtyAtom = useMemo(() => testcase.selectors.isDirty(testcaseId || ""), [testcaseId])
    // Always call useAtomValue (hooks must be unconditional), then check mode
    const isDirtyValue = useAtomValue(isDirtyAtom)
    const isDirty = mode === "edit" ? isDirtyValue : false

    // New rows (not yet saved) are always dirty
    const isNewRow = testcaseId?.startsWith("new-") || testcaseId?.startsWith("local-") || false

    const showDirtyIndicator = mode === "edit" && (isDirty || isNewRow)

    // Build tooltip title - always show row number, add dirty indicator if needed
    const tooltipTitle = showDirtyIndicator
        ? `Row ${rowIndex + 1} (unsaved changes)`
        : `Row ${rowIndex + 1}`

    return (
        <div
            className="flex items-center justify-center w-full h-full absolute inset-0"
            title={tooltipTitle}
            style={showDirtyIndicator ? {backgroundColor: "rgb(255 251 235)"} : undefined}
        >
            <div className="relative">{originNode}</div>
        </div>
    )
})

export default TestcaseSelectionCell
