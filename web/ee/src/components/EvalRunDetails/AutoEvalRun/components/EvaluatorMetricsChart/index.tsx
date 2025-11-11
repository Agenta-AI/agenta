import {Card, Typography} from "antd"
import {useMemo} from "react"
import clsx from "clsx"
import BarChart from "./assets/BarChart"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"

/* ---------------- helpers ---------------- */

const format3Sig = (n: number) => {
    if (!Number.isFinite(n)) return String(n)
    const abs = Math.abs(n)
    if (abs !== 0 && (abs < 0.001 || abs >= 1000)) return n.toExponential(2)
    const s = n.toPrecision(3)
    return String(Number(s))
}

type BooleanMetric = {
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

type EvaluatorMetric = {
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
            color: opts?.color ?? "#91CAFF",
        }))

    return rows
}

/** Fallback: if no distribution is present, plot a single bar at the mean (x label = value) */
export function toSingleMeanRow(metric: EvaluatorMetric, opts?: {color?: string; digits?: number}) {
    const y = typeof metric.mean === "number" ? metric.mean : 0
    const x = format3Sig(opts?.digits != null ? Number(y.toFixed(opts.digits)) : y)
    return [{x, y, color: opts?.color ?? "#91CAFF"}] as const
}

/* ---------------- page component ---------------- */

const EvaluatorMetricsChart = ({
    className,
    name,
    metric,
    evaluator,
}: {
    className?: string
    name: string
    metric: Record<string, any>
    evaluator?: EvaluatorDto
}) => {
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

    // Shape data:
    // - Boolean: two bars true/false
    // - Numeric: distribution → (x = formatted start value, y = count)
    // - Fallback numeric: single bar at mean (x = value, y = mean)
    const chartData = useMemo(() => {
        if (isBooleanMetric) {
            return toBooleanHistogramRows(metric as BooleanMetric, {
                trueLabel: "true",
                falseLabel: "false",
                trueColor: "#91CAFF",
                falseColor: "#91CAFF",
            })
        }
        if (hasDistribution) {
            return toXYRowsFromDistributionNoBin(metric as EvaluatorMetric, {
                color: "#91CAFF",
                digits: 3,
            })
        }
        if (isNumeric) {
            return toSingleMeanRow(metric as EvaluatorMetric, {color: "#91CAFF", digits: 3})
        }
        return []
    }, [metric, isBooleanMetric, hasDistribution, isNumeric])


    return (
        <Card
            title={
                <div className="flex justify-between items-center w-full h-[64px] p-0">
                    <div className="flex flex-col gap-1">
                        <Typography.Text className="font-medium text-sm capitalize">
                            {evaluator?.name}
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
            <div className="flex flex-col justify-center items-center">
                <div className="border-0 border-b border-solid border-[#EAEFF5] w-full flex items-center justify-center h-[65px]">
                    <Typography.Text className="text-lg font-medium text-[#4096FF]">
                        {chartSummeryValue}
                    </Typography.Text>
                </div>

                <div className="w-full flex items-center h-full gap-2 pr-6 pt-6">
                    <div className="flex-1 h-[400px]">
                        <BarChart
                            data={chartData as any}
                            xKey="x"
                            yKey="y"
                            colorKey="color"
                            tooltipLabel={name}
                            yDomain={[0, 1]}
                            barSize={0}
                            barGap={!isBooleanMetric ? 0 : 10}
                            barCategoryGap={!isBooleanMetric ? 0 : 10}
                            barProps={{radius: [8, 8, 0, 0]}}
                        />
                    </div>
                </div>
            </div>
        </Card>
    )
}

export default EvaluatorMetricsChart
