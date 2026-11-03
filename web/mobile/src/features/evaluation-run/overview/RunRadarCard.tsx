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

/** The radar of a run's evaluator scores, with Duration and Cost added when there are few. */
export const RunRadarCard = ({
    runId,
    runName,
    metrics,
    pending,
}: {
    runId: string
    runName: string
    metrics: readonly OverviewMetric[]
    pending: boolean
}) => {
    const narrow = useIsNarrowScreen()
    const {axes, formatAxisValue} = useMemo(() => {
        const inputs: RadarMetricInput[] = metrics.map((metric) => ({
            id: metric.id,
            kind: metric.kind,
            name:
                metric.kind === "evaluator"
                    ? `${metric.evaluatorName ?? "--"}: ${metric.label}`
                    : metric.label,
            stats: metric.stats,
        }))
        const unitByName = new Map(inputs.map((input) => [input.name, unitOf(input)] as const))
        return {
            axes: radarAxes({[runId]: inputs}, [runId]),
            formatAxisValue: axisFormatter(unitByName),
        }
    }, [metrics, runId])

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
            title={`Evaluator scores of ${runName}`}
            height={narrow ? 260 : 320}
            series={[{key: runId, name: runName}]}
            axes={axes}
            formatAxisValue={formatAxisValue}
        />
    )
}
