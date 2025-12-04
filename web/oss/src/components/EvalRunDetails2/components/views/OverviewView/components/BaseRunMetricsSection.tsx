import {memo, useMemo} from "react"

import {Alert, Card, Typography} from "antd"

import {isBooleanMetricStats} from "@/oss/components/EvalRunDetails2/utils/metricDistributions"
import type {TemporalMetricPoint} from "@/oss/components/Evaluations/atoms/runMetrics"

import EvaluatorMetricsChart from "../../../EvaluatorMetricsChart"
import {DEFAULT_SPIDER_SERIES_COLOR, SPIDER_SERIES_COLORS} from "../constants"
import {useRunMetricData, type EvaluatorRef} from "../hooks/useRunMetricData"
import {resolveMetricValue} from "../utils/metrics"

import EvaluatorTemporalMetricsChart, {
    TemporalMetricsSeriesEntry,
    TemporalMetricsSeriesPoint,
} from "./EvaluatorTemporalMetricsChart"
import {OverviewEmptyPlaceholder, OverviewLoadingPlaceholder} from "./OverviewPlaceholders"

interface TemporalChartEntry {
    key: string
    metricLabel: string
    metricKey: string
    evaluatorRef: EvaluatorRef | null
    fallbackLabel: string
    isBoolean: boolean
    series: TemporalMetricsSeriesEntry[]
}

interface BaseRunMetricsSectionProps {
    baseRunId: string
    comparisonRunIds: string[]
}

const BaseRunMetricsSection = ({baseRunId, comparisonRunIds}: BaseRunMetricsSectionProps) => {
    const runIds = useMemo(
        () =>
            [baseRunId, ...comparisonRunIds].filter(
                (id): id is string => typeof id === "string" && id.length > 0,
            ),
        [baseRunId, comparisonRunIds],
    )
    const {
        runDescriptors,
        runColorMap,
        metricSelections,
        isLoading: metricsLoading,
        hasResolvedMetrics,
        hasTemporalMetrics,
        temporalSeriesByMetric,
    } = useRunMetricData(runIds)

    const baseDescriptor = runDescriptors[0]
    const runDisplayName = baseDescriptor?.displayName ?? baseRunId

    const baseColor =
        runColorMap.get(baseRunId) ?? SPIDER_SERIES_COLORS[0] ?? DEFAULT_SPIDER_SERIES_COLOR

    const comparisonMeta = useMemo(
        () =>
            runDescriptors.slice(1).map((descriptor, index) => ({
                runId: descriptor.runId,
                runName: descriptor.displayName,
                color:
                    runColorMap.get(descriptor.runId) ??
                    SPIDER_SERIES_COLORS[(index + 1) % SPIDER_SERIES_COLORS.length] ??
                    DEFAULT_SPIDER_SERIES_COLOR,
            })),
        [runColorMap, runDescriptors],
    )

    const {chartEntries, hasLoading, errorMessage, attemptedMetrics} = useMemo(() => {
        const entries: {
            key: string
            evaluatorRef?: EvaluatorRef | null
            fallbackLabel: string
            metricLabel: string
            metricPath: string
            metricKey: string
            stepKey: string
        }[] = []

        let loading = false
        let error: string | null = null
        let attempted = 0

        metricSelections.forEach(({metric, selections}) => {
            if (metric.evaluatorLabel === "Invocation") {
                return
            }
            const isStringMetric = metric.metricType?.toLowerCase?.() === "string"
            if (isStringMetric) {
                return
            }
            attempted += 1
            const baseSelectionEntry = selections[0]
            if (!baseSelectionEntry) return
            const baseSelection = baseSelectionEntry.selection

            if (baseSelection.state === "loading" && !baseSelection.stats) {
                loading = true
            }

            if (baseSelection.state === "hasError" && !error) {
                error =
                    typeof baseSelection.error === "string"
                        ? baseSelection.error
                        : "Unable to load evaluator metrics."
            }

            if (baseSelection.state !== "hasData" || !baseSelection.stats) {
                return
            }

            entries.push({
                key: metric.id,
                evaluatorRef: metric.evaluatorRef ?? null,
                fallbackLabel: metric.fallbackEvaluatorLabel ?? metric.evaluatorLabel,
                metricLabel: metric.displayLabel,
                metricPath: metric.fullKey,
                metricKey: metric.rawKey,
                stepKey: metric.stepKey,
            })
        })

        const result = {
            chartEntries: entries,
            hasLoading: loading,
            errorMessage: error,
            attemptedMetrics: attempted,
        }

        return result
    }, [metricSelections, baseRunId, hasTemporalMetrics])

    const temporalCharts = useMemo<TemporalChartEntry[]>(() => {
        if (!hasTemporalMetrics) return []

        const convertPoint = (point: TemporalMetricPoint) => {
            const resolved = resolveMetricValue(
                point.stats,
                point.stats.count as number | undefined,
            )
            const value = resolved?.value
            if (typeof value !== "number" || Number.isNaN(value)) return null

            const extractPercentile = (stats: any, key: string) => {
                if (typeof stats?.[key] === "number") return stats[key]
                const pcts = stats?.pcts
                if (pcts && typeof pcts[key] === "number") return pcts[key]
                return undefined
            }

            const histogramRaw = (point.stats as any)?.hist
            const histogram = Array.isArray(histogramRaw)
                ? histogramRaw
                      .map((bin: any) => {
                          const interval = Array.isArray(bin?.interval) ? bin.interval : []
                          if (interval.length < 2) return null
                          const from = Number(interval[0])
                          const to = Number(interval[1])
                          const count = Number(bin?.count ?? 0)
                          if (!Number.isFinite(from) || !Number.isFinite(to)) return null
                          return {from, to, count}
                      })
                      .filter(
                          (bin): bin is {from: number; to: number; count: number} => bin !== null,
                      )
                : undefined

            return {
                timestamp: point.timestamp,
                value,
                scenarioCount:
                    typeof point.stats.count === "number" && Number.isFinite(point.stats.count)
                        ? (point.stats.count as number)
                        : undefined,
                p25: extractPercentile(point.stats, "p25"),
                p50: extractPercentile(point.stats, "p50"),
                p75: extractPercentile(point.stats, "p75"),
                histogram: histogram && histogram.length ? histogram : undefined,
            }
        }

        return metricSelections
            .map(({metric}) => {
                if (!metric.stepKey) return null
                if (metric.metricType?.toLowerCase?.() === "string") return null
                const seriesKey = `${metric.stepKey}:${metric.canonicalKey}`
                const rawSeries = temporalSeriesByMetric[seriesKey]
                if (!rawSeries || !rawSeries.length) return null
                const convertedPoints = rawSeries
                    .map(convertPoint)
                    .filter((pt): pt is TemporalMetricsSeriesPoint => Boolean(pt))
                if (!convertedPoints.length) return null

                const isBooleanSeries = rawSeries.every(({stats}) => isBooleanMetricStats(stats))

                return {
                    key: metric.id,
                    metricLabel: metric.displayLabel,
                    metricKey: metric.rawKey,
                    evaluatorRef: metric.evaluatorRef ?? null,
                    fallbackLabel: metric.fallbackEvaluatorLabel ?? metric.evaluatorLabel,
                    isBoolean: isBooleanSeries,
                    series: [
                        {
                            id: baseRunId,
                            name: runDisplayName,
                            color: baseColor,
                            points: convertedPoints,
                        },
                    ],
                }
            })
            .filter(Boolean) as TemporalChartEntry[]
    }, [
        hasTemporalMetrics,
        metricSelections,
        temporalSeriesByMetric,
        baseRunId,
        runDisplayName,
        baseColor,
    ])

    const renderTemporalContent = () => {
        if (!temporalCharts.length) {
            return (
                <OverviewEmptyPlaceholder
                    minHeight={240}
                    title="Temporal evaluator metrics"
                    description="We will chart evaluator scores here as soon as this online run collects trace results for the selected evaluators."
                />
            )
        }

        return (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {temporalCharts.map((entry) => (
                    <div key={entry.key}>
                        <EvaluatorTemporalMetricsChart
                            name={entry.metricLabel}
                            metricKey={entry.metricKey}
                            series={entry.series}
                            isBoolean={entry.isBoolean}
                            placeholderTitle={`${entry.fallbackLabel} metrics are on the way`}
                            placeholderDescription="Keep streaming queries that match this evaluation to populate the timeline."
                        />
                    </div>
                ))}
            </div>
        )
    }

    const renderContent = () => {
        if (hasTemporalMetrics) {
            return renderTemporalContent()
        }

        if (errorMessage && chartEntries.length === 0) {
            return (
                <Alert
                    className="m-4"
                    type="error"
                    message="Unable to load evaluator metrics"
                    description={errorMessage}
                />
            )
        }

        const showLoadingState =
            (!hasResolvedMetrics || metricsLoading || hasLoading) &&
            chartEntries.length === 0 &&
            !errorMessage

        if (showLoadingState) {
            return (
                <OverviewLoadingPlaceholder
                    minHeight={240}
                    title="Preparing evaluator metrics"
                    description="Hang tight while we gather evaluator outputs and aggregate their metrics."
                />
            )
        }

        if (chartEntries.length === 0) {
            const hasAttemptedEvaluatorMetrics = attemptedMetrics > 0
            // if (
            //     process.env.NEXT_PUBLIC_EVAL_RUN_DEBUG === "true" &&
            //     typeof window !== "undefined"
            // ) {
            //     console.debug("[EvalRunOverview][Metrics] Empty state", {
            //         baseRunId,
            //         hasAttemptedEvaluatorMetrics,
            //         attemptedMetrics,
            //         hasTemporalMetrics,
            //     })
            // }
            return (
                <OverviewEmptyPlaceholder
                    minHeight={240}
                    title={
                        hasAttemptedEvaluatorMetrics
                            ? "No metric values generated"
                            : "No evaluator metrics available"
                    }
                    description={
                        hasAttemptedEvaluatorMetrics
                            ? "The evaluator metrics defined for this run did not emit any values. Check evaluator configurations or rerun with evaluation outputs enabled."
                            : "This run does not include evaluator metrics yet. Trigger a run with evaluators to see charts here."
                    }
                />
            )
        }

        return (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {chartEntries.map((entry) => (
                    <div key={entry.key}>
                        <EvaluatorMetricsChart
                            runId={baseRunId}
                            runDisplayName={runDisplayName}
                            baseColor={baseColor}
                            evaluatorRef={entry.evaluatorRef ?? null}
                            fallbackEvaluatorLabel={entry.fallbackLabel}
                            metricLabel={entry.metricLabel}
                            metricPath={entry.metricPath}
                            metricKey={entry.metricKey}
                            stepKey={entry.stepKey}
                            comparisons={comparisonMeta}
                        />
                    </div>
                ))}
            </div>
        )
    }

    return (
        <Card
            variant="outlined"
            title={
                <div className="flex items-center gap-2">
                    <Typography.Text strong>{runDisplayName}</Typography.Text>
                </div>
            }
        >
            <div className="flex flex-col gap-6">
                <div>{renderContent()}</div>
            </div>
        </Card>
    )
}

export default memo(BaseRunMetricsSection)
