/**
 * The "Metrics" chart of the Overview tab as data: one value per metric on one 0 to 1 scale, the
 * metrics ordered lowest first, and the default selection of the metric picker. Pure: no React.
 *
 * @packageDocumentation
 */

import {chartValue, isUnitScale, type EvaluatorRow} from "./evaluatorRows"

/** The picker shows at most this many metrics by default. */
const METRICS_CHART_DEFAULT_COUNT = 16

/** The evaluator rows of one run. Compare passes one entry per run. */
export interface MetricsChartRun {
    key: string
    rows: readonly EvaluatorRow[]
}

export interface ChartMetric {
    /**
     * `{evaluatorId or stepKey}:{metricKey}`: the same metric in every run that has the evaluator
     * id (a step key can differ between runs). Two steps of one evaluator in one run (two
     * revisions) use their step keys, so neither replaces the other.
     */
    id: string
    evaluatorName: string
    /** The metric label, without the evaluator name. */
    label: string
    /**
     * The bar name: the evaluator name, plus the metric label when the evaluator has several.
     * Unique in the model ("(2)", "(3)" on a repeated name), so the charts can key by it.
     */
    name: string
    /** A binary value is a pass rate; a numeric value is a mean on 0 to 1. */
    kind: "binary" | "numeric"
    /** By run key; null when that run has no value. */
    values: Record<string, number | null>
}

export interface MetricsChartModel {
    /** Every chartable metric, lowest value of the first run first. */
    metrics: ChartMetric[]
    /** Numeric metrics with results that are not on a 0 to 1 scale, so not in the chart. */
    offScale: number
}

const metricIdOf = (row: EvaluatorRow, metricKey: string, byStep: boolean) =>
    `${(!byStep && row.evaluatorId) || row.stepKey}:${metricKey}`

/** The evaluator ids that more than one row of a run has. */
const sharedEvaluatorIds = (rows: readonly EvaluatorRow[]) => {
    const seen = new Set<string>()
    const shared = new Set<string>()
    for (const {evaluatorId} of rows) {
        if (evaluatorId === null) continue
        if (seen.has(evaluatorId)) shared.add(evaluatorId)
        seen.add(evaluatorId)
    }
    return shared
}

/**
 * The chart values of the runs (decisions 3 and 5): the pass rate of a binary metric and the mean
 * of a numeric metric on 0 to 1. Categorical metrics are left out; so are numeric metrics off the
 * 0 to 1 scale, which `offScale` counts.
 */
export function buildMetricsChart(runs: readonly MetricsChartRun[]): MetricsChartModel {
    const byId = new Map<string, ChartMetric>()
    const offScaleIds = new Set<string>()
    for (const run of runs) {
        const shared = sharedEvaluatorIds(run.rows)
        for (const row of run.rows) {
            const byStep = row.evaluatorId !== null && shared.has(row.evaluatorId)
            for (const metric of row.metrics) {
                if (metric.kind !== "binary" && metric.kind !== "numeric") continue
                const id = metricIdOf(row, metric.metricKey, byStep)
                const value = chartValue(metric.stats)
                if (value === null) {
                    if (metric.kind === "numeric" && metric.stats && !isUnitScale(metric.stats)) {
                        offScaleIds.add(id)
                    }
                    continue
                }
                const entry = byId.get(id) ?? {
                    id,
                    evaluatorName: row.name,
                    label: metric.label,
                    name: row.metrics.length > 1 ? `${row.name}: ${metric.label}` : row.name,
                    kind: metric.kind,
                    values: Object.fromEntries(runs.map((r) => [r.key, null])),
                }
                entry.values[run.key] = value
                byId.set(id, entry)
            }
        }
    }
    // Unique names in row order, so a poll that reorders the bars does not move a "(2)". A
    // generated name never takes a real name of another metric.
    const realNames = new Set([...byId.values()].map((metric) => metric.name))
    const taken = new Set<string>()
    for (const metric of byId.values()) {
        let name = metric.name
        for (let n = 2; taken.has(name) || (name !== metric.name && realNames.has(name)); n++) {
            name = `${metric.name} (${n})`
        }
        taken.add(name)
        metric.name = name
    }
    const first = runs[0]?.key
    const valueOf = (metric: ChartMetric) =>
        first === undefined ? null : (metric.values[first] ?? null)
    const metrics = [...byId.values()].sort((a, b) => {
        const va = valueOf(a)
        const vb = valueOf(b)
        if (va === null || vb === null) return va === null ? (vb === null ? 0 : 1) : -1
        return va - vb || a.name.localeCompare(b.name)
    })
    // A metric on the scale in one run and off it in another is in the chart.
    const offScale = [...offScaleIds].filter((id) => !byId.has(id)).length
    return {metrics, offScale}
}

/**
 * The default selection of the picker: every metric when there are at most 16, else the 16
 * lowest. `metrics` is ordered lowest first (see {@link buildMetricsChart}).
 */
export function defaultChartSelection(metrics: readonly ChartMetric[]): string[] {
    return metrics.slice(0, METRICS_CHART_DEFAULT_COUNT).map((metric) => metric.id)
}
