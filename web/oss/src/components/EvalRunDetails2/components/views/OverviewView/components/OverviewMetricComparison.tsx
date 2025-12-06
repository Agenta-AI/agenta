import {memo, useMemo} from "react"

import {Typography} from "antd"

import type {BasicStats} from "@/oss/lib/metricUtils"

import {DEFAULT_SPIDER_SERIES_COLOR, SPIDER_SERIES_COLORS} from "../constants"
import {useRunMetricData} from "../hooks/useRunMetricData"
import type {AggregatedMetricChartData} from "../types"
import {resolveMetricValue} from "../utils/metrics"

import MetricComparisonCard from "./MetricComparisonCard"

interface OverviewMetricComparisonProps {
    runIds: string[]
}

const OverviewMetricComparison = ({runIds}: OverviewMetricComparisonProps) => {
    const orderedRunIds = useMemo(() => runIds.filter((id): id is string => Boolean(id)), [runIds])
    const {runDescriptors, runColorMap, metricSelections} = useRunMetricData(orderedRunIds)

    const aggregatedMetrics = useMemo(() => {
        if (runDescriptors.length <= 1) {
            return []
        }

        return metricSelections
            .map(({metric, selections}) => {
                const entries = selections
                    .map(({selection, runId, index, runKey}) => {
                        if (selection.state !== "hasData" || !selection.stats) return null
                        const stats = selection.stats as BasicStats
                        const runDescriptor = runDescriptors[index]
                        if (!runDescriptor) return null
                        const scenarioCount =
                            typeof stats.count === "number" && stats.count > 0
                                ? stats.count
                                : undefined
                        return {
                            runKey,
                            runId,
                            runName: runDescriptor.displayName,
                            color:
                                runColorMap.get(runId) ??
                                (index === 0
                                    ? DEFAULT_SPIDER_SERIES_COLOR
                                    : SPIDER_SERIES_COLORS[index % SPIDER_SERIES_COLORS.length]),
                            stats,
                            scenarioCount,
                            summary:
                                resolveMetricValue(stats, scenarioCount ?? undefined) ?? undefined,
                        }
                    })
                    .filter(Boolean) as AggregatedMetricChartData["entries"]

                if (entries.length <= 1) {
                    return null
                }

                return {
                    id: metric.id,
                    label: metric.displayLabel,
                    evaluatorLabel: metric.evaluatorLabel,
                    entries,
                }
            })
            .filter(Boolean) as AggregatedMetricChartData[]
    }, [metricSelections, runColorMap, runDescriptors])

    if (!aggregatedMetrics.length) {
        return null
    }

    return (
        <div className="flex flex-col gap-4">
            <Typography.Title level={5} className="!mb-0">
                Metric comparison
            </Typography.Title>
            <div className="grid gap-4 md:grid-cols-2">
                {aggregatedMetrics.map((metric) => (
                    <MetricComparisonCard key={metric.id} metric={metric} />
                ))}
            </div>
        </div>
    )
}

export default memo(OverviewMetricComparison)
