import {
    derivedEvalTypeAtomFamily,
    effectiveProjectIdAtom,
    evaluationQueryReferenceAtomFamily,
    type EvaluationQueryReference,
} from "@agenta/evaluations/state/evalRun"
import type {EvaluationRunTableRow} from "@agenta/evaluations/state/runsTable"
import type {ReferenceColumnDescriptor} from "@agenta/evaluations/state/runsTable"
import {formatSamplingRate, formatWindowRange} from "@agenta/evaluations-ui"
import {CopyTooltip as TooltipWithCopyAction} from "@agenta/ui/copy-tooltip"
import {SkeletonLine} from "@agenta/ui/table"
import {Tag, Typography} from "antd"
import {useAtomValue} from "jotai"

import {queryReferenceAtomFamily} from "@/oss/components/References"

import FiltersPreview from "../../pages/evaluations/onlineEvaluation/components/FiltersPreview"
import usePreviewQueryRevision from "../hooks/usePreviewQueryRevision"

// A run is query-backed when its input steps carry a query reference, regardless of
// evaluation kind: online (live) runs and `{query, batch}` runs over production traces
// both source their scenarios from a saved query.
const hasQueryReference = (reference: EvaluationQueryReference): boolean =>
    Boolean(
        reference.queryId ||
        reference.querySlug ||
        reference.queryRevisionId ||
        reference.queryRevisionSlug ||
        reference.queryVariantId ||
        reference.queryVariantSlug,
    )

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
    const evaluationType = useAtomValue(derivedEvalTypeAtomFamily(runId ?? null))
    const isOnlineEvaluation = evaluationType === "online"

    // Gate on the presence of a query reference rather than the evaluation kind, so
    // batch query runs (auto evaluation over traces) populate the column alongside
    // online runs. Reference resolution is derived from the run's input steps and is
    // cheap (selectAtom over already-loaded run data).
    const queryReference = useAtomValue(evaluationQueryReferenceAtomFamily(runId ?? null))
    const isQueryBacked = hasQueryReference(queryReference)
    const projectId = useAtomValue(effectiveProjectIdAtom)

    // Resolve the query name for the auto path only (online keeps the filter preview).
    // Passing null ids when online disables the fetch.
    const nameQuery = useAtomValue(
        queryReferenceAtomFamily({
            projectId,
            queryId: !isOnlineEvaluation ? (queryReference.queryId ?? null) : null,
            querySlug: !isOnlineEvaluation ? (queryReference.querySlug ?? null) : null,
        }),
    )

    const shouldFetch = Boolean(runId && isQueryBacked)
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
    const hasHistorical = Boolean(
        historicalLabel && historicalLabel !== "—" && historicalLabel !== "Not specified",
    )
    const hasWindowingMeta = (samplingRate && samplingRate !== "—") || hasHistorical

    if (isLoading) {
        return <PreviewQueryCellSkeleton />
    }

    if (error) {
        return <Typography.Text type="danger">Failed to load query</Typography.Text>
    }

    if (!runId || !isQueryBacked) {
        return <div className="not-available-table-cell" />
    }

    // Auto (batch) eval over traces: show the query name + revision version only, matching
    // the testset cell (plain text + version tag, no chip / filter preview).
    if (!isOnlineEvaluation) {
        const queryName =
            nameQuery.data?.name ??
            nameQuery.data?.slug ??
            queryReference.querySlug ??
            queryReference.queryId ??
            "—"
        const version = queryReference.queryRevisionVersion ?? revision?.version ?? null
        return (
            <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
                <span className="text-ellipsis overflow-hidden">{queryName}</span>
                {version !== null && version !== undefined ? (
                    <Tag className="bg-[var(--ag-colorFillSecondary)]" variant="filled">
                        v{version}
                    </Tag>
                ) : null}
            </div>
        )
    }

    // Online (live) eval: unchanged — full filter preview + sampling + historical window.
    if (!reference && !revision) {
        return <Typography.Text className="text-gray-400">No query metadata</Typography.Text>
    }

    return (
        <div className="flex flex-col items-start gap-1">
            <TooltipWithCopyAction title="Copy query ID" copyText={copySource}>
                <div className="w-full">
                    <FiltersPreview filtering={revision?.filtering} compact />
                </div>
            </TooltipWithCopyAction>
            {hasWindowingMeta ? (
                <div className="flex flex-wrap gap-2 text-[11px] text-[var(--ag-c-667085)]">
                    {samplingRate && samplingRate !== "—" ? (
                        <span className="whitespace-nowrap">Sampling: {samplingRate}</span>
                    ) : null}
                    {hasHistorical ? (
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
