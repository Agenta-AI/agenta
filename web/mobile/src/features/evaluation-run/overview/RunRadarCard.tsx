import {useMemo} from "react"

import {
    format3Sig,
    formatCost,
    formatDuration,
    isBooleanMetricStats,
    radarAxes,
    type RadarMetricInput,
} from "@agenta/entities/evaluationRun"
import {RadarChart} from "@agenta/ui/components/presentational/charts"
import type {RadarAxis} from "@agenta/ui/components/presentational/charts"
import {useIsNarrowScreen} from "@agenta/ui/hooks"

import {ChartSkeleton} from "../states/ChartSkeleton"
import {OverviewEmpty} from "../states/OverviewEmpty"

import type {OverviewMetric} from "./useRunOverview"

type AxisUnit = "cost" | "duration" | "percent" | "number"

const unitOf = (input: RadarMetricInput): AxisUnit => {
    if (input.kind === "invocation" && (input.id === "cost" || input.id === "duration")) {
        return input.id
    }
    return isBooleanMetricStats(input.stats) ? "percent" : "number"
}

/** Cost and duration axes read as money and time, boolean axes as a percent. */
const axisFormatter =
    (unitByName: ReadonlyMap<string, AxisUnit>) => (raw: number, axis: RadarAxis) => {
        const unit = unitByName.get(axis.name)
        if (unit === "cost") return formatCost(raw)
        if (unit === "duration") return formatDuration(raw)
        if (unit === "percent") return `${raw.toFixed(2)}%`
        return format3Sig(raw)
    }

/** One run on the radar: a series in the run's color. */
export interface RadarRun {
    id: string
    name: string
    metrics: readonly OverviewMetric[]
}

const radarInputs = (metrics: readonly OverviewMetric[]): RadarMetricInput[] =>
    metrics.map((metric) => ({
        id: metric.id,
        kind: metric.kind,
        name:
            metric.kind === "evaluator"
                ? `${metric.evaluatorName ?? "--"}: ${metric.label}`
                : metric.label,
        stats: metric.stats,
    }))

/**
 * The radar of the evaluator scores of one run, or of a run and the runs compared with it (one
 * series each), with Duration and Cost added when there are few. A metric has the same id in
 * every run.
 */
export const RunRadarCard = ({runs, pending}: {runs: readonly RadarRun[]; pending: boolean}) => {
    const narrow = useIsNarrowScreen()
    const {axes, formatAxisValue} = useMemo(() => {
        const inputsByRun = Object.fromEntries(
            runs.map((run) => [run.id, radarInputs(run.metrics)]),
        )
        const unitByName = new Map(
            Object.values(inputsByRun)
                .flat()
                .map((input) => [input.name, unitOf(input)] as const),
        )
        return {
            axes: radarAxes(
                inputsByRun,
                runs.map((run) => run.id),
            ),
            formatAxisValue: axisFormatter(unitByName),
        }
    }, [runs])

    if (pending && axes.length === 0) {
        return <ChartSkeleton label="Preparing run overview" height={narrow ? 220 : 300} />
    }
    if (axes.length === 0) {
        return (
            <OverviewEmpty
                title="Metrics not available"
                description="No evaluator or invocation metrics have been recorded for these runs yet."
            />
        )
    }
    if (axes.length < 3) {
        return (
            <OverviewEmpty
                title="Insufficient metrics for spider chart"
                description="At least 3 metrics are required to display the radar chart. Add more evaluators or wait for invocation metrics."
            />
        )
    }
    return (
        <RadarChart
            title={runs.length === 1 ? `Evaluator scores of ${runs[0].name}` : "Evaluator scores"}
            height={narrow ? 260 : 320}
            series={runs.map((run) => ({key: run.id, name: run.name}))}
            axes={axes}
            formatAxisValue={formatAxisValue}
        />
    )
}
