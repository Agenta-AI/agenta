import {
    Area,
    CartesianGrid,
    ComposedChart,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts"

import type {AgentAnalyticsBucket} from "@/oss/services/tracing/types/agentAnalytics"

import {useChartColors} from "../hooks/useChartColors"
import type {TimeAxis} from "../hooks/useTimeAxis"

import ChartTooltip, {type TooltipRow} from "./ChartTooltip"
import TimeTick from "./TimeTick"

// Above this many buckets a per-point marker becomes noise, so dots only render on
// sparse windows (where a lone point would otherwise be invisible).
const DOT_THRESHOLD = 14

interface LatencyChartProps {
    data: AgentAnalyticsBucket[]
    /** Legend-visible series keys ("latencyAvg", "latencyP95"). */
    activeKeys: string[]
    formatMs: (value: number) => string
    timeAxis: TimeAxis
}

// Average latency as a gradient area with p95 as a dashed line on one axis, matching
// the home-page charts. Latency statistics are not additive, so an area/line reads
// truer than bars; min/max stay in the tooltip.
const LatencyChart = ({data, activeKeys, formatMs, timeAxis}: LatencyChartProps) => {
    const colors = useChartColors()
    const showAvg = activeKeys.includes("latencyAvg")
    const showP95 = activeKeys.includes("latencyP95")
    const showDots = data.length <= DOT_THRESHOLD

    return (
        <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{top: 5, right: 12, left: -12, bottom: 0}}>
                <defs>
                    <linearGradient id="latency-area-fill" x1="0" y1="0" x2="0" y2="1">
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
                        return (
                            <ChartTooltip
                                title={timeAxis.formatTooltipLabel(String(props.label ?? ""))}
                                rows={rows}
                            />
                        )
                    }}
                />
                {showAvg ? (
                    <Area
                        dataKey="latencyAvg"
                        name="Avg"
                        type="monotone"
                        stroke={colors.primary}
                        strokeWidth={2}
                        fill="url(#latency-area-fill)"
                        dot={showDots ? {r: 2, fill: colors.primary, strokeWidth: 0} : false}
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
                        dot={showDots ? {r: 2, fill: colors.p95, strokeWidth: 0} : false}
                        activeDot={{r: 4}}
                        isAnimationActive={false}
                    />
                ) : null}
            </ComposedChart>
        </ResponsiveContainer>
    )
}

export default LatencyChart
