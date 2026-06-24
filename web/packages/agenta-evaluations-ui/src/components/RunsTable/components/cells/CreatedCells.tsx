import {memo} from "react"

import {useRunRowSummary} from "@agenta/evaluations/state/runsTable"
import type {EvaluationRunTableRow} from "@agenta/evaluations/state/runsTable"
import {SkeletonLine} from "@agenta/ui/table"

const formatDate = (value?: string | null) => {
    if (!value) return "—"
    try {
        return new Intl.DateTimeFormat(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
        }).format(new Date(value))
    } catch {
        return value
    }
}

const CELL_CLASS = "flex h-full w-full min-w-0 flex-col justify-center gap-1 px-2 whitespace-nowrap"

export const PreviewCreatedCellSkeleton = () => <SkeletonLine width="45%" />

export const PreviewCreatedCell = memo(
    ({record, isVisible = true}: {record: EvaluationRunTableRow; isVisible?: boolean}) => {
        const {summary, isLoading} = useRunRowSummary(record, isVisible)

        if (record.__isSkeleton) {
            return (
                <div className={CELL_CLASS}>
                    <PreviewCreatedCellSkeleton />
                </div>
            )
        }

        if (!isVisible) {
            return null
        }

        if (isLoading) {
            return (
                <div className={CELL_CLASS}>
                    <PreviewCreatedCellSkeleton />
                </div>
            )
        }

        return (
            <div className={CELL_CLASS}>
                <span className="text-ellipsis overflow-hidden">
                    {formatDate(summary?.createdAt ?? record.createdAt)}
                </span>
            </div>
        )
    },
)
