import {memo, useMemo} from "react"

import clsx from "clsx"

import MetricDetailsPreviewPopover from "@/oss/components/Evaluations/components/MetricDetailsPreviewPopover"
import EvaluatorMetricBar from "@/oss/components/Evaluations/EvaluatorMetricBar"
import type {BasicStats} from "@/oss/lib/metricUtils"

import type {EvaluationTableColumn} from "../../atoms/table"
import useScenarioCellValue from "../../hooks/useScenarioCellValue"
import {formatMetricDisplay, METRIC_EMPTY_PLACEHOLDER} from "../../utils/metricFormatter"

const CONTAINER_CLASS = "scenario-table-cell min-h-[96px]"

const PreviewEvaluationMetricCell = ({
    scenarioId,
    runId,
    column,
}: {
    scenarioId?: string
    runId?: string
    column: EvaluationTableColumn
}) => {
    const {ref, selection, showSkeleton, isVisible} = useScenarioCellValue({
        scenarioId,
        runId,
        column,
    })
    const {value, displayValue, isLoading} = selection

    const formatted = formatMetricDisplay({
        value,
        metricKey: column.metricKey ?? column.valueKey ?? column.path,
        metricType: column.metricType,
    })

    const isPlaceholder = formatted === METRIC_EMPTY_PLACEHOLDER
    const highlightValue = value
    const fallbackValue = value ?? displayValue ?? formatted

    const statsValue = useMemo<BasicStats | undefined>(() => {
        if (!value || typeof value !== "object") return undefined
        const candidate = value as BasicStats & Record<string, any>
        if (
            Array.isArray((candidate as any)?.frequency) ||
            Array.isArray((candidate as any)?.rank) ||
            typeof (candidate as any)?.count === "number" ||
            typeof (candidate as any)?.mean === "number"
        ) {
            return candidate
        }
        return undefined
    }, [value])

    const hasDistribution =
        column.stepType === "annotation" &&
        Boolean(
            statsValue &&
                (Array.isArray((statsValue as any)?.frequency) ||
                    Array.isArray((statsValue as any)?.rank)),
        )

    const displayNode = useMemo(
        () => (
            <span
                className={clsx("metric-cell-content scenario-table-text whitespace-pre-wrap", {
                    "scenario-table-placeholder": isPlaceholder,
                })}
            >
                {formatted}
            </span>
        ),
        [formatted, isPlaceholder],
    )

    const content = useMemo(() => {
        if (hasDistribution) {
            return (
                <div className="flex flex-col gap-1">
                    <EvaluatorMetricBar stats={statsValue} />
                    {displayNode}
                </div>
            )
        }
        return displayNode
    }, [displayNode, hasDistribution, statsValue])

    if (showSkeleton) {
        return (
            <div
                ref={ref}
                className={CONTAINER_CLASS}
                data-cell-type="metric"
                style={{width: "100%"}}
            >
                <div className="h-3 w-full rounded bg-neutral-200 animate-pulse" />
            </div>
        )
    }

    return (
        <div ref={ref} className={CONTAINER_CLASS} data-cell-type="metric" style={{width: "100%"}}>
            <MetricDetailsPreviewPopover
                runId={runId}
                metricKey={column.metricKey ?? column.valueKey ?? column.path}
                metricPath={column.path}
                metricLabel={column.displayLabel ?? column.label}
                stepKey={column.stepKey}
                highlightValue={highlightValue}
                fallbackValue={fallbackValue}
                stepType={column.stepType}
            >
                {content}
            </MetricDetailsPreviewPopover>
        </div>
    )
}

export default memo(PreviewEvaluationMetricCell)
