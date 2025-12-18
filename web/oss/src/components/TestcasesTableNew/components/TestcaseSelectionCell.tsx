import {memo} from "react"

import {Tooltip} from "antd"

import {useEntityMetadata} from "@/oss/state/entities"
import {testcaseStore} from "@/oss/state/entities/testcase/store"

interface TestcaseSelectionCellProps {
    testcaseId: string | undefined
    originNode: React.ReactNode
}

/**
 * Custom selection cell that shows tooltip for dirty rows
 */
const TestcaseSelectionCell = memo(function TestcaseSelectionCell({
    testcaseId,
    originNode,
}: TestcaseSelectionCellProps) {
    const metadata = useEntityMetadata(testcaseStore, testcaseId || "")
    const isDirty = metadata?.isDirty ?? false

    if (!isDirty) {
        return <>{originNode}</>
    }

    return (
        <Tooltip
            title="This row has unsaved changes"
            mouseEnterDelay={0.3}
            mouseLeaveDelay={0}
            placement="right"
        >
            <div className="flex items-center justify-center w-full h-full">{originNode}</div>
        </Tooltip>
    )
})

export default TestcaseSelectionCell
