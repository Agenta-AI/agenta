import {useCallback, useMemo, useState, type ReactNode} from "react"

import {Card, Radio, Typography} from "antd"
import clsx from "clsx"

import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"

import {EVAL_BG_COLOR} from "../../assets/utils"
import BarChartPlaceholder from "../shared/BarChartPlaceholder"
import PlaceholderOverlay, {PlaceholderEvaluationType} from "../shared/PlaceholderOverlay"

import BarChart from "./assets/BarChart"
import HistogramChart from "./assets/HistogramChart"

/* ---------------- helpers ---------------- */

const format3Sig = (n: number) => {
    if (!Number.isFinite(n)) return String(n)
    const abs = Math.abs(n)
    if (abs !== 0 && (abs < 0.001 || abs >= 1000)) return n.toExponential(2)
    const s = n.toPrecision(3)
    return String(Number(s))
}

interface BooleanMetric {
    rank: {value: boolean; count: number}[]
    count: number
    unique: boolean[]
    frequency: {value: boolean; count: number}[]
}

/** Boolean metric → two-bars histogram */
export function toBooleanHistogramRows(
    metric: BooleanMetric,
    opts?: {trueLabel?: string; falseLabel?: string; trueColor?: string; falseColor?: string},
) {
    const source = metric.frequency?.length ? metric.frequency : metric.rank
    const map = new Map<boolean, number>(source.map((f) => [f.value, f.count]))
    const t = map.get(true) ?? 0
    const f = map.get(false) ?? 0
    return [
        {x: opts?.trueLabel ?? "true", y: t, color: opts?.trueColor ?? "#22c55e"},
        {x: opts?.falseLabel ?? "false", y: f, color: opts?.falseColor ?? "#ef4444"},
    ] as const
}

interface EvaluatorMetric {
    count: number
    sum: number
    mean: number
    min: number
    max: number
    range: number
    distribution: {value: number; count: number}[]
    percentiles: Record<string, number>
    iqrs: Record<string, number>
    binSize: number
}

/**
 * Numeric metric → XY rows from distribution, ignoring binSize.
 * X is just the formatted starting value; Y is count.
 * This gives a categorical X axis that still preserves the shape.
 */
export function toXYRowsFromDistributionNoBin(
    metric: EvaluatorMetric,
    opts?: {color?: string; digits?: number},
) {
    const rows = [...(metric.distribution ?? [])]
        .sort((a, b) => a.value - b.value)
        .map((d) => ({
            x: format3Sig(opts?.digits != null ? Number(d.value.toFixed(opts.digits)) : d.value),
            y: d.count,
            color: opts?.color ?? "rgba(145, 202, 255, 0.7)",
        }))

    return rows
}

/** Fallback: if no distribution is present, plot a single bar at the mean (x label = value) */
export function toSingleMeanRow(metric: EvaluatorMetric, opts?: {color?: string; digits?: number}) {
    const y = typeof metric.mean === "number" ? metric.mean : 0
    const x = format3Sig(opts?.digits != null ? Number(y.toFixed(opts.digits)) : y)
    return [{x, y, color: opts?.color ?? "rgba(145, 202, 255, 0.7)"}] as const
}

const items = ["average", "histogram", "total"]

/* ---------------- page component ---------------- */

const EvaluatorMetricsChart = ({
    className,
    name,
    metricKey,
    metric,
    evaluator,
    isCompare,
    averageRows,
    summaryRows,
    evaluationType = "auto",
    hasMetricData = false,
    placeholderTitle,
    placeholderDescription,
}: {
    className?: string
    name: string
    metricKey?: string
    metric: Record<string, any>
    evaluator?: EvaluatorDto
    isCompare?: boolean
    averageRows?: readonly {x: string; y: number; color?: string}[]
    summaryRows?: readonly {x: string; y: number; color?: string}[]
    evaluationType?: PlaceholderEvaluationType
    hasMetricData?: boolean
    placeholderTitle?: ReactNode
    placeholderDescription?: ReactNode
}) => {
    const [selectedItem, setSelectedItem] = useState(items[0])
    const isBooleanMetric = !!metric?.unique?.length
    const hasDistribution = Array.isArray(metric?.distribution) && metric.distribution.length > 0
    const isNumeric = typeof metric?.mean === "number" || hasDistribution

    // Big summary number
    const chartSummeryValue = useMemo(() => {
        if (isBooleanMetric) {
            const trueEntry = metric?.frequency?.find((f: any) => f?.value === true)
            const total = metric?.count ?? 0
            const pct = total ? ((trueEntry?.count ?? 0) / total) * 100 : 0
            return `${pct.toFixed(2)}%`
        }
        if (typeof metric?.mean === "number") return format3Sig(metric.mean)
        return ""
    }, [metric, isBooleanMetric])

    // Summary for compare mode: one value per evaluation with +/- delta vs base
    const compareSummaries = useMemo(() => {
        // Use only evaluations that actually have this evaluator's metric (averageRows already filtered)
        if (!isCompare || !averageRows?.length)
            return [] as {value: string; delta?: string; color: string}[]

        const base = averageRows?.[0]?.y ?? 0
        const isPct = isBooleanMetric
        return averageRows.map((r, i) => {
            const color = (r as any)?.color || (EVAL_BG_COLOR as any)[i + 1] || "#3B82F6"
            const valNum = Number(r.y || 0)
            const value = isPct ? `${valNum.toFixed(2)}%` : format3Sig(valNum)
            if (i === 0) return {value, delta: "-", color}
            // percent difference vs base (avoid divide by zero)
            const deltaPct = base ? ((valNum - base) / Math.abs(base)) * 100 : 0
            const sign = deltaPct > 0 ? "+" : ""
            const delta = `${sign}${deltaPct.toFixed(0)}%`
            return {value, delta, color}
        })
    }, [isCompare, averageRows, isBooleanMetric])

    // Shape data:
    // - Boolean: two bars true/false
    // - Numeric: distribution → (x = formatted start value, y = count)
    // - Fallback numeric: single bar at mean (x = value, y = mean)
    const chartData = useMemo(() => {
        if (isBooleanMetric) {
            return toBooleanHistogramRows(metric as BooleanMetric, {
                trueLabel: "true",
                falseLabel: "false",
                trueColor: "rgba(145, 202, 255, 0.7)",
                falseColor: "rgba(145, 202, 255, 0.7)",
            })
        }
        if (hasDistribution) {
            return toXYRowsFromDistributionNoBin(metric as EvaluatorMetric, {
                color: "rgba(145, 202, 255, 0.7)",
                digits: 3,
            })
        }
        if (isNumeric) {
            return toSingleMeanRow(metric as EvaluatorMetric, {
                color: "rgba(145, 202, 255, 0.7)",
                digits: 3,
            })
        }
        return []
    }, [metric, isBooleanMetric, hasDistribution, isNumeric])

    const showHistogram = !isCompare || selectedItem === "histogram"

    const formatYAxisTick = useCallback(
        (value: number) => {
            if (typeof value !== "number" || Number.isNaN(value)) return ""

            const formatToThreeDecimals = (num: number) => {
                if (num === 0) return "0"
                const abs = Math.abs(num)
                if (abs < 0.001) return num.toExponential(2)
                return Number(num.toFixed(3)).toString()
            }

            if (isBooleanMetric) {
                return `${formatToThreeDecimals(value)}%`
            }

            return formatToThreeDecimals(value)
        },
        [isBooleanMetric],
    )

    const hasSummaryRows = summaryRows?.some((row) => Number.isFinite(row.y)) ?? false
    const showPlaceholder = chartData.length === 0 && !hasSummaryRows && !hasMetricData
    const evaluatorLabel = evaluator?.name || evaluator?.slug || "this evaluator"
    const defaultPlaceholderTitle =
        evaluationType === "online" ? "Waiting for your traces" : "Waiting for evaluation runs"
    const defaultPlaceholderDescription =
        evaluationType === "online"
            ? `Generate traces with ${evaluatorLabel} to start collecting results.`
            : `Annotate your scenarios with ${evaluatorLabel} to start seeing distribution data.`
    const overlayTitle = placeholderTitle ?? defaultPlaceholderTitle
    const overlayDescription = placeholderDescription ?? defaultPlaceholderDescription

    return (
        <Card
            title={
                <div className="flex justify-between items-center w-full h-[64px] p-0">
                    <div className="flex flex-col gap-1">
                        <Typography.Text className="font-medium text-sm capitalize">
                            {evaluatorLabel}
                        </Typography.Text>
                        <Typography.Text className="capitalize font-normal" type="secondary">
                            {name}
                        </Typography.Text>
                    </div>
                </div>
            }
            className={clsx("rounded !p-0 overflow-hidden", className)}
            classNames={{title: "!py-0 !px-4", header: "!p-0", body: "!p-0"}}
        >
            {showPlaceholder ? (
                <div className="relative min-h-[260px] overflow-hidden rounded bg-[#F8FAFC]">
                    <BarChartPlaceholder className="opacity-60" />
                    <PlaceholderOverlay
                        evaluationType={evaluationType}
                        title={overlayTitle}
                        description={overlayDescription}
                        className="px-8"
                    />
                </div>
            ) : (
                <div className="flex flex-col justify-center items-center">
                    {isCompare ? (
                        <div className="border-0 border-b border-solid border-[#EAEFF5] w-full flex items-center justify-evenly h-[80px] px-4">
                            {compareSummaries.map((s, idx) => (
                                <div
                                    key={idx}
                                    className="flex flex-col items-center justify-center"
                                >
                                    <Typography.Text
                                        style={{color: s.color}}
                                        className="text-xl font-medium"
                                    >
                                        {s.value}
                                    </Typography.Text>
                                    <Typography.Text
                                        className={
                                            idx === 0
                                                ? "text-[#758391]"
                                                : s.delta?.startsWith("+")
                                                  ? "text-green-600"
                                                  : s.delta?.startsWith("-")
                                                    ? "text-red-500"
                                                    : "text-[#758391]"
                                        }
                                    >
                                        {s.delta}
                                    </Typography.Text>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="border-0 border-b border-solid border-[#EAEFF5] w-full flex items-center justify-center h-[65px]">
                            <Typography.Text className="text-xl font-medium text-[#4096FF]">
                                {chartSummeryValue}
                            </Typography.Text>
                        </div>
                    )}

                    <div className="w-full h-full flex flex-col p-4">
                        <div className="w-full flex items-center h-full gap-2 px-4">
                            <Typography.Text
                                className="font-normal -rotate-90 w-[20px] text-nowrap"
                                type="secondary"
                            >
                                {showHistogram ? "Frequency" : "Avg score"}
                            </Typography.Text>
                            <div className="flex-1 h-[400px]">
                                {showHistogram ? (
                                    <HistogramChart
                                        data={chartData as any}
                                        xKey="x"
                                        yKey="y"
                                        colorKey="color"
                                        tooltipLabel={name}
                                        yDomain={[0, 1]}
                                        barGap={0}
                                        barCategoryGap={chartData.length < 4 ? "30%" : "10%"}
                                        barProps={{radius: [8, 8, 0, 0]}}
                                    />
                                ) : (
                                    <BarChart
                                        data={(averageRows as any) || []}
                                        xKey="x"
                                        yKey="y"
                                        colorKey="color"
                                        tooltipLabel={name}
                                        yDomain={[0, "dataMax"]}
                                        tooltipFormatter={(value) => formatYAxisTick(value)}
                                        yAxisProps={{tickFormatter: formatYAxisTick}}
                                        barCategoryGap={
                                            (averageRows?.length ?? 0) < 4 ? "30%" : "10%"
                                        }
                                        barProps={{radius: [8, 8, 0, 0]}}
                                    />
                                )}
                            </div>
                        </div>
                        <Typography.Text
                            className="capitalize font-normal text-center mx-auto"
                            type="secondary"
                        >
                            {name}
                        </Typography.Text>
                    </div>
                </div>
            )}
        </Card>
    )
}

export default EvaluatorMetricsChart
