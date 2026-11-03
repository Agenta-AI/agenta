import {
    booleanTruePercent,
    format3Sig,
    frequencyBars,
    histogramBars,
    isBooleanMetricStats,
    metricSummary,
    type MetricBar,
} from "@agenta/entities/evaluationRun"
import {BarChart} from "@agenta/ui/components/presentational/charts"
import type {BarChartDatum} from "@agenta/ui/components/presentational/charts"
import {useIsNarrowScreen} from "@agenta/ui/hooks"

import {OverviewEmpty} from "../states/OverviewEmpty"

import type {OverviewMetric} from "./useRunOverview"

interface ChartSpec {
    data: BarChartDatum[]
    seriesName: string
    yMax?: number
    formatValue: (value: number) => string
}

const toData = (bars: readonly MetricBar[], runId: string): BarChartDatum[] =>
    bars.map((bar) => ({category: bar.category, values: {[runId]: bar.value}}))

/** Boolean: percent True and False. Categorical: counts per label. Numeric: the histogram. */
function chartSpec(metric: OverviewMetric, runId: string): ChartSpec {
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

/** One evaluator metric: its summary value and its distribution. */
export const MetricCard = ({
    metric,
    runId,
    runName,
}: {
    metric: OverviewMetric
    runId: string
    runName: string
}) => {
    const narrow = useIsNarrowScreen()
    const summary = metricSummary(metric.stats)
    const spec = chartSpec(metric, runId)

    return (
        <section
            aria-label={`${metric.evaluatorName ?? "--"}: ${metric.label}`}
            className="box-border flex min-w-0 flex-col gap-3 rounded-lg border border-solid border-border bg-card p-4"
        >
            <header className="flex min-w-0 flex-col">
                <span className="truncate text-xs text-muted-foreground">
                    {metric.evaluatorName ?? "--"}
                </span>
                <h3 className="m-0 truncate text-sm font-semibold capitalize text-foreground">
                    {metric.label}
                </h3>
            </header>
            {summary ? (
                <p className="m-0 text-xl font-semibold tabular-nums text-foreground">
                    <span title={runName}>{summary.formatted}</span>
                </p>
            ) : null}
            {spec.data.length === 0 ? (
                <OverviewEmpty title="No distribution data available." />
            ) : (
                <BarChart
                    title={`${metric.label} distribution`}
                    height={narrow ? 220 : 320}
                    series={[{key: runId, name: spec.seriesName}]}
                    data={spec.data}
                    yMax={spec.yMax}
                    formatValue={spec.formatValue}
                />
            )}
        </section>
    )
}
