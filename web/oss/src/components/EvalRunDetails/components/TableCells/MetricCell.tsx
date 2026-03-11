import {memo, useMemo} from "react"

import clsx from "clsx"
import {useAtomValue} from "jotai"
import {AlertCircle} from "lucide-react"

import MetricDetailsPreviewPopover from "@/oss/components/Evaluations/components/MetricDetailsPreviewPopover"
import {
    MetricCellContent,
    CellContentPopover,
    type BasicStats,
    extractBasicStats,
    hasDistributionData,
    METRIC_PLACEHOLDER,
    formatMetricDisplay,
} from "@agenta/ui/cell-renderers"

import {scenarioHasInvocationAtomFamily} from "../../atoms/invocationTraceSummary"
import type {EvaluationTableColumn} from "../../atoms/table"
import useScenarioCellValue from "../../hooks/useScenarioCellValue"
import {previewEvalTypeAtom} from "../../state/evalType"

const CONTAINER_CLASS = "scenario-table-cell"

const ATTRIBUTES_AG_PREFIX = "attributes.ag."

const ensureAttributesPrefix = (
    path: string | undefined,
    stepType?: string,
): string | undefined => {
    if (!path) return path
    if (stepType !== "annotation" && stepType !== "evaluator") return path
    if (path.startsWith(ATTRIBUTES_AG_PREFIX)) return path
    const trimmed = path.replace(/^\.+/, "")
    return `${ATTRIBUTES_AG_PREFIX}${trimmed}`
}

const PreviewEvaluationMetricCell = ({
    scenarioId,
    runId,
    column,
    scenarioTimestamp,
}: {
    scenarioId?: string
    runId?: string
    column: EvaluationTableColumn
    scenarioTimestamp?: string | null
}) => {
    const evaluationType = useAtomValue(previewEvalTypeAtom)
    const {ref, selection, showSkeleton} = useScenarioCellValue({
        scenarioId,
        runId,
        column,
    })
    const {value, displayValue, stepError} = selection

    const hasInvocationAtom = useMemo(
        () => scenarioHasInvocationAtomFamily({scenarioId, runId}),
        [scenarioId, runId],
    )
    const hasInvocation = useAtomValue(hasInvocationAtom)
    const isAnnotationColumn = column.stepType === "annotation"
    const isOnlineEvaluation = evaluationType === "online"
    const hasValidValue = value !== undefined && value !== null
    const showInvalidState =
        isAnnotationColumn &&
        !hasInvocation &&
        !showSkeleton &&
        !isOnlineEvaluation &&
        !hasValidValue

    const metricKey = column.metricKey ?? column.valueKey ?? column.path
    const formatted = formatMetricDisplay({value, metricKey, metricType: column.metricType})

    const highlightValue = value
    const fallbackValue = value ?? displayValue ?? formatted

    const statsValue = useMemo<BasicStats | undefined>(() => extractBasicStats(value), [value])
    const showDistribution =
        column.stepType === "annotation" && hasDistributionData(statsValue)

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

    if (stepError) {
        const errorPopoverContent = (
            <div className="flex flex-col gap-2 text-red-600">
                <div className="flex items-center gap-1.5 text-red-500">
                    <AlertCircle size={14} className="flex-shrink-0" />
                    <span className="text-xs font-medium">Evaluator Error</span>
                </div>
                <span className="whitespace-pre-wrap break-words text-xs font-medium">
                    {stepError.message}
                </span>
                {stepError.stacktrace ? (
                    <span className="whitespace-pre-wrap break-words text-xs text-red-500/80 border-t border-red-200 pt-2 mt-1">
                        {stepError.stacktrace}
                    </span>
                ) : null}
            </div>
        )

        const errorCopyContent = `${stepError.message}${stepError.stacktrace ? `\n${stepError.stacktrace}` : ""}`
        return (
            <CellContentPopover content={errorPopoverContent} copyContent={errorCopyContent}>
                <div
                    ref={ref}
                    className={CONTAINER_CLASS}
                    data-cell-type="metric"
                    style={{width: "100%"}}
                >
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-red-500">
                            <AlertCircle size={14} className="flex-shrink-0" />
                            <span className="text-xs font-medium">Error</span>
                        </div>
                        <span className="scenario-table-text whitespace-pre-wrap text-red-600 text-xs">
                            {stepError.message}
                        </span>
                    </div>
                </div>
            </CellContentPopover>
        )
    }

    if (showInvalidState) {
        return <div ref={ref} className="scenario-table-cell--invalid" data-cell-type="metric" />
    }

    const rawMetricKey = column.metricKey ?? column.valueKey ?? column.path
    const prefixedMetricKey = ensureAttributesPrefix(rawMetricKey, column.stepType)
    const prefixedMetricPath = ensureAttributesPrefix(column.path, column.stepType)
    const effectiveStepKey = column.stepType === "metric" ? undefined : column.stepKey

    return (
        <div ref={ref} className={CONTAINER_CLASS} data-cell-type="metric" style={{width: "100%"}}>
            <MetricDetailsPreviewPopover
                runId={runId}
                metricKey={prefixedMetricKey}
                metricPath={prefixedMetricPath}
                metricLabel={column.displayLabel ?? column.label}
                stepKey={effectiveStepKey}
                highlightValue={highlightValue}
                fallbackValue={fallbackValue}
                stepType={column.stepType}
                evaluationType={evaluationType ?? undefined}
                scenarioTimestamp={scenarioTimestamp}
            >
                <MetricCellContent
                    value={value}
                    metricKey={metricKey}
                    metricType={column.metricType}
                    showDistribution={showDistribution}
                    className={clsx({
                        "metric-cell-content scenario-table-text": true,
                    })}
                />
            </MetricDetailsPreviewPopover>
        </div>
    )
}

export default memo(PreviewEvaluationMetricCell)
