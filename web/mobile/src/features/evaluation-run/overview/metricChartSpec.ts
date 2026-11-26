import {
    booleanTruePercent,
    format3Sig,
    frequencyBars,
    histogramBars,
    isBooleanMetricStats,
    type MetricBar,
} from "@agenta/entities/evaluationRun"
import type {BarChartDatum} from "@agenta/ui/components/presentational/charts"

import type {OverviewMetric} from "./useRunOverview"

export interface MetricChartSpec {
    data: BarChartDatum[]
    seriesName: string
    yMax?: number
    formatValue: (value: number) => string
}

const toData = (bars: readonly MetricBar[], runId: string): BarChartDatum[] =>
    bars.map((bar) => ({category: bar.category, values: {[runId]: bar.value}}))

/** Boolean: percent True and False. Categorical: counts per label. Numeric: the histogram. */
export function metricChartSpec(metric: OverviewMetric, runId: string): MetricChartSpec {
    const {stats} = metric
    if (isBooleanMetricStats(stats)) {
        const percent = booleanTruePercent(stats)
        return {
            data:
                percent === null
                    ? []
                    : toData(
                          [
                              {category: "True", value: percent},
                              {category: "False", value: 100 - percent},
                          ],
                          runId,
                      ),
            seriesName: "Percentage",
            yMax: 100,
            formatValue: (value) => `${Math.round(value)}%`,
        }
    }
    if (stats?.distribution?.length) {
        return {
            data: toData(histogramBars(stats), runId),
            seriesName: metric.label,
            formatValue: format3Sig,
        }
    }
    return {
        data: toData(frequencyBars(stats), runId),
        seriesName: "Count",
        formatValue: (value) => String(Math.round(value)),
    }
}
