import {memo, useEffect, useMemo, useRef, useState} from "react"

import type {BasicStats} from "@/oss/lib/metricUtils"

import EvaluatorMetricsSpiderChart from "../../../EvaluatorMetricsSpiderChart"
import {
    DEFAULT_SPIDER_SERIES_COLOR,
    INVOCATION_METRIC_KEYS,
    SPIDER_SERIES_COLORS,
} from "../constants"
import {useRunMetricData} from "../hooks/useRunMetricData"
import {toBooleanPercentage} from "../utils/metrics"

import {OverviewEmptyPlaceholder, OverviewLoadingPlaceholder} from "./OverviewPlaceholders"

interface OverviewSpiderChartProps {
    runIds: string[]
    expand?: boolean
}

const INVOCATION_COST_KEY = INVOCATION_METRIC_KEYS[0]
const INVOCATION_DURATION_KEY = INVOCATION_METRIC_KEYS[1]

const OverviewSpiderChart = ({runIds, expand = false}: OverviewSpiderChartProps) => {
    const orderedRunIds = useMemo(() => runIds.filter((id): id is string => Boolean(id)), [runIds])
    const {runDescriptors, runColorMap, metricSelections} = useRunMetricData(orderedRunIds)

    const chartState = useMemo(() => {
        if (!metricSelections.length || !runDescriptors.length) {
            return {metrics: [], series: [], maxScore: 100, loading: false}
        }

        const hasLoading = metricSelections.some(({selections}) =>
            selections.some((entry) => entry.selection.state === "loading"),
        )

        const axes = metricSelections.map(({metric, selections}) => {
            const baseSelection = selections[0]?.selection
            if (!baseSelection || baseSelection.state !== "hasData" || !baseSelection.stats) {
                return null
            }
            const baseStats = baseSelection.stats as BasicStats
            const axisName =
                metric.evaluatorLabel === "Invocation"
                    ? metric.displayLabel
                    : `${metric.evaluatorLabel}: ${metric.displayLabel}`

            let type: "binary" | "numeric" = "numeric"
            let baseValue: number | null = null
            let maxScore = 100

            const booleanPct = toBooleanPercentage(baseStats, (baseStats as any)?.count)
            if (booleanPct !== null) {
                baseValue = booleanPct
                type = "binary"
                maxScore = 100
            } else if (
                typeof (baseStats as any)?.mean === "number" &&
                Number.isFinite((baseStats as any).mean)
            ) {
                const mean = (baseStats as any).mean as number
                baseValue = mean
                const statMax =
                    typeof (baseStats as any).max === "number" &&
                    Number.isFinite((baseStats as any).max)
                        ? (baseStats as any).max
                        : Math.max(mean, 1)
                maxScore = statMax
            }

            if (baseValue === null) return null

            const values = new Map<string, number>()
            values.set("value", baseValue)
            selections.slice(1).forEach(({selection}, index) => {
                const key = `run_${index + 1}`
                if (!selection || selection.state !== "hasData" || !selection.stats) {
                    values.set(key, 0)
                    return
                }
                const stats = selection.stats as BasicStats
                if (type === "binary") {
                    const pct = toBooleanPercentage(stats, stats.count)
                    values.set(key, pct === null ? 0 : pct)
                    return
                }

                if (
                    typeof (stats as any).mean === "number" &&
                    Number.isFinite((stats as any).mean)
                ) {
                    const mean = (stats as any).mean as number
                    values.set(key, mean)
                    const statMax =
                        typeof (stats as any).max === "number" &&
                        Number.isFinite((stats as any).max)
                            ? (stats as any).max
                            : Math.max(mean, 1)
                    maxScore = Math.max(maxScore, statMax)
                } else {
                    values.set(key, 0)
                }
            })

            const canonicalKey = metric.canonicalKey || metric.rawKey

            return {
                name: axisName,
                type,
                values,
                maxScore,
                metricId: metric.id,
                canonicalKey,
            }
        })

        interface AxisEntry {
            name: string
            type: "binary" | "numeric"
            values: Map<string, number>
            maxScore: number
            metricId: string
            canonicalKey?: string | null
        }

        const filteredAxes = axes.filter(Boolean) as AxisEntry[]

        const evaluatorAxes: AxisEntry[] = []
        const invocationAxes = new Map<string, AxisEntry>()

        filteredAxes.forEach((axis) => {
            const canonicalKey = axis.canonicalKey ?? ""
            const isInvocation =
                axis.metricId.startsWith("invocation:") ||
                (canonicalKey
                    ? (INVOCATION_METRIC_KEYS as readonly string[]).includes(canonicalKey)
                    : false)
            if (isInvocation) {
                const key = canonicalKey || axis.metricId
                if (!invocationAxes.has(key)) {
                    invocationAxes.set(key, axis)
                }
                return
            }
            evaluatorAxes.push(axis)
        })

        const selectedAxes: AxisEntry[] = [...evaluatorAxes]

        const addInvocationAxis = (key: string | undefined) => {
            if (!key) return
            const axis = invocationAxes.get(key)
            if (!axis) return
            const alreadyIncluded = selectedAxes.some(
                (existing) => existing.metricId === axis.metricId,
            )
            if (!alreadyIncluded) {
                selectedAxes.push(axis)
            }
        }

        if (selectedAxes.length < 3) {
            if (selectedAxes.length === 2) {
                addInvocationAxis(INVOCATION_COST_KEY)
            } else if (selectedAxes.length <= 1) {
                addInvocationAxis(INVOCATION_DURATION_KEY)
                addInvocationAxis(INVOCATION_COST_KEY)
            }
        }

        const metrics = selectedAxes.map((axis) => {
            const record: Record<string, number | string> = {
                name: axis.name,
                type: axis.type,
                maxScore: axis.maxScore || 100,
                value: axis.values.get("value") ?? 0,
            }
            axis.values.forEach((value, key) => {
                if (key !== "value") {
                    record[key] = value
                }
            })
            return record
        })

        const series = runDescriptors.map((descriptor, index) => ({
            key: index === 0 ? "value" : `run_${index}`,
            name: descriptor.displayName,
            color:
                runColorMap.get(descriptor.runId) ??
                SPIDER_SERIES_COLORS[index % SPIDER_SERIES_COLORS.length] ??
                DEFAULT_SPIDER_SERIES_COLOR,
        }))

        const maxScore =
            metrics.reduce((acc, metric) => {
                const candidate =
                    typeof metric.maxScore === "number" && Number.isFinite(metric.maxScore)
                        ? metric.maxScore
                        : 0
                return Math.max(acc, candidate)
            }, 0) || 100

        return {metrics, series, maxScore, loading: hasLoading}
    }, [metricSelections, runDescriptors, runColorMap])

    // Expanded: measure container once hooks are allowed (before any early returns)
    const containerRef = useRef<HTMLDivElement | null>(null)
    const [squareSize, setSquareSize] = useState<number>(320)

    useEffect(() => {
        if (!expand) return
        const el = containerRef.current
        if (!el) return
        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const cr = entry.contentRect
                const w = Math.max(0, cr.width)
                const h = Math.max(0, cr.height)
                const size = Math.max(160, Math.floor(Math.min(w, h)))
                setSquareSize(size)
            }
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [expand])

    const showLoadingPlaceholder = chartState.loading

    if (showLoadingPlaceholder) {
        return (
            <OverviewLoadingPlaceholder
                variant="chart"
                minHeight={320}
                title="Preparing run overview"
                description="We’re aggregating evaluator and invocation metrics to build the radar chart."
            />
        )
    }

    if (!chartState.metrics.length) {
        return (
            <OverviewEmptyPlaceholder
                minHeight={320}
                title="Metrics not available"
                description="No evaluator or invocation metrics have been recorded for these runs yet."
            />
        )
    }

    if (!expand) {
        return (
            <EvaluatorMetricsSpiderChart
                className="h-[320px]"
                metrics={chartState.metrics as any}
                series={chartState.series as any}
                maxScore={chartState.maxScore}
            />
        )
    }

    return (
        <div ref={containerRef} className="relative h-full w-full">
            <div className="mx-auto" style={{width: `${squareSize}px`, height: `${squareSize}px`}}>
                <EvaluatorMetricsSpiderChart
                    className="h-full w-full"
                    metrics={chartState.metrics as any}
                    series={chartState.series as any}
                    maxScore={chartState.maxScore}
                />
            </div>
        </div>
    )
}

export default memo(OverviewSpiderChart)
