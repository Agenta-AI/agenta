/**
 * MetricCellContent — shared presentational component for rendering metric values.
 *
 * Handles all metric types:
 * - **Categorical/Binary**: Colored tags with distribution bar
 * - **Continuous/Numeric**: Formatted text
 * - **String**: Plain text with whitespace preservation
 * - **Loading**: Skeleton pulse
 * - **Empty**: Placeholder dash
 *
 * This component is purely presentational — it receives pre-resolved values
 * and does not fetch data or subscribe to atoms.
 */

import {memo, useMemo} from "react"

import {Tag, Tooltip} from "antd"
import clsx from "clsx"

import EvaluatorMetricBar from "./EvaluatorMetricBar"
import {
    METRIC_PLACEHOLDER,
    isArrayMetricValue,
    extractBasicStats,
    hasDistributionData,
    formatMetricDisplay,
    parseArrayTags,
    getTagColor,
} from "./metricUtils"

export interface MetricCellContentProps {
    /** The resolved metric value (scalar, array, BasicStats, etc.) */
    value: unknown
    /** Optional metric key for formatting (e.g., "cost", "duration") */
    metricKey?: string
    /** Optional metric type hint (e.g., "boolean", "array") */
    metricType?: string
    /** Whether to show a distribution bar for categorical metrics */
    showDistribution?: boolean
    /** Whether the cell is loading */
    isLoading?: boolean
    /** Custom class for the container */
    className?: string
    /** Maximum number of tags to show for categorical metrics */
    maxTags?: number
}

const MetricCellContent = memo(function MetricCellContent({
    value,
    metricKey,
    metricType,
    showDistribution = false,
    isLoading = false,
    className,
    maxTags = 3,
}: MetricCellContentProps) {
    const formatted = formatMetricDisplay({value, metricKey, metricType})
    const isPlaceholder = formatted === METRIC_PLACEHOLDER
    const isArray = isArrayMetricValue(value, metricType)

    const statsValue = useMemo(() => extractBasicStats(value), [value])

    const showBar = showDistribution && hasDistributionData(statsValue)

    const arrayTags = useMemo(() => {
        if (!isArray) return []
        return parseArrayTags(value, statsValue, maxTags)
    }, [isArray, value, statsValue, maxTags])

    if (isLoading) {
        return (
            <div className={clsx("w-full", className)}>
                <div className="h-3 w-full rounded bg-neutral-200 animate-pulse" />
            </div>
        )
    }

    const displayNode = useMemo(() => {
        if (arrayTags.length) {
            return (
                <div className="flex flex-col items-start gap-1">
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
                className={clsx("whitespace-pre-wrap", {
                    "text-gray-400": isPlaceholder,
                })}
            >
                {formatted}
            </span>
        )
    }, [arrayTags, formatted, isPlaceholder])

    if (showBar) {
        return (
            <div className={clsx("flex flex-col gap-1", className)}>
                <EvaluatorMetricBar stats={statsValue} />
            </div>
        )
    }

    return <div className={className}>{displayNode}</div>
})

export default MetricCellContent

/**
 * Minimal metric value display — just formatted text or tags, no bar/skeleton.
 * For use in compact cells like annotation queue tables.
 */
export const MetricValueDisplay = memo(function MetricValueDisplay({
    value,
    metricKey,
    metricType,
    className,
}: {
    value: unknown
    metricKey?: string
    metricType?: string
    className?: string
}) {
    if (value === null || value === undefined) {
        return <span className={clsx("text-gray-400", className)}>{METRIC_PLACEHOLDER}</span>
    }

    // Boolean
    if (typeof value === "boolean") {
        return (
            <Tag color={value ? "green" : "default"} className="m-0 text-xs">
                {String(value)}
            </Tag>
        )
    }

    // Array / categorical
    if (Array.isArray(value)) {
        return (
            <div className={clsx("flex items-center gap-1 flex-wrap overflow-hidden", className)}>
                {value.map((v, i) => {
                    const display = v === null || v === undefined ? "—" : String(v)
                    return (
                        <Tooltip key={`${display}-${i}`} title={display}>
                            <Tag
                                color={getTagColor(i)}
                                className="!m-0 max-w-[120px] truncate text-xs"
                            >
                                {display}
                            </Tag>
                        </Tooltip>
                    )
                })}
            </div>
        )
    }

    // Number
    if (typeof value === "number") {
        const formatted = formatMetricDisplay({value, metricKey, metricType})
        return (
            <Tooltip title={formatted}>
                <Tag className="!m-0 max-w-[120px] truncate text-xs">{formatted}</Tag>
            </Tooltip>
        )
    }

    // String
    const display = String(value)
    return (
        <Tooltip title={display}>
            <Tag className="!m-0 max-w-[120px] truncate text-xs">{display}</Tag>
        </Tooltip>
    )
})
