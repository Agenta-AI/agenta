import React from "react"

import {theme} from "antd"
import {
    Area,
    CartesianGrid,
    AreaChart as ReAreaChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts"

import {formatCompactNumber} from "@/oss/lib/helpers/formatters"

interface CustomAreaChartProps {
    data: any[]
    categories: string[]
    index: string
    colors?: string[]
    valueFormatter?: (value: number) => string
    tickCount?: number
    allowDecimals?: boolean
    className?: string
}

// Map Tremor-like color names to hex values (simplified for this specific use case)
// You might want to expand this or import from a central theme file if available
const colorMap: Record<string, string> = {
    "cyan-600": "#0891b2",
    rose: "#e11d48",
    gray: "#6b7280",
}

const CustomAreaChart: React.FC<CustomAreaChartProps> = ({
    data,
    categories,
    index,
    colors = ["cyan-600"],
    valueFormatter = (value: number) => formatCompactNumber(value),
    tickCount = 5,
    allowDecimals = false,
    className,
}) => {
    const {token} = theme.useToken()

    return (
        <div className={`w-full ${className}`}>
            <ResponsiveContainer width="100%" height="100%">
                <ReAreaChart data={data} margin={{top: 5, right: 5, left: -20, bottom: 0}}>
                    <defs>
                        {categories.map((category, idx) => {
                            const colorKey = colors[idx % colors.length]
                            const color = colorMap[colorKey] || colorKey
                            return (
                                <linearGradient
                                    key={category}
                                    id={`color-${category}`}
                                    x1="0"
                                    y1="0"
                                    x2="0"
                                    y2="1"
                                >
                                    <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                                </linearGradient>
                            )
                        })}
                    </defs>
                    <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke={token.colorBorderSecondary}
                    />
                    <XAxis
                        dataKey={index}
                        tickLine={false}
                        axisLine={false}
                        tick={{fontSize: 12, fill: token.colorTextSecondary}}
                        tickMargin={10}
                        minTickGap={20}
                    />
                    <YAxis
                        tickLine={false}
                        axisLine={false}
                        tick={{fontSize: 12, fill: token.colorTextSecondary}}
                        tickFormatter={valueFormatter}
                        tickCount={tickCount}
                        interval={0}
                        domain={[0, "auto"]}
                        allowDecimals={allowDecimals}
                    />
                    <Tooltip
                        contentStyle={{
                            backgroundColor: token.colorBgElevated,
                            borderColor: token.colorBorder,
                            borderRadius: token.borderRadius,
                            boxShadow: token.boxShadowSecondary,
                            fontSize: 12,
                        }}
                        itemStyle={{color: token.colorText}}
                        labelStyle={{color: token.colorTextSecondary, marginBottom: 8}}
                        formatter={(value: number) => [valueFormatter(value), ""]}
                    />
                    {categories.map((category, idx) => {
                        const colorKey = colors[idx % colors.length]
                        const color = colorMap[colorKey] || colorKey
                        return (
                            <Area
                                key={category}
                                type="monotone"
                                dataKey={category}
                                stroke={color}
                                fillOpacity={1}
                                fill={`url(#color-${category})`}
                                strokeWidth={2}
                            />
                        )
                    })}
                </ReAreaChart>
            </ResponsiveContainer>
        </div>
    )
}

export default CustomAreaChart
