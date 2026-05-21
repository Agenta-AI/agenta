import type {ReactNode} from "react"
import {memo, useMemo} from "react"

import {
    formatMetricDisplay,
    METRIC_PLACEHOLDER as METRIC_EMPTY_PLACEHOLDER,
} from "@agenta/ui/cell-renderers"
import {Skeleton, Typography} from "antd"
import {useAtomValue} from "jotai"

import {previewRunMetricStatsSelectorFamily} from "@/oss/components/Evaluations/atoms/runMetrics"
import MetricDetailsPreviewPopover from "@/oss/components/Evaluations/components/MetricDetailsPreviewPopover"

import type {EvaluationTableColumn} from "../../atoms/table"
import useScenarioCellValue from "../../hooks/useScenarioCellValue"
import {
    MetricValuePill,
    isRunMetricColumn,
    resolveRunMetricScalar,
    stripGroupPrefix,
} from "../../utils/runMetricHelpers"

import type {EvalDrawerMetricSection} from "./model"

const {Text} = Typography

const MetricContent = ({
    runId,
    column,
    label,
    value,
    displayValue,
    highlightValue,
    fallbackValue,
    showSkeleton,
}: {
    runId: string
    column: EvaluationTableColumn
    label: string
    value: unknown
    displayValue?: unknown
    highlightValue?: unknown
    fallbackValue?: unknown
    showSkeleton: boolean
}) => {
    const metricKey = column.metricKey ?? column.valueKey ?? column.path
    const rawFormattedValue =
        displayValue ??
        formatMetricDisplay({
            value,
            metricKey,
            metricType: column.metricType,
        })
    const formattedValue =
        typeof rawFormattedValue === "boolean" ? String(rawFormattedValue) : rawFormattedValue
    const isPlaceholder = formattedValue === METRIC_EMPTY_PLACEHOLDER

    if (showSkeleton) {
        return <Skeleton.Input active size="small" style={{width: 120}} />
    }

    return (
        <MetricDetailsPreviewPopover
            runId={runId}
            metricKey={metricKey}
            metricPath={column.path}
            metricLabel={label}
            stepKey={column.stepKey}
            highlightValue={highlightValue ?? value}
            fallbackValue={fallbackValue ?? value ?? displayValue ?? formattedValue}
            stepType={column.stepType}
            fullWidth={false}
        >
            <MetricValuePill value={formattedValue as ReactNode} muted={isPlaceholder} />
        </MetricDetailsPreviewPopover>
    )
}

const RunMetricColumnValue = memo(
    ({
        runId,
        scenarioId,
        column,
        label,
    }: {
        runId: string
        scenarioId: string
        column: EvaluationTableColumn
        label: string
    }) => {
        const {selection, showSkeleton} = useScenarioCellValue({
            runId,
            scenarioId,
            column,
            disableVisibilityTracking: true,
        })
        const runSelectionAtom = useMemo(
            () =>
                previewRunMetricStatsSelectorFamily({
                    runId,
                    metricKey: column.metricKey ?? column.valueKey ?? column.path,
                    metricPath: column.path,
                    stepKey: column.stepKey,
                }),
            [column.metricKey, column.path, column.stepKey, column.valueKey, runId],
        )
        const runSelection = useAtomValue(runSelectionAtom)
        const runStats = runSelection.state === "hasData" ? runSelection.stats : undefined
        const runScalar = useMemo(() => resolveRunMetricScalar(runStats), [runStats])
        const scenarioHasValue =
            selection.value !== undefined && selection.value !== null && !selection.isLoading
        const value = scenarioHasValue ? selection.value : runScalar
        const highlightValue = scenarioHasValue ? selection.value : (runStats ?? runScalar)
        const isLoading =
            (showSkeleton || selection.isLoading) &&
            !scenarioHasValue &&
            runSelection.state === "loading" &&
            runScalar === undefined

        return (
            <div className="flex flex-col gap-2">
                <Text className="text-xs font-medium text-[#475467]">{label}</Text>
                <MetricContent
                    runId={runId}
                    column={column}
                    label={label}
                    value={value}
                    highlightValue={highlightValue}
                    fallbackValue={highlightValue}
                    showSkeleton={isLoading}
                />
            </div>
        )
    },
)

RunMetricColumnValue.displayName = "RunMetricColumnValue"

const MetricColumnValue = memo(
    ({
        runId,
        scenarioId,
        column,
        groupLabel,
    }: {
        runId: string
        scenarioId: string
        column: EvaluationTableColumn
        groupLabel: string
    }) => {
        const {selection, showSkeleton} = useScenarioCellValue({
            runId,
            scenarioId,
            column,
            disableVisibilityTracking: true,
        })

        const rawLabel = column.displayLabel ?? column.label ?? column.id
        const label = stripGroupPrefix(rawLabel, groupLabel)

        if (isRunMetricColumn(column)) {
            return (
                <RunMetricColumnValue
                    runId={runId}
                    scenarioId={scenarioId}
                    column={column}
                    label={label}
                />
            )
        }

        if (selection.stepError) {
            return (
                <div className="flex flex-col gap-1 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">
                    <Text className="text-xs font-medium text-red-600">{label}</Text>
                    <span className="whitespace-pre-wrap break-words">
                        {selection.stepError.message}
                    </span>
                    {selection.stepError.stacktrace ? (
                        <span className="mt-1 border-t border-solid border-red-200 pt-2 text-red-500/80 whitespace-pre-wrap break-words">
                            {selection.stepError.stacktrace}
                        </span>
                    ) : null}
                </div>
            )
        }

        return (
            <div className="flex flex-col gap-2">
                <Text className="text-xs font-medium text-[#475467]">{label}</Text>
                <MetricContent
                    runId={runId}
                    column={column}
                    label={label}
                    value={selection.value}
                    displayValue={selection.displayValue}
                    showSkeleton={showSkeleton}
                />
            </div>
        )
    },
)

MetricColumnValue.displayName = "MetricColumnValue"

const EvaluatorMetricsAdapter = ({
    runId,
    scenarioId,
    sections,
}: {
    runId: string
    scenarioId: string
    sections: EvalDrawerMetricSection[]
}) => {
    if (!sections.length) return null

    return (
        <div className="flex flex-col">
            {sections.map((section) => (
                <div
                    key={section.id}
                    className="flex flex-col border-t border-solid border-[#0517290F]"
                >
                    <div className="flex min-h-9 items-center border-b border-solid border-[#0517290F] bg-[#fafafa] px-4 py-1.5">
                        <span className="truncate text-[13px] font-semibold text-[#051729]">
                            {section.label}
                        </span>
                    </div>
                    <div className="flex flex-col gap-3 px-4 py-3">
                        {section.columns.map((column) => (
                            <MetricColumnValue
                                key={column.id}
                                runId={runId}
                                scenarioId={scenarioId}
                                column={column}
                                groupLabel={section.label}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}

export default memo(EvaluatorMetricsAdapter)
