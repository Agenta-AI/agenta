import {memo, useMemo} from "react"

import {Card, Skeleton, Typography} from "antd"
import clsx from "clsx"
import {atom, useAtomValue} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {previewRunMetricStatsSelectorFamily} from "@/oss/components/evaluations/atoms/runMetrics"
import type {BasicStats} from "@/oss/lib/metricUtils"

import {evaluationEvaluatorsByRunQueryAtomFamily} from "../../atoms/table/evaluators"
import {buildBooleanHistogram, isBooleanMetricStats} from "../../utils/metricDistributions"

import HistogramChart from "./HistogramChart"
import {buildHistogramChartData} from "./utils/chartData"

const format3Sig = (value: number) => {
    if (!Number.isFinite(value)) return String(value)
    const abs = Math.abs(value)
    if (abs !== 0 && (abs < 0.001 || abs >= 1000)) return value.toExponential(2)
    const s = value.toPrecision(3)
    return String(Number(s))
}

interface ComparisonSeriesEntry {
    runId: string
    runName: string
    color: string
}

interface EvaluatorMetricsChartProps {
    runId: string
    runDisplayName?: string
    baseColor?: string
    evaluatorRef?: {id?: string | null; slug?: string | null} | null
    fallbackEvaluatorLabel: string
    metricLabel: string
    metricPath: string
    metricKey?: string
    stepKey?: string
    comparisons?: ComparisonSeriesEntry[]
    className?: string
}

interface EvaluatorLabelProps {
    runId: string
    evaluatorRef?: {id?: string | null; slug?: string | null} | null
    fallbackLabel: string
}

const EvaluatorMetricsChartTitle = memo(
    ({runId, evaluatorRef, fallbackLabel}: EvaluatorLabelProps) => {
        const evaluatorAtom = useMemo(
            () => evaluationEvaluatorsByRunQueryAtomFamily(runId),
            [runId],
        )
        const evaluatorQuery = useAtomValue(evaluatorAtom)
        const evaluatorDefinitions = evaluatorQuery?.data ?? null

        const resolvedLabel = useMemo(() => {
            if (!evaluatorRef) {
                return fallbackLabel
            }
            const match = (evaluatorDefinitions ?? []).find((def) => {
                if (evaluatorRef.id && def.id === evaluatorRef.id) return true
                if (evaluatorRef.slug && def.slug === evaluatorRef.slug) return true
                return false
            })
            return match?.name || match?.slug || fallbackLabel
        }, [evaluatorDefinitions, evaluatorRef?.id, evaluatorRef?.slug, fallbackLabel])

        return (
            <Typography.Text className="text-sm font-medium text-neutral-900">
                {resolvedLabel}
            </Typography.Text>
        )
    },
)
EvaluatorMetricsChartTitle.displayName = "EvaluatorMetricsChartTitle"

const EvaluatorMetricsChart = ({
    runId,
    runDisplayName,
    baseColor,
    evaluatorRef,
    fallbackEvaluatorLabel,
    metricLabel,
    metricPath,
    metricKey,
    stepKey,
    comparisons,
    className,
}: EvaluatorMetricsChartProps) => {
    const selectorAtom = useMemo(
        () =>
            previewRunMetricStatsSelectorFamily({
                runId,
                metricPath,
                metricKey,
                stepKey,
            }),
        [runId, metricKey, metricPath, stepKey],
    )
    const selection = useAtomValueWithSchedule(selectorAtom, {priority: LOW_PRIORITY})

    const resolvedStats = selection.state === "hasData" ? selection.stats : undefined

    const effectiveScenarioCount =
        typeof selection.stats?.count === "number" ? selection.stats.count : undefined

    const isLoading = selection.state === "loading" && !resolvedStats
    const hasError = selection.state === "hasError"

    const stats = useMemo<BasicStats>(() => {
        if (resolvedStats) return resolvedStats
        return {} as BasicStats
    }, [resolvedStats])

    const {data: numericHistogramData} = useMemo(() => {
        return buildHistogramChartData(stats as unknown as Record<string, any>)
    }, [stats])

    const hasNumericHistogram = numericHistogramData.length > 0

    const isBooleanMetric = isBooleanMetricStats(stats)
    const numericHistogramAvailable = numericHistogramData.length > 0

    const booleanHistogram = useMemo(
        () => buildBooleanHistogram(stats, effectiveScenarioCount),
        [stats, effectiveScenarioCount],
    )

    const comparisonSignature = useMemo(
        () =>
            (comparisons ?? [])
                .map((entry) => `${entry.runId}:${entry.runName}:${entry.color}`)
                .join("|"),
        [comparisons],
    )

    const stableComparisons = useMemo(
        () => (comparisons ? [...comparisons] : []),
        [comparisonSignature],
    )

    const comparisonSelectionsAtom = useMemo(
        () =>
            atom((get) =>
                stableComparisons.map((entry) => ({
                    ...entry,
                    selection: get(
                        previewRunMetricStatsSelectorFamily({
                            runId: entry.runId,
                            metricPath,
                            metricKey,
                            stepKey,
                        }),
                    ),
                })),
            ),
        [stableComparisons, metricKey, metricPath, stepKey],
    )
    const comparisonSelections = useAtomValueWithSchedule(comparisonSelectionsAtom, {
        priority: LOW_PRIORITY,
    })

    const comparisonSeries = useMemo<(ComparisonSeriesEntry & {stats: BasicStats | null})[]>(
        () =>
            comparisonSelections.map((entry) => ({
                runId: entry.runId,
                runName: entry.runName,
                color: entry.color,
                stats: entry.selection.state === "hasData" ? (entry.selection.stats ?? null) : null,
            })),
        [comparisonSelections],
    )

    const comparisonBooleanHistograms = useMemo(() => {
        const withStats = comparisonSeries.filter(
            (entry): entry is ComparisonSeriesEntry & {stats: BasicStats} => Boolean(entry.stats),
        )
        return withStats.map((entry) => ({
            runId: entry.runId,
            runName: entry.runName,
            color: entry.color,
            histogram: buildBooleanHistogram(entry.stats, entry.stats.count),
        }))
    }, [comparisonSeries])

    const baseSeriesKey = "base"
    const resolvedRunName = runDisplayName ?? runId
    const resolvedBaseColor = baseColor ?? "#4096FF"

    const booleanChartData = useMemo(() => {
        if (!isBooleanMetric) return []
        const rows: Record<string, number | string>[] = [
            {
                key: "true",
                label: "True",
                [baseSeriesKey]: Number.isFinite(booleanHistogram.percentages.true)
                    ? booleanHistogram.percentages.true
                    : 0,
            },
            {
                key: "false",
                label: "False",
                [baseSeriesKey]: Number.isFinite(booleanHistogram.percentages.false)
                    ? booleanHistogram.percentages.false
                    : 0,
            },
        ]
        comparisonBooleanHistograms.forEach((entry) => {
            rows[0][entry.runId] = Number.isFinite(entry.histogram.percentages.true)
                ? entry.histogram.percentages.true
                : 0
            rows[1][entry.runId] = Number.isFinite(entry.histogram.percentages.false)
                ? entry.histogram.percentages.false
                : 0
        })
        return rows
    }, [
        baseSeriesKey,
        booleanHistogram.percentages.false,
        booleanHistogram.percentages.true,
        comparisonBooleanHistograms,
        isBooleanMetric,
    ])

    const histogramAvailable =
        numericHistogramAvailable || (isBooleanMetric && booleanChartData.length > 0)

    const summaryValue = useMemo(() => {
        if (isBooleanMetric) {
            const percentage = booleanHistogram.percentages.true
            return Number.isFinite(percentage) ? `${percentage.toFixed(2)}%` : "—"
        }
        if (typeof stats.mean === "number") return format3Sig(stats.mean)
        return "—"
    }, [booleanHistogram.percentages.true, isBooleanMetric, stats])

    const chartContent = () => {
        if (isBooleanMetric) {
            if (!booleanChartData.length) {
                return (
                    <div className="flex h-full items-center justify-center text-neutral-500">
                        No distribution data available.
                    </div>
                )
            }

            const series = [
                {
                    key: baseSeriesKey,
                    name: resolvedRunName,
                    color: resolvedBaseColor,
                    barProps: {radius: [8, 8, 0, 0]},
                },
                ...comparisonBooleanHistograms.map((entry) => ({
                    key: entry.runId,
                    name: entry.runName,
                    color: entry.color,
                    barProps: {radius: [8, 8, 0, 0]},
                })),
            ]

            return (
                <HistogramChart
                    data={booleanChartData}
                    xKey="label"
                    yKey={baseSeriesKey}
                    tooltipLabel="Percentage"
                    yDomain={[0, 100]}
                    series={series}
                    barCategoryGap="20%"
                />
            )
        }

        if (!histogramAvailable) {
            return (
                <div className="flex h-full items-center justify-center text-neutral-500">
                    No distribution data available.
                </div>
            )
        }

        if (numericHistogramAvailable && hasNumericHistogram) {
            const referenceLines = [] as {value: number; color?: string; label?: string}[]
            if (typeof stats.mean === "number" && Number.isFinite(stats.mean)) {
                referenceLines.push({
                    value: stats.mean,
                    color: resolvedBaseColor,
                    label: `${resolvedRunName} mean ${format3Sig(stats.mean)}`,
                })
            }
            comparisonSeries.forEach((entry) => {
                if (!entry.stats) return
                const mean = typeof entry.stats.mean === "number" ? entry.stats.mean : NaN
                if (Number.isFinite(mean)) {
                    referenceLines.push({
                        value: mean,
                        color: entry.color,
                        label: `${entry.runName} mean ${format3Sig(mean)}`,
                    })
                }
            })

            return (
                <HistogramChart
                    data={numericHistogramData}
                    xKey="x"
                    yKey="y"
                    tooltipLabel={metricLabel}
                    yDomain={[0, "auto"]}
                    referenceLines={referenceLines}
                />
            )
        }

        return (
            <div className="flex h-full items-center justify-center text-neutral-500">
                No distribution data available.
            </div>
        )
    }

    return (
        <Card
            className={clsx("h-full rounded-lg overflow-hidden !shadow-none", className)}
            classNames={{header: "!p-0", body: "!p-0 shadow-none"}}
            variant="borderless"
            title={
                <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                        <EvaluatorMetricsChartTitle
                            runId={runId}
                            evaluatorRef={evaluatorRef}
                            fallbackLabel={fallbackEvaluatorLabel}
                        />
                        <Typography.Text className="text-xs capitalize text-neutral-500">
                            {metricLabel}
                        </Typography.Text>
                    </div>
                </div>
            }
        >
            <div className="flex flex-col gap-4 px-4 pb-4">
                <div className="flex h-[70px] items-center justify-center">
                    <Typography.Text
                        className="text-xl font-medium"
                        style={{color: resolvedBaseColor}}
                    >
                        {summaryValue}
                    </Typography.Text>
                </div>
                <div className="h-[300px]">
                    {isLoading ? (
                        <Skeleton active className="w-full h-full" />
                    ) : hasError && !resolvedStats ? (
                        <div className="flex h-full items-center justify-center text-neutral-500">
                            Unable to load metric data.
                        </div>
                    ) : (
                        chartContent()
                    )}
                </div>
                {/* <Typography.Text className="text-center text-xs uppercase text-neutral-500">
                    {metricLabel}
                </Typography.Text> */}
            </div>
        </Card>
    )
}

export default EvaluatorMetricsChart
