import {
    Area,
    CartesianGrid,
    AreaChart as ReAreaChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts"

import type {AgentAnalyticsBucket} from "@/oss/services/tracing/types/agentAnalytics"

import {useChartColors} from "../hooks/useChartColors"
import type {TimeAxis} from "../hooks/useTimeAxis"

import type {ChartSeries} from "./ChartCard"
import ChartTooltip, {type TooltipRow} from "./ChartTooltip"
import TimeTick from "./TimeTick"

interface StackedAreaChartProps {
    data: AgentAnalyticsBucket[]
    series: ChartSeries[]
    activeKeys: string[]
    valueFormatter: (value: number) => string
    timeAxis: TimeAxis
}

interface TipItem {
    name?: string | number
    value?: number | string
    color?: string
}

// Stacked gradient areas over the time buckets, one per active series. Counts read
// truer as an area than as bars once the window is sub-day bucketed (dozens of thin
// bands), and it matches the home-page Requests/Latency charts.
const StackedAreaChart = ({
    data,
    series,
    activeKeys,
    valueFormatter,
    timeAxis,
}: StackedAreaChartProps) => {
    const colors = useChartColors()
    const active = series.filter((s) => activeKeys.includes(s.key))

    return (
        <ResponsiveContainer width="100%" height="100%">
            {/* Key on the active set: recharts orders a stack by internal item
                registration, not JSX order, so a toggled-off series re-mounts onto the
                top of the stack. Remounting the chart re-registers both bands in order. */}
            <ReAreaChart
                key={active.map((s) => s.key).join("|")}
                data={data}
                margin={{top: 5, right: 12, left: -12, bottom: 0}}
            >
                <defs>
                    {active.map((s) => (
                        <linearGradient
                            key={s.key}
                            id={`stacked-area-${s.key}`}
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                        >
                            <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                            <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                        </linearGradient>
                    ))}
                </defs>
                <CartesianGrid
                    strokeDasharray="2 4"
                    horizontal
                    vertical={false}
                    stroke={colors.grid}
                />
                <XAxis
                    dataKey="timestamp"
                    ticks={timeAxis.ticks}
                    interval={0}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={10}
                    minTickGap={20}
                    tick={(props) => (
                        <TimeTick
                            {...props}
                            ticks={timeAxis.ticks}
                            formatter={timeAxis.tickFormatter}
                            fill={colors.axis}
                        />
                    )}
                />
                <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{fontSize: 12, fill: colors.axis}}
                    tickFormatter={valueFormatter}
                    tickCount={5}
                    allowDecimals={false}
                    width={56}
                />
                <Tooltip
                    cursor={{stroke: colors.grid, strokeWidth: 1}}
                    position={{y: 0}}
                    content={(props) => {
                        const items = (props.payload as unknown as TipItem[] | undefined) ?? []
                        if (!props.active || items.length === 0) return null
                        // Order rows by the series (legend) order, not the reversed
                        // stack draw order below.
                        const byName = new Map(items.map((it) => [String(it.name), it]))
                        const ordered = active
                            .map((s) => byName.get(s.label))
                            .filter((it): it is TipItem => Boolean(it))
                        const total = ordered.reduce((sum, it) => sum + (Number(it.value) || 0), 0)
                        const rows: TooltipRow[] = [
                            ...ordered.map((it) => ({
                                label: String(it.name),
                                value: valueFormatter(Number(it.value) || 0),
                                color: it.color,
                            })),
                            // A Total only earns its row when the stack has more than one band.
                            ...(ordered.length > 1
                                ? [{label: "Total", value: valueFormatter(total)}]
                                : []),
                        ]
                        return (
                            <ChartTooltip
                                title={timeAxis.formatTooltipLabel(String(props.label ?? ""))}
                                rows={rows}
                            />
                        )
                    }}
                />
                {/* Reversed so series[0] draws on top: the first Area is the stack's
                    bottom band, so a zero-height "Failed" no longer paints its stroke at
                    the running total. */}
                {[...active].reverse().map((s) => (
                    <Area
                        key={s.key}
                        dataKey={s.key}
                        name={s.label}
                        type="monotone"
                        stackId="stack"
                        stroke={s.color}
                        strokeWidth={2}
                        fill={`url(#stacked-area-${s.key})`}
                        dot={false}
                        activeDot={{r: 4}}
                        isAnimationActive={false}
                    />
                ))}
            </ReAreaChart>
        </ResponsiveContainer>
    )
}

export default StackedAreaChart
