import {memo, useMemo} from "react"

import {Tag} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {AlertCircle} from "lucide-react"

import MetricDetailsPreviewPopover from "@/oss/components/Evaluations/components/MetricDetailsPreviewPopover"
import EvaluatorMetricBar from "@/oss/components/Evaluations/EvaluatorMetricBar"
import type {BasicStats} from "@/oss/lib/metricUtils"

import {invocationTraceSummaryAtomFamily} from "../../atoms/invocationTraceSummary"
import type {EvaluationTableColumn} from "../../atoms/table"
import useScenarioCellValue from "../../hooks/useScenarioCellValue"
import {previewEvalTypeAtom} from "../../state/evalType"
import {formatMetricDisplay, METRIC_EMPTY_PLACEHOLDER} from "../../utils/metricFormatter"
import {buildFrequencyChartData} from "../EvaluatorMetricsChart/utils/chartData"

import CellContentPopover from "./CellContentPopover"

const CONTAINER_CLASS = "scenario-table-cell"

// Prefix for annotation/evaluator metric paths to match run-level stats storage
const ATTRIBUTES_AG_PREFIX = "attributes.ag."

/**
 * Ensures metric path has the attributes.ag. prefix for annotation/evaluator columns.
 * Run-level stats are stored with this prefix, so we need to match it for lookups.
 */
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

// Color palette for category tags (same as CategoryTags component)
const TAG_COLORS = ["green", "blue", "purple", "orange", "cyan", "magenta", "gold", "lime"]
const getTagColor = (index: number) => TAG_COLORS[index % TAG_COLORS.length]

const formatCategoryLabel = (value: unknown): string => {
    if (value === null || value === undefined) return "—"
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
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
    /** Timestamp for the scenario row (used for online evaluations to get temporal stats) */
    scenarioTimestamp?: string | null
}) => {
    // Get evaluation type from atom to determine if this is an online evaluation
    const evaluationType = useAtomValue(previewEvalTypeAtom)
    const {ref, selection, showSkeleton} = useScenarioCellValue({
        scenarioId,
        runId,
        column,
    })
    const {value, displayValue, stepError} = selection

    // Check if invocation has been run for this scenario (for annotation/evaluator metrics)
    const invocationSummary = useAtomValue(
        useMemo(() => invocationTraceSummaryAtomFamily({scenarioId, runId}), [scenarioId, runId]),
    )
    const hasInvocation = invocationSummary.state === "ready" && Boolean(invocationSummary.traceId)
    const isAnnotationColumn = column.stepType === "annotation"
    // For online evaluations, we don't need an invocation check since data comes from live traces
    // Also skip invalid state if we already have a valid value
    const isOnlineEvaluation = evaluationType === "online"
    const hasValidValue = value !== undefined && value !== null
    const showInvalidState =
        isAnnotationColumn &&
        !hasInvocation &&
        !showSkeleton &&
        !isOnlineEvaluation &&
        !hasValidValue

    const formatted = formatMetricDisplay({
        value,
        metricKey: column.metricKey ?? column.valueKey ?? column.path,
        metricType: column.metricType,
    })

    const isPlaceholder = formatted === METRIC_EMPTY_PLACEHOLDER || showInvalidState
    const highlightValue = value
    const fallbackValue = value ?? displayValue ?? formatted

    // Detect array/categorical metrics by metricType or by value shape
    const isArrayMetric =
        column.metricType?.toLowerCase?.() === "array" ||
        Array.isArray(value) ||
        (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) ||
        // Detect categorical/multiple type from stats object
        (typeof value === "object" &&
            value !== null &&
            ((value as any)?.type === "categorical/multiple" ||
                (value as any)?.type?.includes?.("categorical")))

    const statsValue = useMemo<BasicStats | undefined>(() => {
        if (!value || typeof value !== "object") return undefined
        const candidate = value as BasicStats & Record<string, any>
        if (
            Array.isArray((candidate as any)?.frequency) ||
            Array.isArray((candidate as any)?.freq) ||
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
                    Array.isArray((statsValue as any)?.freq) ||
                    Array.isArray((statsValue as any)?.rank)),
        )

    // Parse array values into individual tags (handles comma-separated strings)
    const arrayTags = useMemo(() => {
        if (!isArrayMetric) return []

        // First try to get from stats (aggregated view)
        const fromStats = statsValue ? buildFrequencyChartData((statsValue as any) ?? {}) : []
        if (fromStats.length > 0) {
            return fromStats
                .map((entry) => ({
                    label: formatCategoryLabel(entry.label),
                    count: Number(entry.value) || 0,
                }))
                .filter((entry) => Number.isFinite(entry.count))
                .slice(0, 3)
        }

        // For individual cells, parse the value directly
        // Handle arrays
        if (Array.isArray(value)) {
            return value
                .map((v) => formatCategoryLabel(v))
                .filter((v) => v !== "—")
                .map((label) => ({label, count: 1}))
                .slice(0, 3)
        }

        // Handle JSON array strings like '["cat-1","cat-2"]'
        if (typeof value === "string" && value.startsWith("[")) {
            try {
                const parsed = JSON.parse(value)
                if (Array.isArray(parsed)) {
                    return parsed
                        .map((v) => formatCategoryLabel(v))
                        .filter((v) => v !== "—")
                        .map((label) => ({label, count: 1}))
                        .slice(0, 3)
                }
            } catch {
                // Not valid JSON, continue to other parsing methods
            }
        }

        // Handle comma-separated strings (from formatters)
        if (typeof value === "string" && value.includes(",")) {
            return value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean)
                .map((label) => ({label, count: 1}))
                .slice(0, 3)
        }

        // Handle newline-separated strings
        if (typeof value === "string" && value.includes("\n")) {
            return value
                .split("\n")
                .map((v) => v.trim())
                .filter(Boolean)
                .map((label) => ({label, count: 1}))
                .slice(0, 3)
        }

        // Single value
        if (value && typeof value === "string" && value !== "—") {
            return [{label: value, count: 1}]
        }

        return []
    }, [isArrayMetric, statsValue, value])

    const displayNode = useMemo(() => {
        if (arrayTags.length) {
            return (
                <div className="metric-cell-content scenario-table-text flex flex-col items-start gap-1">
                    {arrayTags.map((entry, index) => (
                        <Tag
                            key={`${entry.label}-${index}`}
                            color={getTagColor(index)}
                            className="m-0 text-xs"
                        >
                            {entry.label}
                        </Tag>
                    ))}
                </div>
            )
        }
        return (
            <span
                className={clsx("metric-cell-content scenario-table-text whitespace-pre-wrap", {
                    "scenario-table-placeholder": isPlaceholder,
                })}
            >
                {formatted}
            </span>
        )
    }, [arrayTags, formatted, isPlaceholder])

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

    // Show error state when evaluator/step has failed - display error message in cell with red styling
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

        return (
            <CellContentPopover content={errorPopoverContent}>
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

    // Show invalid state styling when annotation column has no invocation
    if (showInvalidState) {
        return <div ref={ref} className="scenario-table-cell--invalid" data-cell-type="metric" />
    }

    // For annotation/evaluator columns, prefix metric paths with attributes.ag.
    // to match how run-level stats are stored
    const rawMetricKey = column.metricKey ?? column.valueKey ?? column.path
    const prefixedMetricKey = ensureAttributesPrefix(rawMetricKey, column.stepType)
    const prefixedMetricPath = ensureAttributesPrefix(column.path, column.stepType)

    // For "metric" type columns (invocation metrics like cost, duration, tokens),
    // don't pass stepKey as these are stored at run level without step prefix
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
                {content}
            </MetricDetailsPreviewPopover>
        </div>
    )
}

export default memo(PreviewEvaluationMetricCell)
