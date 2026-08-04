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
            <ReAreaChart data={data} margin={{top: 5, right: 12, left: -12, bottom: 0}}>
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
                        const total = items.reduce((sum, it) => sum + (Number(it.value) || 0), 0)
                        const rows: TooltipRow[] = [
                            ...items.map((it) => ({
                                label: String(it.name),
                                value: valueFormatter(Number(it.value) || 0),
                                color: it.color,
                            })),
                            // A Total only earns its row when the stack has more than one band.
                            ...(items.length > 1
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
                {active.map((s) => (
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
