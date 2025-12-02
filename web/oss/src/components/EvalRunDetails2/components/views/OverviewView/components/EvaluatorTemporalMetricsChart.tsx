import {memo, useMemo, type ReactNode} from "react"

import {Card, Typography} from "antd"
import clsx from "clsx"
import {
    Area,
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts"

import {OverviewEmptyPlaceholder} from "./OverviewPlaceholders"

export interface TemporalMetricsSeriesPoint {
    timestamp: number
    value: number
    scenarioCount?: number
    p25?: number
    p50?: number
    p75?: number
    histogram?: {from: number; to: number; count: number}[]
}

export interface TemporalMetricsSeriesEntry {
    id: string
    name: string
    color: string
    points: TemporalMetricsSeriesPoint[]
}

const formatTimestamp = (value: number) => {
    if (!Number.isFinite(value)) return ""
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ""
    return date.toLocaleString()
}

const toAreaFill = (color: string) => {
    if (color.startsWith("#")) {
        const hex = color.slice(1)
        const normalized =
            hex.length === 3
                ? hex
                      .split("")
                      .map((ch) => ch + ch)
                      .join("")
                : hex
        const numeric = Number.parseInt(normalized, 16)
        if (!Number.isNaN(numeric)) {
            const r = (numeric >> 16) & 255
            const g = (numeric >> 8) & 255
            const b = numeric & 255
            return `rgba(${r}, ${g}, ${b}, 0.08)`
        }
    }
    if (color.startsWith("rgb(")) {
        return color.replace("rgb(", "rgba(").replace(")", ", 0.08)")
    }
    if (color.startsWith("rgba(")) {
        return color.replace(/,\s*\d*\.?\d+\)/, ", 0.08)")
    }
    return "rgba(59, 130, 246, 0.08)" // default blue fill
}

const EvaluatorTemporalMetricsChart = ({
    className,
    name,
    metricKey,
    series,
    isBoolean,
    placeholderTitle,
    placeholderDescription,
}: {
    className?: string
    name: string
    metricKey?: string
    series: TemporalMetricsSeriesEntry[]
    isBoolean?: boolean
    placeholderTitle?: ReactNode
    placeholderDescription?: ReactNode
}) => {
    const hasData = series.some((entry) => entry.points.length > 0)

    const chartData = useMemo(() => {
        const map = new Map<number, Record<string, unknown>>()
        series.forEach((entry) => {
            entry.points.forEach((point) => {
                const row = map.get(point.timestamp) ?? {timestamp: point.timestamp}
                row[entry.id] = point.value
                row[`${entry.id}__count`] = point.scenarioCount
                row[`${entry.id}__p50`] = point.p50
                map.set(point.timestamp, row)
            })
        })
        return Array.from(map.values()).sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
    }, [series])

    const yDomain = useMemo(() => {
        if (isBoolean) return [0, 100] as [number, number]
        const values = series.flatMap((entry) => entry.points.map((point) => point.value))
        if (!values.length) return undefined
        const min = Math.min(...values)
        const max = Math.max(...values)
        if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined
        if (min === max) {
            const padding = Math.max(Math.abs(min) * 0.1, 1)
            return [min - padding, max + padding] as [number, number]
        }
        return [min, max] as [number, number]
    }, [series, isBoolean])

    const latestSummaries = useMemo(
        () =>
            series
                .map((entry) => {
                    const latest = [...entry.points].sort((a, b) => b.timestamp - a.timestamp)[0]
                    if (!latest) return null
                    const formatted = Number.isFinite(latest.value)
                        ? latest.value.toFixed(isBoolean ? 1 : 2)
                        : null
                    return formatted
                        ? {name: entry.name, value: formatted, color: entry.color}
                        : null
                })
                .filter(Boolean) as {name: string; value: string; color: string}[],
        [series, isBoolean],
    )

    const seriesLabelMap = useMemo(() => {
        const map = new Map<string, string>()
        series.forEach((entry) => map.set(entry.id, entry.name || entry.id))
        return map
    }, [series])

    if (!hasData) {
        return (
            <OverviewEmptyPlaceholder
                minHeight={240}
                title={placeholderTitle || "Waiting for evaluator metrics"}
                description={
                    placeholderDescription ||
                    "As soon as this evaluator emits values, the timeline will appear here."
                }
            />
        )
    }

    return (
        <Card
            title={
                <div className="flex justify-between items-center w-full">
                    <div className="flex flex-col gap-1">
                        <Typography.Text className="text-sm font-medium text-neutral-900">
                            {name}
                        </Typography.Text>
                        {metricKey ? (
                            <Typography.Text type="secondary" className="text-xs">
                                {metricKey}
                            </Typography.Text>
                        ) : null}
                    </div>
                    {latestSummaries.length ? (
                        <div className="hidden md:flex items-center gap-4 text-xs text-neutral-500">
                            {latestSummaries.map((summary) => (
                                <span key={summary.name} className="flex items-center gap-1">
                                    <span
                                        className="inline-block h-2 w-2 rounded-full"
                                        style={{backgroundColor: summary.color}}
                                    />
                                    <span className="text-neutral-700">{summary.name}</span>
                                    <span className="font-medium text-neutral-900">
                                        {summary.value}
                                    </span>
                                </span>
                            ))}
                        </div>
                    ) : null}
                </div>
            }
            className={clsx("rounded-md overflow-hidden", className)}
            classNames={{body: "!p-0", header: "!px-4 !py-3", title: "!m-0"}}
        >
            <div className="h-[280px] px-4 py-4">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData as any}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 23, 42, 0.08)" />
                        <XAxis
                            dataKey="timestamp"
                            type="number"
                            domain={["auto", "auto"]}
                            scale="time"
                            tickFormatter={formatTimestamp}
                            tick={{fill: "#64748B", fontSize: 11}}
                            tickMargin={12}
                            axisLine={{stroke: "rgba(148, 163, 184, 0.25)"}}
                        />
                        <YAxis
                            domain={yDomain ?? ["auto", "auto"]}
                            tick={{fill: "#64748B", fontSize: 11}}
                            axisLine={{stroke: "rgba(148, 163, 184, 0.25)"}}
                            tickMargin={8}
                        />
                        <Tooltip
                            cursor={{stroke: "rgba(99, 102, 241, 0.35)", strokeWidth: 1}}
                            labelFormatter={(value) => formatTimestamp(Number(value))}
                            formatter={(value: any, dataKey: string) => {
                                if (typeof value !== "number") return value
                                const label = seriesLabelMap.get(dataKey) ?? dataKey
                                return [value.toFixed(isBoolean ? 1 : 3), label]
                            }}
                        />
                        {series.map((entry) => (
                            <Area
                                key={`area-${entry.id}`}
                                type="monotone"
                                dataKey={entry.id}
                                stroke="none"
                                fill={toAreaFill(entry.color)}
                                isAnimationActive={false}
                            />
                        ))}
                        {series.map((entry) => (
                            <Line
                                key={entry.id}
                                type="monotone"
                                dataKey={entry.id}
                                stroke={entry.color}
                                strokeWidth={2}
                                dot={false}
                                isAnimationActive={false}
                            />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </Card>
    )
}

export default memo(EvaluatorTemporalMetricsChart)
