import {Typography} from "antd"

import {
    formatSamplingRate,
    formatWindowRange,
} from "@/oss/components/EvalRunDetails/components/views/ConfigurationView/utils"
import type {EvaluationRunTableRow} from "@/oss/components/EvaluationRunsTablePOC/types"
import type {ReferenceColumnDescriptor} from "@/oss/components/EvaluationRunsTablePOC/utils/referenceSchema"
import SkeletonLine from "@/oss/components/InfiniteVirtualTable/components/common/SkeletonLine"
import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"

import FiltersPreview from "../../pages/evaluations/onlineEvaluation/components/FiltersPreview"
import usePreviewQueryRevision from "../hooks/usePreviewQueryRevision"

const CELL_CLASS =
    "flex h-full w-full min-w-0 flex-col justify-center gap-1 px-2 whitespace-nowrap overflow-hidden text-ellipsis"

export const PreviewQueryCellSkeleton = () => <SkeletonLine width="70%" />

const PreviewQueryCellContent = ({
    record,
    isVisible,
    descriptor,
}: {
    record: EvaluationRunTableRow
    isVisible: boolean
    descriptor?: ReferenceColumnDescriptor
}) => {
    const runId = record.preview?.id ?? record.runId
    const derivedKind =
        record.evaluationKind ??
        ((record.previewMeta as any)?.evaluation_kind as string | undefined) ??
        ((record.previewMeta as any)?.evaluationKind as string | undefined) ??
        null
    const isOnlineEvaluation = derivedKind === "online"

    const shouldFetch = Boolean(runId && isOnlineEvaluation)
    const safeRunId = runId ?? ""
    const {reference, revision, isLoading, error} = usePreviewQueryRevision(
        {runId: safeRunId},
        {enabled: shouldFetch},
    )

    const copySource =
        (reference.queryId as string | undefined) ??
        (revision?.id as string | undefined) ??
        (reference.querySlug as string | undefined) ??
        (revision?.slug as string | undefined) ??
        ""

    const samplingRate = formatSamplingRate(revision?.windowing?.rate)
    const historicalLabel = formatWindowRange(revision?.windowing)
    const hasWindowingMeta =
        (samplingRate && samplingRate !== "—") ||
        (historicalLabel && historicalLabel !== "—" && historicalLabel !== "Not specified")

    if (isLoading) {
        return <PreviewQueryCellSkeleton />
    }

    if (error) {
        return <Typography.Text type="danger">Failed to load query</Typography.Text>
    }

    if (!reference && !revision) {
        return <Typography.Text className="text-gray-400">No query metadata</Typography.Text>
    }

    if (!runId || !isOnlineEvaluation) {
        return <div className="not-available-table-cell" />
    }

    return (
        <div className="flex flex-col items-start gap-1">
            <TooltipWithCopyAction title="Copy query ID" copyText={copySource}>
                <div className="w-full">
                    <FiltersPreview filtering={revision?.filtering} compact />
                </div>
            </TooltipWithCopyAction>
            {hasWindowingMeta ? (
                <div className="flex flex-wrap gap-2 text-[11px] text-[#667085]">
                    {samplingRate && samplingRate !== "—" ? (
                        <span className="whitespace-nowrap">Sampling: {samplingRate}</span>
                    ) : null}
                    {historicalLabel &&
                    historicalLabel !== "—" &&
                    historicalLabel !== "Not specified" ? (
                        <span className="whitespace-nowrap">Historical: {historicalLabel}</span>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

export const PreviewQueryCell = ({
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
                <PreviewQueryCellSkeleton />
            </div>
        )
    }

    return (
        <div className={CELL_CLASS}>
            <PreviewQueryCellContent
                record={record}
                isVisible={isVisible}
                descriptor={descriptor}
            />
        </div>
    )
}

export default PreviewQueryCell
