import {memo} from "react"

import {Typography} from "antd"

import SkeletonLine from "@/oss/components/InfiniteVirtualTable/components/common/SkeletonLine"
import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"

import {useRunRowSummary} from "../../context/RunRowDataContext"
import type {EvaluationRunTableRow} from "../../types"

const CELL_CLASS = "flex h-full w-full min-w-0 flex-col justify-center gap-1 px-2"

export const PreviewRunNameCellSkeleton = () => (
    <>
        <SkeletonLine width="70%" />
        <SkeletonLine width="40%" />
    </>
)

const PreviewRunNameCellContent = memo(({summary, runId}: {summary: any; runId: string | null}) => {
    const displayName = summary?.name || runId || "Untitled run"
    const copyTarget = runId ?? summary?.id ?? null

    if (!copyTarget) {
        return <Typography.Text className="font-medium">{displayName}</Typography.Text>
    }

    return (
        <TooltipWithCopyAction title="Copy run ID" copyText={copyTarget}>
            <span className="font-medium text-primary cursor-copy whitespace-nowrap overflow-hidden text-ellipsis">
                {displayName}
            </span>
        </TooltipWithCopyAction>
    )
})

const PreviewRunNameCellContentLoader = ({
    record,
    isVisible,
}: {
    record: EvaluationRunTableRow
    isVisible: boolean
}) => {
    const {summary, isLoading} = useRunRowSummary(record, isVisible)
    const runId = record.preview?.id ?? record.runId

    if (isLoading) {
        return <PreviewRunNameCellSkeleton />
    }

    return <PreviewRunNameCellContent summary={summary} runId={runId ?? null} />
}

export const PreviewRunNameCell = ({
    record,
    isVisible = true,
}: {
    record: EvaluationRunTableRow
    isVisible?: boolean
}) => {
    if (record.__isSkeleton) {
        return (
            <div className={CELL_CLASS}>
                <PreviewRunNameCellSkeleton />
            </div>
        )
    }

    if (!isVisible) {
        return null
    }

    return (
        <div className={CELL_CLASS}>
            <PreviewRunNameCellContentLoader record={record} isVisible={isVisible} />
        </div>
    )
}
