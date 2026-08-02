import {
    Bar,
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

import ChartTooltip, {type TooltipRow} from "./ChartTooltip"

interface LatencyChartProps {
    data: AgentAnalyticsBucket[]
    /** Legend-visible series keys ("latencyAvg", "latencyP95"). */
    activeKeys: string[]
    formatMs: (value: number) => string
}

// A short horizontal cap over each bucket instead of a connected line, matching
// the design's discrete p95 markers.
const P95Cap = ({cx, cy, color}: {cx?: number; cy?: number; color: string}) => {
    if (typeof cx !== "number" || typeof cy !== "number") return null
    return (
        <line
            x1={cx - 14}
            x2={cx + 14}
            y1={cy}
            y2={cy}
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
        />
    )
}

// Average-latency bars with a per-bucket p95 marker; the tooltip surfaces
// average, p95, min, and max for the hovered bucket.
const LatencyChart = ({data, activeKeys, formatMs}: LatencyChartProps) => {
    const colors = useChartColors()
    const showAvg = activeKeys.includes("latencyAvg")
    const showP95 = activeKeys.includes("latencyP95")

    return (
        <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{top: 5, right: 5, left: -12, bottom: 0}}>
                <CartesianGrid strokeDasharray="2 4" horizontal vertical stroke={colors.grid} />
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
                    cursor={{fill: colors.track, opacity: 0.4}}
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
                                color: colors.latency,
                            },
                            {label: "p95", value: formatMs(bucket.latencyP95), color: colors.p95},
                            {label: "Min", value: formatMs(bucket.latencyMin)},
                            {label: "Max", value: formatMs(bucket.latencyMax)},
                        ]
                        return <ChartTooltip title={String(props.label ?? "")} rows={rows} />
                    }}
                />
                {showAvg ? (
                    <Bar
                        dataKey="latencyAvg"
                        name="Avg"
                        fill={colors.latency}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={48}
                    />
                ) : null}
                {showP95 ? (
                    <Line
                        dataKey="latencyP95"
                        name="p95"
                        type="linear"
                        stroke="none"
                        isAnimationActive={false}
                        dot={(props) => <P95Cap {...props} color={colors.p95} />}
                        activeDot={false}
                        legendType="none"
                    />
                ) : null}
            </ComposedChart>
        </ResponsiveContainer>
    )
}

export default LatencyChart
