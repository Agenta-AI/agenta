import {memo, useCallback, useMemo, useState, type FC} from "react"

import {Popover, Tag, Space} from "antd"
import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"

import {Expandable} from "@/oss/components/Tables/ExpandableCell"
import {runMetricsStatsCacheAtom} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runMetricsCache"
import {extractPrimitive, inferMetricType, SchemaMetricType} from "@/oss/lib/metricUtils"

import ResponsiveFrequencyChart from "./assets/ResponsiveFrequencyChart"
import ResponsiveMetricChart from "./assets/ResponsiveMetricChart"
import {buildChartData, format3Sig, formatMetricValue} from "./assets/utils"
import {MetricDetailsPopoverProps} from "./types"

/**
 * MetricDetailsPopover is a React functional component that provides a detailed view
 * of metric information within a popover. It displays both a tabular representation
 * of primitive metric entries and a chart visualization based on the provided metric
 * data. The component determines the appropriate chart type dynamically and supports
 * categorical and continuous data representations.
 *
 * Props:
 * - metricKey: The key associated with the metric being displayed.
 * - extraDimensions: Additional dimensions or metadata for the metric.
 * - highlightValue: Optional value for highlighting in the chart.
 * - hidePrimitiveTable: Boolean flag to toggle the visibility of the primitive table.
 * - children: ReactNode elements to be rendered inside the popover trigger.
 */
const MetricDetailsPopover: FC<MetricDetailsPopoverProps> = memo(
    ({
        metricKey,
        metricType,
        extraDimensions,
        highlightValue,
        hidePrimitiveTable,
        children,
        className,
    }) => {
        const [open, setOpen] = useState(false)
        const handleOpenChange = useCallback((v: boolean) => setOpen(v), [])

        const extraEntries = useMemo(() => Object.entries(extraDimensions), [extraDimensions])

        const chartData = useMemo(
            () => (open ? buildChartData(extraDimensions) : []),
            [open, extraDimensions],
        )

        // Dynamically compute the pixel width required for Y-axis labels
        const labelWidth = useMemo(() => {
            if (!chartData.length) return 0
            const canvas = document.createElement("canvas")
            const ctx = canvas.getContext("2d")
            if (!ctx) return 0
            ctx.font = "10px Inter, sans-serif" // must match tick font
            const max = Math.max(...chartData.map((d) => ctx.measureText(String(d.name)).width))
            return Math.ceil(max) + 8 // + padding
        }, [chartData])

        const primitiveEntries = useMemo(() => {
            if (!open || hidePrimitiveTable) return []
            // const order = ["mean", "std", "min", "max", "count", "total", "binSize"]
            const order = ["mean", "std", "min", "max", "count", "sum", "binSize", "unique", "rank"]
            const allowed = new Set(order)
            const _primitiveEntries = extraEntries
                .filter(([k]) => allowed.has(k as string))
                .sort(([a], [b]) => {
                    const ia = order.indexOf(a as string)
                    const ib = order.indexOf(b as string)
                    const sa = ia === -1 ? Number.POSITIVE_INFINITY : ia
                    const sb = ib === -1 ? Number.POSITIVE_INFINITY : ib

                    return sa - sb || (a as string).localeCompare(b as string)
                })
            return _primitiveEntries
        }, [open, hidePrimitiveTable, extraEntries])

        const tableNode = useMemo(() => {
            if (!primitiveEntries.length) return null

            return (
                <table className="w-full text-[10px]">
                    <tbody className="w-full flex items-start justify-between gap-2">
                        {primitiveEntries.map(([k, v]) => (
                            <tr key={k} className="flex flex-col items-start gap-0.5">
                                <td className="pr-2 text-[#586673] whitespace-nowrap">{k}</td>
                                <td className="whitespace-nowrap">
                                    {(() => {
                                        if (Array.isArray(v)) {
                                            const limit = 5
                                            if (k === "unique") {
                                                const items = (v as any[]).slice(0, limit)
                                                return (
                                                    <div className="flex flex-col">
                                                        {items.map((itm, idx) => (
                                                            <span
                                                                key={idx}
                                                                className="whitespace-nowrap"
                                                            >
                                                                {String(itm)}
                                                            </span>
                                                        ))}
                                                        {v.length > limit && (
                                                            <span className="whitespace-nowrap text-gray-400">
                                                                …
                                                            </span>
                                                        )}
                                                    </div>
                                                )
                                            }
                                            if ((k === "rank" || k === "frequency") && v.length) {
                                                const items = (v as any[]).slice(0, limit)
                                                return (
                                                    <div className="flex flex-col">
                                                        {items.map((o: any, idx) => (
                                                            <span
                                                                key={idx}
                                                                className="whitespace-nowrap"
                                                            >{`${o.value} (${o.count})`}</span>
                                                        ))}
                                                        {v.length > limit && (
                                                            <span className="whitespace-nowrap text-gray-400">
                                                                …
                                                            </span>
                                                        )}
                                                    </div>
                                                )
                                            }
                                        }
                                        return formatMetricValue(metricKey, v as any)
                                    })()}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )
        }, [primitiveEntries, metricKey])

        // Chart type logic
        const isCategoricalChart =
            Array.isArray(extraDimensions.distribution) ||
            Array.isArray(extraDimensions.rank) ||
            Array.isArray(extraDimensions.frequency)
        const hasEdge =
            chartData.length > 0 && Object.prototype.hasOwnProperty.call(chartData[0], "edge")

        const frequencyData = useMemo(() => {
            // Only build for categorical/frequency charts without edge
            if (isCategoricalChart && !hasEdge) {
                // buildChartData returns [{ name, value }] but ResponsiveFrequencyChart expects [{ label, count }]
                return buildChartData(extraDimensions).map((d) => ({
                    label: d.name,
                    count: d.value,
                }))
            }
            return []
        }, [extraDimensions, isCategoricalChart, hasEdge])

        const chartNode = useMemo(() => {
            if (!open) return null
            // Histogram (hasEdge): use ResponsiveMetricChart
            if (chartData.length > 0 && isCategoricalChart && hasEdge) {
                return (
                    <ResponsiveMetricChart
                        chartData={chartData}
                        extraDimensions={extraDimensions}
                        highlightValue={highlightValue}
                        labelWidth={labelWidth}
                    />
                )
            }
            // Frequency/categorical: use ResponsiveFrequencyChart
            if (frequencyData.length > 0 && isCategoricalChart && !hasEdge) {
                return (
                    <ResponsiveFrequencyChart
                        data={frequencyData}
                        highlightValues={
                            Array.isArray(highlightValue)
                                ? highlightValue
                                : highlightValue != null
                                  ? [highlightValue]
                                  : []
                        }
                        labelWidth={labelWidth}
                    />
                )
            }
            // No valid chart type available
            return null
        }, [chartData, isCategoricalChart, hasEdge, labelWidth, highlightValue, extraDimensions])

        const content = useMemo(
            () => (
                <div className="flex flex-col gap-2">
                    {tableNode}
                    {chartNode}
                </div>
            ),
            [tableNode, chartNode],
        )
        if (!extraEntries.length || metricType === "string") {
            return <>{children}</>
        }

        return (
            <div className={clsx("w-full h-full flex items-start", className)}>
                <Popover
                    content={content}
                    title={`${metricKey} details`}
                    placement="top"
                    open={open}
                    onOpenChange={handleOpenChange}
                    destroyOnHidden
                >
                    {children}
                </Popover>
            </div>
        )
    },
)

MetricDetailsPopover.displayName = "MetricDetailsPopover"

/**
 * A wrapper component around MetricDetailsPopover that:
 * - fetches run metrics using useEvaluationRunMetrics
 * - computes a summary of the metric
 * - passes the extra dimensions to the MetricDetailsPopover
 * - conditionally renders the MetricDetailsPopover if the metric is not null
 *
 * @param scenarioId - the scenario ID
 * @param runId - the run ID
 * @param evaluatorSlug - the evaluator slug
 * @param evaluatorMetricKey - the metric key
 * @param hidePrimitiveTable - whether to hide the primitive table
 * @param metricType - the type of the metric (optional)
 */
export const MetricDetailsPopoverWrapper = memo(
    ({
        scenarioId,
        runId,
        evaluatorSlug,
        evaluatorMetricKey,
        hidePrimitiveTable = false,
        metricType,
        className,
        statsOverride,
        debug,
        evaluator,
    }: {
        scenarioId?: string | null
        runId: string
        evaluatorSlug: string
        evaluatorMetricKey: string
        hidePrimitiveTable?: boolean
        metricType?: string
        evaluator?: EvaluatorDto
        className?: string
        statsOverride?: Record<string, any>
        debug?: boolean
    }) => {
        const metricKey = useMemo(
            () => `${evaluatorSlug}.${evaluatorMetricKey}`,
            [evaluatorSlug, evaluatorMetricKey],
        )

        const statsAtom = useMemo(
            () =>
                selectAtom(
                    runMetricsStatsCacheAtom,
                    (map) => map.get(runId)?.[metricKey],
                    deepEqual,
                ),
            [metricKey, runId],
        )
        const statsFromAtom = useAtomValue(statsAtom) as Record<string, any> | undefined
        const stats = statsOverride ?? statsFromAtom

        const rawPrimitive = useMemo(() => extractPrimitive(stats), [stats])

        const explicitTypeFromEvaluator = useMemo(() => {
            return (
                evaluator?.metrics?.[evaluatorMetricKey]?.type ||
                evaluator?.metrics?.[evaluatorMetricKey]?.anyOf
            )
            // as SchemaMetricType | undefined
        }, [evaluator, evaluatorMetricKey])
        const resolvedMetricType = useMemo(
            () => explicitTypeFromEvaluator ?? inferMetricType(rawPrimitive, metricType),
            [explicitTypeFromEvaluator, rawPrimitive, metricType],
        )

        const summary = useMemo(() => {
            if (!stats) return "N/A"
            // Numeric metrics → mean
            if (typeof (stats as any).mean === "number") {
                return format3Sig(Number((stats as any).mean))
            }
            // Boolean metrics → proportion of `true`
            if (resolvedMetricType === "boolean" && Array.isArray((stats as any).frequency)) {
                const trueEntry = (stats as any).frequency.find((f: any) => f.value === true)
                const total = (stats as any).count ?? 0
                if (total) {
                    return (
                        <div className="flex w-full gap-4">
                            <div className="flex flex-col text-xs leading-snug w-full grow">
                                <div className="flex flex-col w-full gap-1">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-[#95DE64] font-medium">true</span>
                                        <span className="text-[#97A4B0] font-medium">false</span>
                                    </div>
                                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                        <div className="flex h-full">
                                            <div
                                                className="h-full bg-[#95DE64]"
                                                style={{
                                                    width: `${((trueEntry?.count ?? 0) / total) * 100}%`,
                                                }}
                                            />
                                            <div
                                                className="h-full bg-[#97A4B0] text-xs"
                                                style={{
                                                    width: `${((total - (trueEntry?.count ?? 0)) / total) * 100}%`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="self-stretch flex items-center justify-center">
                                {(((trueEntry?.count ?? 0) / total) * 100).toFixed(2)}%
                            </div>
                        </div>
                    )
                }
            }
            // Array metrics → show top 3 items
            if (resolvedMetricType === "array" || resolvedMetricType === undefined) {
                const items =
                    Array.isArray((stats as any).rank) && (stats as any).rank.length
                        ? (stats as any).rank
                        : Array.isArray((stats as any).unique)
                          ? (stats as any).unique.map((v: any) => ({value: v, count: undefined}))
                          : []
                const topItems = items.slice(0, 3)
                return (
                    <Space size={[4, 4]} wrap>
                        {topItems.map((it: any) => (
                            <Tag key={String(it.value)} className="capitalize">
                                {String(it.value)}
                                {it.count !== undefined ? ` (${it.count})` : ""}
                            </Tag>
                        ))}
                    </Space>
                )
            }
            // Categorical metrics → top rank
            if (Array.isArray((stats as any).rank) && (stats as any).rank.length) {
                const top = (stats as any).rank[0]
                return `${top.value} (${top.count})`
            }
            if (Array.isArray((stats as any).unique) && (stats as any).unique.length) {
                return `${(stats as any).unique.length} unique`
            }
            if (typeof (stats as any).count === "number") {
                return (stats as any).count
            }
            return "–"
        }, [stats, resolvedMetricType])

        return stats ? (
            <MetricDetailsPopover
                metricKey={metricKey}
                extraDimensions={stats}
                hidePrimitiveTable={hidePrimitiveTable}
                className={className}
                metricType={resolvedMetricType}
            >
                <Expandable expandKey={`${runId}-${scenarioId}-${metricKey}`}>{summary}</Expandable>
            </MetricDetailsPopover>
        ) : (
            "N/A"
        )
    },
)

export default MetricDetailsPopover
