import {Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts"

import type {AgentAnalyticsBucket} from "@/oss/services/tracing/types/agentAnalytics"

import {useChartColors} from "../hooks/useChartColors"
import type {TimeAxis} from "../hooks/useTimeAxis"

import ChartTooltip, {type TooltipRow} from "./ChartTooltip"
import TimeTick from "./TimeTick"

interface CostAreaChartProps {
    data: AgentAnalyticsBucket[]
    valueFormatter: (value: number) => string
    timeAxis: TimeAxis
}

// Single cost total as an area with a subtle vertical fade, matching the
// observability dashboard. Cost has no working prompt/completion split.
const CostAreaChart = ({data, valueFormatter, timeAxis}: CostAreaChartProps) => {
    const colors = useChartColors()

    return (
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{top: 5, right: 12, left: -12, bottom: 0}}>
                <defs>
                    <linearGradient id="cost-area-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={colors.primary} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={colors.primary} stopOpacity={0.02} />
                    </linearGradient>
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
                    width={56}
                />
                <Tooltip
                    cursor={{stroke: colors.grid, strokeWidth: 1}}
                    position={{y: 0}}
                    content={(props) => {
                        const items = props.payload as unknown as
                            | {payload?: AgentAnalyticsBucket}[]
                            | undefined
                        const bucket = items?.[0]?.payload
                        if (!props.active || !bucket) return null
                        const rows: TooltipRow[] = [
                            {
                                label: "Cost",
                                value: valueFormatter(bucket.cost),
                                color: colors.primary,
                            },
                        ]
                        return (
                            <ChartTooltip
                                title={timeAxis.formatTooltipLabel(String(props.label ?? ""))}
                                rows={rows}
                            />
                        )
                    }}
                />
                <Area
                    dataKey="cost"
                    name="Cost"
                    type="monotone"
                    stroke={colors.primary}
                    strokeWidth={2}
                    fill="url(#cost-area-fill)"
                    dot={false}
                    activeDot={{r: 4}}
                    isAnimationActive={false}
                />
            </AreaChart>
        </ResponsiveContainer>
    )
}

export default CostAreaChart
