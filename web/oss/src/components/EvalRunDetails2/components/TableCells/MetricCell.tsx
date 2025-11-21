import {memo, useMemo} from "react"
import clsx from "clsx"

import EvaluatorMetricBar from "@/oss/components/HumanEvaluations/assets/EvaluatorMetricBar"
import type {BasicStats} from "@/oss/lib/metricUtils"

import type {EvaluationTableColumn} from "../../atoms/table"
import {COLUMN_WIDTHS} from "../../constants/table"
import useScenarioCellValue from "../../hooks/useScenarioCellValue"
import {formatMetricDisplay, METRIC_EMPTY_PLACEHOLDER} from "../../utils/metricFormatter"
import MetricDetailsPreviewPopover from "@/oss/components/evaluations/components/MetricDetailsPreviewPopover"

const CONTAINER_CLASS = "scenario-table-cell min-h-[96px]"

const resolveColumnWidth = (column: EvaluationTableColumn): number => {
    if (typeof column.width === "number") return column.width
    if (typeof column.minWidth === "number") return column.minWidth
    return COLUMN_WIDTHS.metric
}

const PreviewEvaluationMetricCell = ({
    scenarioId,
    runId,
    column,
}: {
    scenarioId?: string
    runId?: string
    column: EvaluationTableColumn
}) => {
    console.log("PreviewEvaluationMetricCell")
    const {ref, selection, showSkeleton, isVisible} = useScenarioCellValue({
        scenarioId,
        runId,
        column,
    })
    const {value, displayValue, isLoading} = selection

    if (
        process.env.NEXT_PUBLIC_EVAL_RUN_DEBUG === "true" &&
        isVisible &&
        !isLoading &&
        typeof window !== "undefined"
    ) {
        try {
            const display =
                displayValue ??
                formatMetricDisplay({
                    value,
                    metricKey: column.metricKey ?? column.valueKey ?? column.path,
                    metricType: column.metricType,
                })
            // console.info("[EvalRunDetails2][MetricCell] resolved metric", {
            //     scenarioId,
            //     runId,
            //     columnId: column.id,
            //     columnLabel: column.displayLabel ?? column.label,
            //     path: column.path,
            //     metricKey: column.metricKey,
            //     evaluatorId: column.evaluatorId,
            //     evaluatorSlug: column.evaluatorSlug,
            //     valueShape: typeof value,
            //     value,
            //     displayValue: displayValue ?? null,
            //     formatted: display,
            // })
        } catch (error) {
            console.warn("[EvalRunDetails2][MetricCell] debug log failed", {
                scenarioId,
                runId,
                columnId: column.id,
                error,
            })
        }
    }

    const formatted =
        displayValue ??
        formatMetricDisplay({
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

    const displayNode = (
        <span
            className={clsx("metric-cell-content scenario-table-text whitespace-pre-wrap", {
                "scenario-table-placeholder": isPlaceholder,
            })}
        >
            {formatted}
        </span>
    )

    const content = hasDistribution ? (
        <div className="flex flex-col gap-1">
            <EvaluatorMetricBar stats={statsValue} />
            {displayNode}
        </div>
    ) : (
        displayNode
    )

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
