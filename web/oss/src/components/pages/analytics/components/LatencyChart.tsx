import {CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts"

import type {AgentAnalyticsBucket} from "@/oss/services/tracing/types/agentAnalytics"

import {useChartColors} from "../hooks/useChartColors"

import ChartTooltip, {type TooltipRow} from "./ChartTooltip"

interface LatencyChartProps {
    data: AgentAnalyticsBucket[]
    /** Legend-visible series keys ("latencyAvg", "latencyP95"). */
    activeKeys: string[]
    formatMs: (value: number) => string
}

// Average latency as a solid line and p95 as a dashed line on one axis. Latency
// statistics are not additive, so a line reads truer than bars; min/max stay in
// the tooltip.
const LatencyChart = ({data, activeKeys, formatMs}: LatencyChartProps) => {
    const colors = useChartColors()
    const showAvg = activeKeys.includes("latencyAvg")
    const showP95 = activeKeys.includes("latencyP95")

    return (
        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{top: 5, right: 5, left: -12, bottom: 0}}>
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
                    tickFormatter={formatMs}
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
                                label: "Average",
                                value: formatMs(bucket.latencyAvg),
                                color: colors.primary,
                            },
                            {label: "p95", value: formatMs(bucket.latencyP95), color: colors.p95},
                            {label: "Min", value: formatMs(bucket.latencyMin)},
                            {label: "Max", value: formatMs(bucket.latencyMax)},
                        ]
                        return <ChartTooltip title={String(props.label ?? "")} rows={rows} />
                    }}
                />
                {showAvg ? (
                    <Line
                        dataKey="latencyAvg"
                        name="Avg"
                        type="monotone"
                        stroke={colors.primary}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{r: 4}}
                        isAnimationActive={false}
                    />
                ) : null}
                {showP95 ? (
                    <Line
                        dataKey="latencyP95"
                        name="p95"
                        type="monotone"
                        stroke={colors.p95}
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        dot={false}
                        activeDot={{r: 4}}
                        isAnimationActive={false}
                    />
                ) : null}
            </LineChart>
        </ResponsiveContainer>
    )
}

export default LatencyChart
