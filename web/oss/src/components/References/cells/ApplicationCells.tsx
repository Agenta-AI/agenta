import {Typography} from "antd"

import SkeletonLine from "@/oss/components/InfiniteVirtualTable/components/common/SkeletonLine"
import {
    useRunRowReferences,
    useRunRowSummary,
} from "@/oss/components/EvaluationRunsTablePOC/context/RunRowDataContext"
import type {EvaluationRunTableRow} from "@/oss/components/EvaluationRunsTablePOC/types"
import type {ReferenceColumnDescriptor} from "@/oss/components/EvaluationRunsTablePOC/utils/referenceSchema"
import {getSlotByRoleOrdinal} from "@/oss/components/EvaluationRunsTablePOC/utils/referenceSchema"
import useAppReference from "../hooks/useAppReference"

export const PreviewAppCellSkeleton = () => <SkeletonLine width="55%" />

const CELL_CLASS = "flex h-full w-full min-w-0 flex-col justify-center gap-1 px-2"

export const PreviewAppCell = ({
    record,
    isVisible = true,
    descriptor,
}: {
    record: EvaluationRunTableRow
    isVisible?: boolean
    descriptor?: ReferenceColumnDescriptor
}) => {
    // const runId = record.preview?.id ?? record.runId
    const canFetch = Boolean(!record.__isSkeleton && isVisible)
    const {summary, isLoading: summaryLoading} = useRunRowSummary(record, isVisible)
    const referenceSequence = useRunRowReferences(record)
    const slot =
        descriptor && descriptor.role === "application"
            ? getSlotByRoleOrdinal(referenceSequence, descriptor.role, descriptor.roleOrdinal)
            : null
    const slotValue = slot?.values?.[0]
    const slotAppId = slotValue?.id ?? null
    const slotLabel = slotValue?.label ?? slotValue?.slug ?? slotValue?.name ?? null
    const appId = slotAppId ?? summary?.appId ?? record.appId ?? null
    const {reference, isLoading: referenceLoading} = useAppReference(
        {
            projectId: record.projectId,
            appId,
        },
        {enabled: canFetch && Boolean(appId)},
    )
    // const additionalCount = Math.max((slot?.values?.length ?? 0) - 1, 0)

    const resolvedName =
        reference?.name ??
        reference?.slug ??
        slotLabel ??
        reference?.id ??
        slotAppId ??
        summary?.appId ??
        record.appId ??
        null
    const contentLabel = resolvedName ?? "—"
    if (record.__isSkeleton) {
        return (
            <div className={CELL_CLASS}>
                <PreviewAppCellSkeleton />
            </div>
        )
    }

    if (summaryLoading || referenceLoading) {
        return (
            <div className={CELL_CLASS}>
                <PreviewAppCellSkeleton />
            </div>
        )
    }

    const isReferenceMissing = Boolean(descriptor && (!slot || !(slot.values?.length ?? 0)))
    const hasResolvedValue = contentLabel !== "—"
    if (isReferenceMissing && !hasResolvedValue) {
        return <div className="not-available-table-cell" />
    }

    return (
        <div className={CELL_CLASS}>
            <Typography.Text>
                {contentLabel}
                {/* {additionalCount > 0 ? ` (+${additionalCount})` : ""} */}
            </Typography.Text>
        </div>
    )
}
