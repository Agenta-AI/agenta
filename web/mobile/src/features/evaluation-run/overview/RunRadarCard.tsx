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

/** The radar axes of the runs, with Duration and Cost added when there are few. */
export const useRunRadar = (runs: readonly RadarRun[]) =>
    useMemo(() => {
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

/** A radar needs three axes; while the metrics load it holds its place with a skeleton. */
export const showsRadar = (axisCount: number, pending: boolean): boolean =>
    axisCount >= 3 || (pending && axisCount === 0)

/** The evaluator-score radar of a run and its compared runs; shown only when `showsRadar` holds. */
export const RunRadarCard = ({
    runs,
    radar,
}: {
    runs: readonly RadarRun[]
    radar: ReturnType<typeof useRunRadar>
}) => {
    const narrow = useIsNarrowScreen()
    if (radar.axes.length === 0) {
        return <ChartSkeleton label="Preparing run overview" height={narrow ? 220 : 300} />
    }
    return (
        <RadarChart
            title={runs.length === 1 ? `Evaluator scores of ${runs[0].name}` : "Evaluator scores"}
            height={narrow ? 260 : 320}
            series={runs.map((run) => ({key: run.id, name: run.name}))}
            axes={radar.axes}
            formatAxisValue={radar.formatAxisValue}
        />
    )
}
