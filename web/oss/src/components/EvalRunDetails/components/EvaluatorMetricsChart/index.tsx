import {memo, useMemo} from "react"

import {Card, Skeleton, Typography} from "antd"
import clsx from "clsx"
import {atom, useAtomValue} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {previewRunMetricStatsSelectorFamily} from "@/oss/components/Evaluations/atoms/runMetrics"
import {format3Sig} from "@/oss/components/Evaluations/MetricDetailsPopover"
import type {BasicStats} from "@/oss/lib/metricUtils"

import {evaluationEvaluatorsByRunQueryAtomFamily} from "../../atoms/table/evaluators"
import {buildBooleanHistogram, isBooleanMetricStats} from "../../utils/metricDistributions"

import HistogramChart from "./HistogramChart"
import {buildFrequencyChartData, buildHistogramChartData} from "./utils/chartData"

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

type MetricDeltaTone = "positive" | "negative" | "neutral"

interface MetricStripEntry {
    key: string
    label: string
    color: string
    value: number | null
    displayValue: string
    isMain: boolean
    deltaText: string
    deltaTone: MetricDeltaTone
}

const getMainEvaluatorSeries = (entries: MetricStripEntry[]) =>
    entries.find((entry) => entry.isMain) ?? entries[0]

const computeDeltaPercent = (current: number | null, baseline: number | null) => {
    if (typeof current !== "number" || typeof baseline !== "number") return null
    if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return null
    return ((current - baseline) / baseline) * 100
}

const formatDelta = (delta: number | null): {text: string; tone: MetricDeltaTone} => {
    if (delta === null || !Number.isFinite(delta)) {
        return {text: "-", tone: "neutral"}
    }
    const rounded = Math.round(delta)
    if (rounded > 0) return {text: `+${rounded}%`, tone: "positive"}
    if (rounded < 0) return {text: `${rounded}%`, tone: "negative"}
    return {text: "0%", tone: "neutral"}
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

    const {data: numericHistogramData} = useMemo(
        () => buildHistogramChartData(stats as unknown as Record<string, any>),
        [stats],
    )

    const hasNumericHistogram = numericHistogramData.length > 0
    const categoricalFrequencyData = useMemo(
        () => buildFrequencyChartData(stats as unknown as Record<string, any>),
        [stats],
    )
    const hasCategoricalFrequency = categoricalFrequencyData.length > 0

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

    const comparisonCategoricalFrequencies = useMemo(() => {
        const withStats = comparisonSeries.filter(
            (entry): entry is ComparisonSeriesEntry & {stats: BasicStats} => Boolean(entry.stats),
        )
        return withStats
            .map((entry) => ({
                runId: entry.runId,
                runName: entry.runName,
                color: entry.color,
                frequency: buildFrequencyChartData(entry.stats as any),
            }))
            .filter((entry) => entry.frequency.length > 0)
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
        numericHistogramAvailable ||
        (isBooleanMetric && booleanChartData.length > 0) ||
        hasCategoricalFrequency

    const comparisonBooleanPercentMap = useMemo(() => {
        const map = new Map<string, number>()
        comparisonBooleanHistograms.forEach((entry) => {
            if (Number.isFinite(entry.histogram.percentages.true)) {
                map.set(entry.runId, entry.histogram.percentages.true)
            }
        })
        return map
    }, [comparisonBooleanHistograms])

    const summaryItems = useMemo<MetricStripEntry[]>(() => {
        const baseValue = (() => {
            if (!resolvedStats) return {value: null, displayValue: "—"}
            if (isBooleanMetric) {
                const percentage = booleanHistogram.percentages.true
                return Number.isFinite(percentage)
                    ? {value: percentage, displayValue: `${percentage.toFixed(2)}%`}
                    : {value: null, displayValue: "—"}
            }
            if (hasCategoricalFrequency) {
                return {value: null, displayValue: "—"}
            }
            if (typeof resolvedStats.mean === "number" && Number.isFinite(resolvedStats.mean)) {
                return {value: resolvedStats.mean, displayValue: format3Sig(resolvedStats.mean)}
            }
            return {value: null, displayValue: "—"}
        })()

        const baseEntry: MetricStripEntry = {
            key: baseSeriesKey,
            label: resolvedRunName,
            color: resolvedBaseColor,
            value: baseValue.value,
            displayValue: baseValue.displayValue,
            isMain: true,
            deltaText: "-",
            deltaTone: "neutral",
        }

        const comparisonEntries = comparisonSeries.map((entry) => {
            const statsValue = entry.stats
            if (!statsValue) {
                return {
                    key: entry.runId,
                    label: entry.runName,
                    color: entry.color,
                    value: null,
                    displayValue: "—",
                    isMain: false,
                    deltaText: "-",
                    deltaTone: "neutral",
                }
            }
            if (isBooleanMetric) {
                const percentage = comparisonBooleanPercentMap.get(entry.runId)
                return {
                    key: entry.runId,
                    label: entry.runName,
                    color: entry.color,
                    value: typeof percentage === "number" ? percentage : null,
                    displayValue:
                        typeof percentage === "number" && Number.isFinite(percentage)
                            ? `${percentage.toFixed(2)}%`
                            : "—",
                    isMain: false,
                    deltaText: "-",
                    deltaTone: "neutral",
                }
            }
            if (hasCategoricalFrequency) {
                return {
                    key: entry.runId,
                    label: entry.runName,
                    color: entry.color,
                    value: null,
                    displayValue: "—",
                    isMain: false,
                    deltaText: "-",
                    deltaTone: "neutral",
                }
            }
            if (typeof statsValue.mean === "number" && Number.isFinite(statsValue.mean)) {
                return {
                    key: entry.runId,
                    label: entry.runName,
                    color: entry.color,
                    value: statsValue.mean,
                    displayValue: format3Sig(statsValue.mean),
                    isMain: false,
                    deltaText: "-",
                    deltaTone: "neutral",
                }
            }
            return {
                key: entry.runId,
                label: entry.runName,
                color: entry.color,
                value: null,
                displayValue: "—",
                isMain: false,
                deltaText: "-",
                deltaTone: "neutral",
            }
        })

        const entries = [baseEntry, ...comparisonEntries]
        const mainSeries = getMainEvaluatorSeries(entries)

        return entries.map((entry) => {
            if (entry.isMain) {
                return entry
            }
            const delta = computeDeltaPercent(entry.value, mainSeries?.value ?? null)
            const formatted = formatDelta(delta)
            return {
                ...entry,
                deltaText: formatted.text,
                deltaTone: formatted.tone,
            }
        })
    }, [
        baseSeriesKey,
        booleanHistogram.percentages.true,
        comparisonBooleanPercentMap,
        comparisonSeries,
        hasCategoricalFrequency,
        isBooleanMetric,
        resolvedBaseColor,
        resolvedRunName,
        resolvedStats,
    ])

    const numericSeries = useMemo(
        () => [
            {
                key: baseSeriesKey,
                name: resolvedRunName,
                color: resolvedBaseColor,
                barProps: {radius: [8, 8, 0, 0], minPointSize: 2},
            },
            ...comparisonSeries.map((entry) => ({
                key: entry.runId,
                name: entry.runName,
                color: entry.color,
                barProps: {radius: [8, 8, 0, 0], minPointSize: 2},
            })),
        ],
        [baseSeriesKey, comparisonSeries, resolvedBaseColor, resolvedRunName],
    )

    const numericHistogramRows = useMemo(() => {
        if (!numericHistogramAvailable || !hasNumericHistogram) return []
        const rowMap = new Map<
            string,
            {label: string; order: number; [key: string]: number | string}
        >()

        numericHistogramData.forEach((bin, idx) => {
            const order = typeof bin.edge === "number" && Number.isFinite(bin.edge) ? bin.edge : idx
            const key =
                typeof bin.edge === "number" && Number.isFinite(bin.edge)
                    ? String(bin.edge)
                    : `${idx}-${bin.x}`
            const existing =
                rowMap.get(key) ??
                ({
                    label: String(bin.x),
                    order,
                } as {label: string; order: number; [key: string]: number | string})
            existing[baseSeriesKey] = Number(bin.y ?? 0)
            rowMap.set(key, existing)
        })

        comparisonSeries.forEach((entry) => {
            if (!entry.stats) return
            const {data} = buildHistogramChartData(entry.stats as Record<string, any>)
            data.forEach((bin, idx) => {
                const order =
                    typeof bin.edge === "number" && Number.isFinite(bin.edge) ? bin.edge : idx
                const key =
                    typeof bin.edge === "number" && Number.isFinite(bin.edge)
                        ? String(bin.edge)
                        : `${idx}-${bin.x}`
                const existing =
                    rowMap.get(key) ??
                    ({
                        label: String(bin.x),
                        order,
                    } as {label: string; order: number; [key: string]: number | string})
                existing[entry.runId] = Number(bin.y ?? 0)
                rowMap.set(key, existing)
            })
        })

        return Array.from(rowMap.values())
            .sort((a, b) => a.order - b.order)
            .map(({order, ...rest}) => rest)
    }, [
        baseSeriesKey,
        comparisonSeries,
        hasNumericHistogram,
        numericHistogramAvailable,
        numericHistogramData,
    ])

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
                    barProps: {radius: [8, 8, 0, 0], minPointSize: 2},
                },
                ...comparisonBooleanHistograms.map((entry) => ({
                    key: entry.runId,
                    name: entry.runName,
                    color: entry.color,
                    barProps: {radius: [8, 8, 0, 0], minPointSize: 2},
                })),
            ]

            return (
                <HistogramChart
                    data={booleanChartData}
                    xKey="label"
                    yKey={baseSeriesKey}
                    tooltipLabel="Percentage"
                    tooltipFormatter={(value) => `${format3Sig(value)}%`}
                    yDomain={[0, 100]}
                    series={series}
                    barCategoryGap="20%"
                    showLegend={false}
                    reserveLegendSpace={false}
                />
            )
        }

        if (hasCategoricalFrequency) {
            const labelKey = (value: any) => JSON.stringify(value ?? "")
            const labelSet = new Set<string>()
            const baseMap = new Map<string, number>()
            categoricalFrequencyData.forEach((entry) => {
                const key = labelKey(entry.label)
                labelSet.add(key)
                baseMap.set(key, Number(entry.value) || 0)
            })
            const comparisonMaps = comparisonCategoricalFrequencies.map((entry) => {
                const map = new Map<string, number>()
                entry.frequency.forEach((freq) => {
                    const key = labelKey(freq.label)
                    labelSet.add(key)
                    map.set(key, Number(freq.value) || 0)
                })
                return {...entry, map}
            })

            const sortedKeys = Array.from(labelSet.values()).sort((a, b) => {
                const maxA = Math.max(
                    baseMap.get(a) ?? 0,
                    ...comparisonMaps.map((entry) => entry.map.get(a) ?? 0),
                )
                const maxB = Math.max(
                    baseMap.get(b) ?? 0,
                    ...comparisonMaps.map((entry) => entry.map.get(b) ?? 0),
                )
                if (maxB !== maxA) return maxB - maxA
                return a.localeCompare(b)
            })

            const rows = sortedKeys.map((key) => {
                const parsedLabel = (() => {
                    try {
                        const parsed = JSON.parse(key)
                        if (typeof parsed === "string" || typeof parsed === "number") {
                            return parsed
                        }
                        return key
                    } catch {
                        return key
                    }
                })()
                const row: Record<string, string | number> = {
                    key,
                    label: String(parsedLabel),
                    [baseSeriesKey]: baseMap.get(key) ?? 0,
                }
                comparisonMaps.forEach((entry) => {
                    row[entry.runId] = entry.map.get(key) ?? 0
                })
                return row
            })

            const series = [
                {
                    key: baseSeriesKey,
                    name: resolvedRunName,
                    color: resolvedBaseColor,
                    barProps: {radius: [8, 8, 0, 0], minPointSize: 2},
                },
                ...comparisonMaps.map((entry) => ({
                    key: entry.runId,
                    name: entry.runName,
                    color: entry.color,
                    barProps: {radius: [8, 8, 0, 0], minPointSize: 2},
                })),
            ]

            return (
                <HistogramChart
                    data={rows}
                    xKey="label"
                    yKey={baseSeriesKey}
                    tooltipLabel="Count"
                    tooltipFormatter={(value) => Math.round(value).toLocaleString()}
                    yDomain={[0, "auto"]}
                    series={series}
                    barCategoryGap="20%"
                    showLegend={false}
                    reserveLegendSpace={false}
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
            return (
                <HistogramChart
                    data={numericHistogramRows}
                    xKey="label"
                    yKey={baseSeriesKey}
                    tooltipLabel={metricLabel}
                    tooltipFormatter={(value) => format3Sig(value)}
                    yDomain={[0, "auto"]}
                    series={numericSeries}
                    barCategoryGap="20%"
                    showLegend={false}
                    reserveLegendSpace={stableComparisons.length > 0}
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
            className={clsx("h-full rounded-lg overflow-hidden", className)}
            classNames={{body: "!p-0"}}
            variant="outlined"
        >
            <div className="flex h-full flex-col">
                <div className="px-4 pt-4 pb-2">
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
                <div className="px-4 pb-3">
                    <div className="flex flex-nowrap items-center justify-center gap-6 overflow-x-auto pb-1 text-center [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {summaryItems.map((entry) => (
                            <div
                                key={entry.key}
                                className="flex shrink-0 flex-col items-center gap-1"
                            >
                                <Typography.Text
                                    className="text-xl font-semibold"
                                    style={{color: entry.color}}
                                >
                                    {entry.displayValue}
                                </Typography.Text>
                                <Typography.Text
                                    className={clsx("text-xs font-medium", {
                                        "text-emerald-600": entry.deltaTone === "positive",
                                        "text-red-600": entry.deltaTone === "negative",
                                        "text-neutral-400": entry.deltaTone === "neutral",
                                    })}
                                >
                                    {entry.deltaText}
                                </Typography.Text>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="border-t border-neutral-200" />
                <div className="flex flex-1 px-4 py-4">
                    <div className="mt-auto h-[320px] w-full">
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
                </div>
            </div>
        </Card>
    )
}

export default EvaluatorMetricsChart
