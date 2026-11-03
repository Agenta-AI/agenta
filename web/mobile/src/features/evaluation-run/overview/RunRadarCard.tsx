import {useMemo} from "react"

import {
    format3Sig,
    formatCost,
    formatDuration,
    radarAxes,
    type RadarMetricInput,
} from "@agenta/entities/evaluationRun"
import {RadarChart} from "@agenta/ui/components/presentational/charts"
import type {RadarAxis} from "@agenta/ui/components/presentational/charts"
import {useIsNarrowScreen} from "@agenta/ui/hooks"

import {ChartSkeleton} from "../states/ChartSkeleton"
import {OverviewEmpty} from "../states/OverviewEmpty"

import type {OverviewMetric} from "./useRunOverview"

const formatAxisValue = (raw: number, axis: RadarAxis) => {
    if (axis.name === "Cost") return formatCost(raw)
    if (axis.name === "Duration") return formatDuration(raw)
    return axis.max === 100 ? `${raw.toFixed(2)}%` : format3Sig(raw)
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
    const axes = useMemo(() => {
        const inputs: RadarMetricInput[] = metrics.map((metric) => ({
            id: metric.id,
            kind: metric.kind,
            name:
                metric.kind === "evaluator"
                    ? `${metric.evaluatorName ?? "--"}: ${metric.label}`
                    : metric.label,
            stats: metric.stats,
        }))
        return radarAxes({[runId]: inputs}, [runId])
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
