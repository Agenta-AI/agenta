import {
    Bar,
    CartesianGrid,
    Cell,
    BarChart as ReBarChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts"

import type {AgentAnalyticsBreakdownItem} from "@/oss/services/tracing/types/agentAnalytics"

import {useChartColors} from "../hooks/useChartColors"

import ChartTooltip, {type TooltipRow} from "./ChartTooltip"

interface BreakdownBarChartProps {
    data: AgentAnalyticsBreakdownItem[]
    valueFormatter: (value: number) => string
    /** Cap the number of bars; the rest fold into a trailing "Other" bar. */
    maxBars?: number
}

const foldOther = (
    data: AgentAnalyticsBreakdownItem[],
    maxBars: number,
): AgentAnalyticsBreakdownItem[] => {
    if (data.length <= maxBars) return data
    const head = data.slice(0, maxBars - 1)
    const rest = data.slice(maxBars - 1)
    const otherCount = rest.reduce((sum, d) => sum + d.count, 0)
    return [...head, {key: "__other__", label: `Other (${rest.length})`, count: otherCount}]
}

// Horizontal bars sorted descending — the breakdown by harness, model, or agent.
const BreakdownBarChart = ({data, valueFormatter, maxBars = 8}: BreakdownBarChartProps) => {
    const colors = useChartColors()
    const rows = foldOther(data, maxBars)

    return (
        <ResponsiveContainer width="100%" height="100%">
            <ReBarChart
                data={rows}
                layout="vertical"
                margin={{top: 5, right: 12, left: 4, bottom: 0}}
            >
                <CartesianGrid
                    strokeDasharray="2 4"
                    horizontal={false}
                    vertical
                    stroke={colors.grid}
                />
                <XAxis
                    type="number"
                    tickLine={false}
                    axisLine={false}
                    tick={{fontSize: 12, fill: colors.axis}}
                    tickFormatter={valueFormatter}
                    allowDecimals={false}
                    tickCount={4}
                />
                <YAxis
                    type="category"
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{fontSize: 12, fill: colors.axis}}
                    width={120}
                    interval={0}
                />
                <Tooltip
                    cursor={{fill: colors.track, opacity: 0.4}}
                    content={(props) => {
                        const item = (
                            props.payload as unknown as {payload?: AgentAnalyticsBreakdownItem}[]
                        )?.[0]?.payload
                        if (!props.active || !item) return null
                        const rowsOut: TooltipRow[] = [
                            {
                                label: "Runs",
                                value: valueFormatter(item.count),
                                color: colors.primary,
                            },
                        ]
                        return <ChartTooltip title={item.label} rows={rowsOut} />
                    }}
                />
                <Bar dataKey="count" fill={colors.primary} radius={[0, 4, 4, 0]} maxBarSize={28}>
                    {rows.map((row) => (
                        <Cell
                            key={row.key}
                            fill={row.key === "__other__" ? colors.axis : colors.primary}
                        />
                    ))}
                </Bar>
            </ReBarChart>
        </ResponsiveContainer>
    )
}

export default BreakdownBarChart
