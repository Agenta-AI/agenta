import {useMemo} from "react"

import {
    booleanTruePercent,
    isBooleanMetricStats,
    metricSummary,
} from "@agenta/entities/evaluationRun"
import {LineChart} from "@agenta/ui/components/presentational/charts"
import {useIsNarrowScreen} from "@agenta/ui/hooks"

import {OverviewEmpty} from "../states/OverviewEmpty"

import type {OverviewMetric} from "./useRunOverview"

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
    const isBoolean = isBooleanMetricStats(metric.stats)
    const points = useMemo(
        () =>
            metric.temporal.map(({timestamp, stats}) => {
                const percent = isBoolean ? booleanTruePercent(stats) : null
                const value = isBoolean
                    ? percent === null
                        ? null
                        : percent / 100
                    : (metricSummary(stats)?.value ?? null)
                return {x: timestamp, values: {[runId]: value}}
            }),
        [metric.temporal, isBoolean, runId],
    )
    const latest = metricSummary(metric.temporal.at(-1)?.stats ?? null)

    return (
        <section
            aria-label={metric.label}
            className="box-border flex min-w-0 flex-col gap-3 rounded-lg border border-solid border-border bg-card p-4"
        >
            <header className="flex min-w-0 flex-col">
                <h3 className="m-0 truncate text-sm font-semibold capitalize text-foreground">
                    {metric.label}
                </h3>
                <span className="truncate text-xs text-muted-foreground">{metric.metricKey}</span>
                {latest ? (
                    <span className="mt-1 text-sm tabular-nums text-foreground">
                        {runName}: {latest.formatted}
                    </span>
                ) : null}
            </header>
            {points.length === 0 ? (
                <OverviewEmpty
                    title={`${metric.evaluatorName ?? "Evaluator"} metrics are on the way`}
                    description="Keep streaming queries that match this evaluation to populate the timeline."
                />
            ) : (
                <LineChart
                    title={`${metric.label} over time`}
                    height={narrow ? 220 : 280}
                    series={[{key: runId, name: runName}]}
                    points={points}
                    yDomain={isBoolean ? [0, 1] : undefined}
                />
            )}
        </section>
    )
}
