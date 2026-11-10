import {metricSummary} from "@agenta/entities/evaluationRun"
import {BarChart} from "@agenta/ui/components/presentational/charts"
import {useIsNarrowScreen} from "@agenta/ui/hooks"

import {OverviewEmpty} from "../states/OverviewEmpty"

import {metricChartSpec} from "./metricChartSpec"
import type {OverviewMetric} from "./useRunOverview"

/** One evaluator metric: its summary value and its distribution. */
export const MetricCard = ({metric, runId}: {metric: OverviewMetric; runId: string}) => {
    const narrow = useIsNarrowScreen()
    const summary = metricSummary(metric.stats)
    const spec = metricChartSpec(metric, runId)

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
                    {summary.formatted}
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
