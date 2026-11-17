import {compareDelta, mergeCompareBars, metricSummary} from "@agenta/entities/evaluationRun"
import {BarChart} from "@agenta/ui/components/presentational/charts"
import {useIsNarrowScreen} from "@agenta/ui/hooks"

import {cn} from "@/lib/utils"

import {metricChartSpec} from "../../overview/metricChartSpec"
import type {OverviewMetric} from "../../overview/useRunOverview"
import {OverviewEmpty} from "../../states/OverviewEmpty"
import {compareColor} from "../compareColor"

/** One run's side of a compared metric; `metric` is null when the run did not report it. */
export interface CompareMetricRun {
    runId: string
    slot: number
    name: string
    metric: OverviewMetric | null
}

const DELTA_TONE = {
    positive: "text-success",
    negative: "text-error",
    neutral: "text-muted-foreground",
} as const

/**
 * One evaluator metric of every compared run, as the old app draws it: each run's value in its
 * color with the change against the base run under it, and one bar per run in the distribution.
 */
export const CompareMetricCard = ({runs}: {runs: readonly CompareMetricRun[]}) => {
    const narrow = useIsNarrowScreen()
    const first = runs.find((run) => run.metric)?.metric
    if (!first) return null
    const baseValue = metricSummary(runs[0]?.metric?.stats)?.value
    const specs = runs.map((run) => (run.metric ? metricChartSpec(run.metric, run.runId) : null))
    const shape = specs.find((spec) => spec && spec.data.length > 0) ?? null
    const data = mergeCompareBars(specs.map((spec) => spec?.data ?? []))
    const evaluator = first.evaluatorName ?? "--"

    return (
        <section
            aria-label={`${evaluator}: ${first.label}`}
            className="box-border flex min-w-0 flex-col gap-3 rounded-lg border border-solid border-border bg-card p-4"
        >
            <header className="flex min-w-0 flex-col">
                <span className="truncate text-xs text-muted-foreground">{evaluator}</span>
                <h3 className="m-0 truncate text-sm font-semibold capitalize text-foreground">
                    {first.label}
                </h3>
            </header>
            <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0">
                {runs.map((run, index) => {
                    const summary = metricSummary(run.metric?.stats)
                    const delta = index === 0 ? null : compareDelta(summary?.value, baseValue)
                    return (
                        <li key={run.runId} className="flex flex-col items-center">
                            <span className="sr-only">{run.name}</span>
                            <span
                                className="text-lg font-semibold tabular-nums"
                                style={{color: compareColor(run.slot)}}
                            >
                                {summary?.formatted ?? "—"}
                            </span>
                            <span
                                className={cn(
                                    "text-xs tabular-nums",
                                    DELTA_TONE[delta?.tone ?? "neutral"],
                                )}
                            >
                                {delta?.text ?? "-"}
                            </span>
                        </li>
                    )
                })}
            </ul>
            {!shape || data.length === 0 ? (
                <OverviewEmpty title="No distribution data available." />
            ) : (
                <BarChart
                    title={`${first.label} distribution`}
                    height={narrow ? 220 : 320}
                    series={runs.map((run) => ({key: run.runId, name: run.name}))}
                    data={data}
                    yMax={shape.yMax}
                    formatValue={shape.formatValue}
                />
            )}
        </section>
    )
}
