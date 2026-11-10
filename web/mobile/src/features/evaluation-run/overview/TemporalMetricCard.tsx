import {useMemo} from "react"

import {
    booleanTruePercent,
    frequencyBars,
    isBooleanMetricStats,
    metricSummary,
    type MetricStats,
} from "@agenta/entities/evaluationRun"
import {LineChart} from "@agenta/ui/components/presentational/charts"
import type {ChartSeries, LinePoint} from "@agenta/ui/components/presentational/charts"
import {useIsNarrowScreen} from "@agenta/ui/hooks"

import {OverviewEmpty} from "../states/OverviewEmpty"

import type {OverviewMetric} from "./useRunOverview"

const MAX_CATEGORY_LINES = 5

interface TimeChart {
    series: ChartSeries[]
    points: LinePoint[]
    yDomain?: readonly [number, number]
}

/**
 * Boolean: the share of true, 0..1. Numeric: the mean (else median, else max). Categorical: one
 * line per frequent value, with its count.
 */
function timeChart(metric: OverviewMetric, runId: string, runName: string): TimeChart {
    const latest = metric.temporal.at(-1)?.stats ?? null
    if (isBooleanMetricStats(latest)) {
        return {
            series: [{key: runId, name: runName}],
            points: metric.temporal.map(({timestamp, stats}) => {
                const percent = booleanTruePercent(stats)
                return {x: timestamp, values: {[runId]: percent === null ? null : percent / 100}}
            }),
            yDomain: [0, 1],
        }
    }
    if (metricSummary(latest)) {
        return {
            series: [{key: runId, name: runName}],
            points: metric.temporal.map(({timestamp, stats}) => ({
                x: timestamp,
                values: {[runId]: metricSummary(stats)?.value ?? null},
            })),
        }
    }
    // Rank values over every point, so a value missing from the latest point keeps its history.
    const totals = new Map<string, number>()
    for (const {stats} of metric.temporal) {
        for (const bar of frequencyBars(stats)) {
            totals.set(bar.category, (totals.get(bar.category) ?? 0) + bar.value)
        }
    }
    const categories = [...totals.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, MAX_CATEGORY_LINES)
        .map(([category]) => category)
    const countOf = (stats: MetricStats, category: string) =>
        frequencyBars(stats).find((bar) => bar.category === category)?.value ?? 0
    return {
        series: categories.map((category) => ({key: category, name: category})),
        points: metric.temporal.map(({timestamp, stats}) => ({
            x: timestamp,
            values: Object.fromEntries(
                categories.map((category) => [category, countOf(stats, category)]),
            ),
        })),
    }
}

/** An online run's metric over time: one point per refresh of the live run. */
export const TemporalMetricCard = ({
    metric,
    runId,
    runName,
}: {
    metric: OverviewMetric
    runId: string
    runName: string
}) => {
    const narrow = useIsNarrowScreen()
    const chart = useMemo(() => timeChart(metric, runId, runName), [metric, runId, runName])
    // The whole run's value, the same number the summary table shows. The newest point covers one
    // minute only, so a minute with two failures read "0.00%" next to a 95.45% run. A run with no
    // run-wide row shows no value, as the old app does.
    const runValue = metric.statsAreRunWide ? metricSummary(metric.stats) : null
    const evaluator = metric.evaluatorName ?? "Evaluator"

    return (
        <section
            aria-label={`${evaluator}: ${metric.label}`}
            className="box-border flex min-w-0 flex-col gap-3 rounded-lg border border-solid border-border bg-card p-4"
        >
            <header className="flex min-w-0 flex-col">
                <span className="truncate text-xs text-muted-foreground">{evaluator}</span>
                <h3 className="m-0 truncate text-sm font-semibold capitalize text-foreground">
                    {metric.label}
                </h3>
                <span className="truncate text-xs text-muted-foreground">{metric.metricKey}</span>
                {runValue ? (
                    <span className="mt-1 text-sm tabular-nums text-foreground">
                        {runName}: {runValue.formatted}
                    </span>
                ) : null}
            </header>
            {chart.points.length === 0 || chart.series.length === 0 ? (
                <OverviewEmpty
                    title={`${evaluator} metrics are on the way`}
                    description="Keep streaming queries that match this evaluation to populate the timeline."
                />
            ) : (
                <LineChart
                    title={`${evaluator}: ${metric.label} over time`}
                    height={narrow ? 220 : 280}
                    series={chart.series}
                    points={chart.points}
                    yDomain={chart.yDomain}
                />
            )}
        </section>
    )
}
