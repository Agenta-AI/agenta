import {memo} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {Typography} from "antd"

import {
    useRunRowDetails,
    useRunRowSummary,
} from "@/oss/components/EvaluationRunsTablePOC/context/RunRowDataContext"
import type {EvaluationRunTableRow} from "@/oss/components/EvaluationRunsTablePOC/types"
import SkeletonLine from "@/oss/components/InfiniteVirtualTable/components/common/SkeletonLine"

const CELL_CLASS =
    "flex h-full w-full min-w-0 flex-col justify-center gap-1 px-2 whitespace-nowrap overflow-hidden"

export const PreviewCreatedByCellSkeleton = () => <SkeletonLine width="50%" />

const resolvePreviewCreatorName = (run: any): string | null => {
    if (!run) return null
    const candidates = [
        run.createdBy,
        run.created_by,
        run.createdByUser,
        run.created_by_user,
        run.owner,
        run.user,
        run.creator,
    ].filter(Boolean)

    for (const candidate of candidates) {
        const username =
            candidate?.user?.username ??
            candidate?.user?.name ??
            candidate?.user?.email ??
            candidate?.username ??
            candidate?.name ??
            candidate?.email
        if (typeof username === "string" && username.trim().length > 0) {
            return username.trim()
        }
    }

    return null
}

const PreviewCreatedByCellContent = ({
    record,
    isVisible,
}: {
    record: EvaluationRunTableRow
    isVisible: boolean
}) => {
    const {summary, isLoading: summaryLoading} = useRunRowSummary(record, isVisible)
    const {camelRun, isLoading: detailsLoading} = useRunRowDetails(record, isVisible)

    if (summaryLoading || detailsLoading) {
        return <PreviewCreatedByCellSkeleton />
    }

    const candidateUserId =
        summary?.createdById ??
        camelRun?.createdById ??
        camelRun?.created_by_id ??
        camelRun?.createdBy?.id ??
        camelRun?.created_by?.id ??
        camelRun?.createdByUser?.id ??
        camelRun?.created_by_user?.id ??
        null

    const fallbackName = resolvePreviewCreatorName(camelRun)

    if (!candidateUserId && !fallbackName) {
        return <Typography.Text>—</Typography.Text>
    }

    return (
        <UserAuthorLabel
            userId={candidateUserId}
            name={fallbackName}
            showAvatar
            showYouLabel
            fallback="—"
        />
    )
}

export const PreviewCreatedByCell = memo(
    ({record, isVisible = true}: {record: EvaluationRunTableRow; isVisible?: boolean}) => {
        if (record.__isSkeleton) {
            return (
                <div className={CELL_CLASS}>
                    <PreviewCreatedByCellSkeleton />
                </div>
            )
        }

        return (
            <div className={CELL_CLASS}>
                <PreviewCreatedByCellContent record={record} isVisible={isVisible} />
            </div>
        )
    },
)

export default PreviewCreatedByCell
