import {memo} from "react"

import {
    BarChart as RechartsBarChart,
    Bar,
    XAxis,
    YAxis,
    ResponsiveContainer,
    Tooltip,
    CartesianGrid,
    Legend,
    ReferenceLine,
} from "recharts"

type ChartDatum = Record<string, string | number | boolean | undefined>

interface HistogramChartProps {
    data: readonly ChartDatum[]
    xKey: string
    yKey: string
    yDomain?: [number | "auto" | "dataMin", number | "auto" | "dataMax"]
    xAxisProps?: Partial<React.ComponentProps<typeof XAxis>>
    yAxisProps?: Partial<React.ComponentProps<typeof YAxis>>
    cartesianGridProps?: Partial<React.ComponentProps<typeof CartesianGrid>>
    chartProps?: Partial<React.ComponentProps<typeof RechartsBarChart>>
    containerProps?: Partial<React.ComponentProps<typeof ResponsiveContainer>>
    barSize?: number
    barGap?: number | string
    barCategoryGap?: number | string
    tooltipLabel?: string
    series?: Array<{
        key: string
        name: string
        color?: string
        barProps?: Partial<React.ComponentProps<typeof Bar>>
    }>
    referenceLines?: Array<{value: number; color?: string; label?: string}>
    showLegend?: boolean
    barProps?: Partial<React.ComponentProps<typeof Bar>>
}

const HistogramChart = ({
    data,
    xKey,
    yKey,
    yDomain = ["auto", "auto"],
    xAxisProps,
    yAxisProps,
    cartesianGridProps,
    chartProps,
    containerProps,
    barSize,
    barGap = "10%",
    barCategoryGap = "30%",
    tooltipLabel = "Value",
    series,
    referenceLines,
    showLegend = true,
    barProps,
}: HistogramChartProps) => {
    const chartBarSize = !barSize ? undefined : barSize
    const yAxisWidth = typeof yAxisProps?.width === "number" ? yAxisProps.width : 48
    const activeSeries =
        series && series.length
            ? series
            : [
                  {
                      key: yKey,
                      name: tooltipLabel ?? "Value",
                      color: "#3B82F6",
                      barProps,
                  },
              ]

    return (
        <ResponsiveContainer
            width="100%"
            height="100%"
            className="recharts-chart-container"
            {...containerProps}
        >
            <RechartsBarChart
                data={data as any}
                barSize={chartBarSize}
                barGap={barGap}
                barCategoryGap={barCategoryGap}
                {...chartProps}
            >
                <XAxis
                    dataKey={xKey}
                    tickLine={false}
                    tick={{fill: "#666"}}
                    height={20}
                    {...xAxisProps}
                />
                <YAxis
                    domain={yDomain as any}
                    tickLine={{stroke: "#05172933"}}
                    tick={{fill: "#666"}}
                    tickMargin={8}
                    width={yAxisWidth}
                    {...yAxisProps}
                />
                <CartesianGrid
                    strokeDasharray="3 2"
                    horizontal
                    vertical={false}
                    stroke="#05172933"
                    {...cartesianGridProps}
                />

                {tooltipLabel ? (
                    <Tooltip
                        formatter={(value: any, name: any) => [value as number, name]}
                        cursor={false}
                        contentStyle={{
                            backgroundColor: "white",
                            border: "1px solid #d9d9d9",
                            borderRadius: "4px",
                            padding: "4px 8px",
                        }}
                    />
                ) : null}

                {showLegend && activeSeries.length > 1 ? <Legend /> : null}

                {referenceLines?.map((line) => (
                    <ReferenceLine
                        key={`${line.label ?? "line"}-${line.value}`}
                        x={line.value}
                        stroke={line.color ?? "#94A3B8"}
                        strokeDasharray="4 2"
                        label={line.label}
                    />
                ))}

                {activeSeries.map((seriesItem) => (
                    <Bar
                        key={seriesItem.key}
                        dataKey={seriesItem.key}
                        name={seriesItem.name}
                        fill={seriesItem.color ?? "#3B82F6"}
                        radius={[8, 8, 0, 0]}
                        barSize={chartBarSize}
                        maxBarSize={100}
                        {...barProps}
                        {...(seriesItem.barProps ?? {})}
                    />
                ))}
            </RechartsBarChart>
        </ResponsiveContainer>
    )
}

export default memo(HistogramChart)
