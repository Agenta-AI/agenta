import {
    useRunRowReferences,
    useRunRowSummary,
} from "@/oss/components/EvaluationRunsTablePOC/context/RunRowDataContext"
import type {EvaluationRunTableRow} from "@/oss/components/EvaluationRunsTablePOC/types"
import type {ReferenceColumnDescriptor} from "@/oss/components/EvaluationRunsTablePOC/utils/referenceSchema"
import {getSlotByRoleOrdinal} from "@/oss/components/EvaluationRunsTablePOC/utils/referenceSchema"
import SkeletonLine from "@/oss/components/InfiniteVirtualTable/components/common/SkeletonLine"

import usePreviewTestsetReference from "../hooks/usePreviewTestsetReference"

const CELL_CLASS = "flex h-full w-full min-w-0 flex-col justify-center gap-1 px-2"

export const PreviewTestsetCellSkeleton = () => <SkeletonLine width="65%" />

const normalize = (value: string | null | undefined) =>
    typeof value === "string" && value.trim().length ? value.trim() : null

const PreviewTestsetCellContent = ({
    record,
    isVisible,
    descriptor,
}: {
    record: EvaluationRunTableRow
    isVisible: boolean
    descriptor?: ReferenceColumnDescriptor
}) => {
    const runId = record.preview?.id ?? record.runId
    const canFetch = Boolean(runId)
    const {
        summary,
        testsetNames: _testsetNames,
        stepReferences,
        isLoading: summaryLoading,
    } = useRunRowSummary(record, isVisible)
    const referenceSequence = useRunRowReferences(record)
    const slot =
        descriptor && descriptor.role === "testset"
            ? getSlotByRoleOrdinal(referenceSequence, descriptor.role, descriptor.roleOrdinal)
            : null
    const slotTestsetId = slot?.values.find((value) => value.id)?.id ?? null

    const firstTestsetId = slotTestsetId ?? summary?.testsetIds?.[0] ?? null

    const {reference, isLoading: referenceLoading} = usePreviewTestsetReference(
        {
            projectId: record.projectId,
            testsetId: firstTestsetId,
            stepReferences,
        },
        {enabled: canFetch && Boolean(firstTestsetId)},
    )

    const primaryName = normalize(reference?.name)
    const label = primaryName ?? "—"
    if (summaryLoading || referenceLoading) {
        return <PreviewTestsetCellSkeleton />
    }

    const hasResolvedValue = label !== "—"
    const isReferenceMissing = Boolean(descriptor && (!slot || !(slot.values?.length ?? 0)))
    if (isReferenceMissing && !hasResolvedValue) {
        return <div className="not-available-table-cell" />
    }

    return (
        <div className="flex flex-col items-start overflow-hidden whitespace-nowrap">
            <span className="w-full text-ellipsis overflow-hidden">{label}</span>
        </div>
    )
}

export const PreviewTestsetCell = ({
    record,
    isVisible = true,
    descriptor,
}: {
    record: EvaluationRunTableRow
    isVisible?: boolean
    descriptor?: ReferenceColumnDescriptor
}) => {
    if (record.__isSkeleton) {
        return (
            <div className={CELL_CLASS}>
                <PreviewTestsetCellSkeleton />
            </div>
        )
    }

    return (
        <div className={CELL_CLASS}>
            <PreviewTestsetCellContent
                record={record}
                isVisible={isVisible}
                descriptor={descriptor}
            />
        </div>
    )
}
