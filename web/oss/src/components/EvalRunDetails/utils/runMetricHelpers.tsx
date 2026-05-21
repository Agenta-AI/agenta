import type {ReactNode} from "react"

import {bgColors, cn, textColors} from "@agenta/ui"

import type {EvaluationTableColumn} from "../atoms/table"

export interface RunMetricColumn extends EvaluationTableColumn {
    __source?: "runMetric"
}

export const isRunMetricColumn = (
    column: EvaluationTableColumn,
): column is RunMetricColumn & {__source: "runMetric"} =>
    (column as RunMetricColumn).__source === "runMetric"

/**
 * Extracts a single scalar value from a metric stats object. Tries explicit
 * scalar fields first, then falls back to the highest-count frequency entry
 * and finally the first unique value — preserving parity with the legacy
 * FocusDrawer behaviour so frequency/unique metrics still render a value.
 */
export const resolveRunMetricScalar = (stats: unknown): unknown => {
    if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
        return stats
    }

    const record = stats as Record<string, unknown>
    const scalarCandidates = [
        record.value,
        record.total,
        record.sum,
        record.mean,
        record.avg,
        record.average,
        record.median,
        record.max,
        record.min,
    ]

    const scalar = scalarCandidates.find(
        (candidate) => candidate !== undefined && candidate !== null,
    )
    if (scalar !== undefined) return scalar

    if (Array.isArray(record.frequency) && record.frequency.length) {
        const sorted = [...record.frequency].sort(
            (a: any, b: any) => (b?.count ?? 0) - (a?.count ?? 0),
        )
        const first = sorted[0]
        if (first?.value !== undefined) return first.value
    }

    if (Array.isArray(record.unique) && record.unique.length) {
        return record.unique[0]
    }

    return undefined
}

/**
 * Strip evaluator/group name prefix from a label to avoid redundancy.
 * e.g., "New Human IsAwesome" -> "IsAwesome" when groupLabel is "New Human"
 */
export const stripGroupPrefix = (label: string, groupLabel?: string): string => {
    if (!groupLabel || !label) return label
    const normalizedGroup = groupLabel.toLowerCase().replace(/[-_\s]+/g, "")
    const normalizedLabel = label.toLowerCase().replace(/[-_\s]+/g, "")
    if (!normalizedLabel.startsWith(normalizedGroup)) return label

    let prefixEndIndex = 0
    let groupIndex = 0
    while (prefixEndIndex < label.length && groupIndex < groupLabel.length) {
        const labelChar = label[prefixEndIndex].toLowerCase()
        const groupChar = groupLabel[groupIndex].toLowerCase()
        if (labelChar === groupChar) {
            groupIndex++
        } else if (/[-_\s]/.test(label[prefixEndIndex])) {
            // skip separator in label
        } else if (/[-_\s]/.test(groupLabel[groupIndex])) {
            groupIndex++
            continue
        } else {
            break
        }
        prefixEndIndex++
    }
    while (prefixEndIndex < label.length && /[-_\s]/.test(label[prefixEndIndex])) {
        prefixEndIndex++
    }
    return label.slice(prefixEndIndex) || label
}

export const MetricValuePill = ({value, muted}: {value: ReactNode; muted?: boolean}) => (
    <span
        className={cn(
            "inline-flex w-fit rounded-md px-2 py-1 text-xs font-medium",
            bgColors.chip,
            muted ? textColors.quaternary : textColors.secondary,
        )}
    >
        {value}
    </span>
)
