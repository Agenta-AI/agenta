import {
    Bar,
    CartesianGrid,
    BarChart as ReBarChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts"

import type {AgentAnalyticsBucket} from "@/oss/services/tracing/types/agentAnalytics"

import {useChartColors} from "../hooks/useChartColors"

import type {ChartSeries} from "./ChartCard"
import ChartTooltip, {type TooltipRow} from "./ChartTooltip"

interface StackedBarChartProps {
    data: AgentAnalyticsBucket[]
    series: ChartSeries[]
    activeKeys: string[]
    valueFormatter: (value: number) => string
}

interface TipItem {
    name?: string | number
    value?: number | string
    color?: string
}

// Stacked bars over the time buckets, one stack segment per active series.
const StackedBarChart = ({data, series, activeKeys, valueFormatter}: StackedBarChartProps) => {
    const colors = useChartColors()

    return (
        <ResponsiveContainer width="100%" height="100%">
            <ReBarChart data={data} margin={{top: 5, right: 5, left: -12, bottom: 0}}>
                <CartesianGrid
                    strokeDasharray="2 4"
                    horizontal
                    vertical={false}
                    stroke={colors.grid}
                />
                <XAxis
                    dataKey="timestamp"
                    tickLine={false}
                    axisLine={false}
                    tick={{fontSize: 12, fill: colors.axis}}
                    tickMargin={10}
                    minTickGap={20}
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
                    cursor={{fill: colors.track, opacity: 0.4}}
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
                            {label: "Total", value: valueFormatter(total)},
                        ]
                        return <ChartTooltip title={String(props.label ?? "")} rows={rows} />
                    }}
                />
                {(() => {
                    const active = series.filter((s) => activeKeys.includes(s.key))
                    return active.map((s, i) => (
                        <Bar
                            key={s.key}
                            dataKey={s.key}
                            name={s.label}
                            stackId="stack"
                            fill={s.color}
                            // Round only the top segment so the stack reads as one bar.
                            radius={i === active.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                            maxBarSize={48}
                        />
                    ))
                })()}
            </ReBarChart>
        </ResponsiveContainer>
    )
}

export default StackedBarChart
