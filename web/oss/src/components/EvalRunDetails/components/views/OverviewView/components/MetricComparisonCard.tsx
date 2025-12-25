import {memo, useMemo} from "react"

import {Card} from "antd"
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts"

import {
    buildBooleanHistogram,
    isBooleanMetricStats,
} from "@/oss/components/EvalRunDetails/utils/metricDistributions"
import {format3Sig} from "@/oss/components/Evaluations/MetricDetailsPopover"

import type {AggregatedMetricChartData, AggregatedMetricChartEntry} from "../types"

type ComparisonChartType = "boolean" | "categorical" | "numeric" | "empty"

interface ComparisonChartConfig {
    type: ComparisonChartType
    data: Record<string, number | string>[]
    yDomain: [number | "auto", number | "auto"]
    yFormatter: (value: number) => string
    tooltipFormatter: (value: number) => string
}

const buildComparisonChartConfig = (
    entries: AggregatedMetricChartEntry[],
): ComparisonChartConfig => {
    if (!entries.length) {
        return {
            type: "empty",
            data: [],
            yDomain: [0, "auto"],
            yFormatter: (value) => String(value),
            tooltipFormatter: (value) => String(value),
        }
    }

    const booleanEntries = entries.filter((entry) => isBooleanMetricStats(entry.stats))
    if (booleanEntries.length) {
        const rows: Record<string, number | string>[] = [{label: "True"}, {label: "False"}]

        booleanEntries.forEach((entry) => {
            const histogram = buildBooleanHistogram(entry.stats, entry.scenarioCount)
            const truePct = Number(histogram.percentages.true)
            const falsePct = Number(histogram.percentages.false)
            rows[0][entry.runKey] = Number.isFinite(truePct) ? truePct : 0
            rows[1][entry.runKey] = Number.isFinite(falsePct) ? falsePct : 0
        })

        return {
            type: "boolean",
            data: rows,
            yDomain: [0, 100],
            yFormatter: (value) => `${Math.round(value)}%`,
            tooltipFormatter: (value) => `${format3Sig(value)}%`,
        }
    }

    const categoricalEntries = entries.map((entry) => ({
        entry,
        data: entry.stats?.frequency ?? entry.stats?.rank ?? [],
    }))
    if (categoricalEntries.some(({data}) => Array.isArray(data) && data.length > 0)) {
        const rowMap = new Map<
            string,
            {label: string; order: number; [key: string]: number | string}
        >()

        categoricalEntries.forEach(({entry, data}) => {
            ;(data as {value: unknown; count?: number}[]).forEach(({value, count}, idx) => {
                const key = String(value ?? idx)
                const existing =
                    rowMap.get(key) ??
                    ({
                        label: String(value ?? idx),
                        order: idx,
                    } as {label: string; order: number; [key: string]: number | string})

                const numericValue = Number(count ?? 0)
                existing[entry.runKey] = Number.isFinite(numericValue) ? numericValue : 0
                rowMap.set(key, existing)
            })
        })

        const data = Array.from(rowMap.values())
            .sort(
                (a, b) =>
                    a.order - b.order ||
                    String(a.label).localeCompare(String(b.label), undefined, {
                        sensitivity: "base",
                    }),
            )
            .map(({order, ...rest}) => rest)

        return {
            type: "categorical",
            data,
            yDomain: [0, "auto"],
            yFormatter: (value) => Math.round(value).toLocaleString(),
            tooltipFormatter: (value) => Math.round(value).toLocaleString(),
        }
    }

    const histogramEntries = entries.map((entry) => ({
        entry,
        data:
            entry.stats?.distribution ??
            entry.stats?.hist?.map((h: any) => ({
                x: h?.interval?.[0] ?? h?.value ?? h?.bin ?? 0,
                y: h?.count ?? h?.value ?? 0,
            })) ??
            [],
    }))
    if (histogramEntries.some(({data}) => Array.isArray(data) && data.length > 0)) {
        const rowMap = new Map<
            string,
            {label: string; order: number; [key: string]: number | string}
        >()

        histogramEntries.forEach(({entry, data}) => {
            ;(data as {x: string | number; y: number; edge?: number}[]).forEach((bin, idx) => {
                const orderCandidate =
                    typeof bin.edge === "number"
                        ? bin.edge
                        : typeof bin.x === "number"
                          ? bin.x
                          : idx
                const order = Number.isFinite(orderCandidate) ? Number(orderCandidate) : idx
                const key =
                    typeof orderCandidate === "number" && Number.isFinite(orderCandidate)
                        ? orderCandidate.toString()
                        : `${idx}-${bin.x}`
                const label =
                    typeof bin.x === "number"
                        ? format3Sig(bin.x)
                        : typeof bin.x === "string"
                          ? bin.x
                          : String(bin.x)
                const existing =
                    rowMap.get(key) ??
                    ({
                        label,
                        order,
                    } as {label: string; order: number; [key: string]: number | string})

                const value = Number(bin.y ?? 0)
                existing[entry.runKey] = Number.isFinite(value) ? value : 0
                rowMap.set(key, existing)
            })
        })

        const data = Array.from(rowMap.values())
            .sort((a, b) => {
                const aOrder = Number(a.order)
                const bOrder = Number(b.order)
                if (Number.isFinite(aOrder) && Number.isFinite(bOrder)) return aOrder - bOrder
                if (Number.isFinite(aOrder)) return -1
                if (Number.isFinite(bOrder)) return 1
                return String(a.label).localeCompare(String(b.label), undefined, {
                    sensitivity: "base",
                })
            })
            .map(({order, ...rest}) => rest)

        return {
            type: "numeric",
            data,
            yDomain: [0, "auto"],
            yFormatter: (value) => Math.round(value).toLocaleString(),
            tooltipFormatter: (value) => Math.round(value).toLocaleString(),
        }
    }

    return {
        type: "empty",
        data: [],
        yDomain: [0, "auto"],
        yFormatter: (value) => String(value),
        tooltipFormatter: (value) => String(value),
    }
}

interface MetricComparisonCardProps {
    metric: AggregatedMetricChartData
}

const truncateRunName = (name: string, maxLength = 20): string => {
    if (name.length <= maxLength) return name
    return `${name.slice(0, maxLength - 1)}…`
}

const MetricComparisonCard = ({metric}: MetricComparisonCardProps) => {
    const runMeta = useMemo(
        () =>
            metric.entries.map((entry) => ({
                runKey: entry.runKey,
                runId: entry.runId,
                runName: entry.runName,
                shortName: truncateRunName(entry.runName),
                color: entry.color,
                summary: entry.summary,
            })),
        [metric.entries],
    )

    const runMetaMap = useMemo(() => {
        const map = new Map<string, (typeof runMeta)[number]>()
        runMeta.forEach((run) => {
            map.set(run.runKey, run)
        })
        return map
    }, [runMeta])

    const chartConfig = useMemo(() => buildComparisonChartConfig(metric.entries), [metric.entries])

    const hasData =
        chartConfig.type !== "empty" && chartConfig.data.length > 0 && runMeta.length > 0

    const barCategoryGap =
        chartConfig.type === "boolean" ? "40%" : chartConfig.type === "categorical" ? "30%" : "20%"

    return (
        <Card title={`${metric.evaluatorLabel} · ${metric.label}`}>
            <div className="h-[240px]">
                {hasData ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartConfig.data} barCategoryGap={barCategoryGap}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="label" tick={{fontSize: 12}} interval={0} />
                            <YAxis
                                domain={chartConfig.yDomain as any}
                                tickFormatter={(value) =>
                                    chartConfig.yFormatter(Number(value ?? 0))
                                }
                            />
                            <Tooltip
                                cursor={false}
                                labelFormatter={(label) => String(label)}
                                formatter={(value: number, _name, props) => {
                                    const runKey =
                                        typeof props?.dataKey === "string" ? props.dataKey : ""
                                    const meta = runMetaMap.get(runKey)
                                    const formattedValue = chartConfig.tooltipFormatter(
                                        Number(value ?? 0),
                                    )
                                    return [formattedValue, meta?.shortName ?? ""]
                                }}
                                contentStyle={{
                                    backgroundColor: "#FFFFFF",
                                    border: "1px solid #E2E8F0",
                                    borderRadius: 8,
                                    padding: "8px 12px",
                                    fontSize: 12,
                                    maxWidth: 280,
                                }}
                                itemStyle={{
                                    padding: "2px 0",
                                }}
                            />
                            <Legend
                                formatter={(value: string | number) =>
                                    runMetaMap.get(String(value))?.shortName ?? String(value)
                                }
                                wrapperStyle={{
                                    fontSize: 11,
                                    paddingTop: 8,
                                }}
                            />
                            {runMeta.map((run) => (
                                <Bar
                                    key={run.runKey}
                                    dataKey={run.runKey}
                                    name={run.runName}
                                    fill={run.color}
                                    radius={[6, 6, 0, 0]}
                                    maxBarSize={chartConfig.type === "boolean" ? 48 : 80}
                                />
                            ))}
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="flex h-full items-center justify-center text-neutral-500">
                        Distribution data not available for this metric.
                    </div>
                )}
            </div>
        </Card>
    )
}

export default memo(MetricComparisonCard)
