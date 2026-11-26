/**
 * The metric values of one scenario, as the old app's scenario table prints them (web/oss
 * `EvalRunDetails/atoms/scenarioColumnValues.ts` and `TableCells/MetricCell.tsx`).
 *
 * A scenario's metric rows hold `data[stepKey][metricKey]`: a stat blob over that one scenario.
 * The invocation metrics (cost, duration, tokens, errors) are read from the invocation step first,
 * then from the other steps in run order, as the old app tries its candidate step keys.
 *
 * @packageDocumentation
 */

import {formatMetricValue, METRIC_PLACEHOLDER} from "./metricFormat"
import {normalizeMetricStats, type MetricStats} from "./metricStats"

interface ScenarioMetricRow {
    data?: Record<string, unknown> | null
}

interface ScenarioMetricStep {
    key: string
    type?: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/** A stat blob from a raw metric value. A bare number counts as one sample of itself. */
function toStats(raw: unknown): MetricStats | null {
    if (typeof raw === "number" && Number.isFinite(raw)) return {count: 1, mean: raw, sum: raw}
    const stats = normalizeMetricStats(raw)
    return stats && Object.keys(stats).length > 0 ? stats : null
}

/**
 * The stats of one metric of a scenario: from the invocation step when it reports the metric,
 * else from the first other step that does. Null when no step reports it.
 */
export function scenarioMetricStats(
    metrics: readonly ScenarioMetricRow[],
    steps: readonly ScenarioMetricStep[],
    metricKey: string,
): MetricStats | null {
    const ordered = [
        ...steps.filter((step) => step.type === "invocation"),
        ...steps.filter((step) => step.type !== "invocation"),
    ]
    for (const step of ordered) {
        const stats = stepMetricStats(metrics, step.key, metricKey)
        if (stats) return stats
    }
    return null
}

/**
 * The stats of one metric that one step of a scenario reports, such as the duration, tokens or
 * cost of an evaluator's own call. Null when the step does not report it.
 */
export function stepMetricStats(
    metrics: readonly ScenarioMetricRow[],
    stepKey: string,
    metricKey: string,
): MetricStats | null {
    for (const row of metrics) {
        const bucket = isRecord(row.data) ? row.data[stepKey] : undefined
        if (!isRecord(bucket)) continue
        const stats = toStats(bucket[metricKey])
        if (stats) return stats
    }
    return null
}

/**
 * The text of a metric cell: a number or a stat blob through {@link formatMetricValue}, a flag or
 * a text as it is, no value as a dash. Null for an object that is not a stat blob: the caller
 * draws it as data.
 */
export function metricCellText(metricKey: string, value: unknown): string | null {
    if (value === undefined || value === null || value === "") return METRIC_PLACEHOLDER
    if (typeof value === "boolean") return String(value)
    if (typeof value === "string") return value
    const stats = toStats(value)
    return stats ? formatMetricValue(metricKey, stats) : null
}
