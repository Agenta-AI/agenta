import {memo} from "react"

import {
    BarChart as RechartsBarChart,
    Bar,
    XAxis,
    YAxis,
    ResponsiveContainer,
    Tooltip,
    CartesianGrid,
    Cell,
} from "recharts"

type ChartDatum = Record<string, string | number | boolean | undefined>

interface HistogramChartProps {
    data: readonly ChartDatum[]
    xKey: string
    yKey: string
    /** optional key in data row that carries the color (e.g. 'color') */
    colorKey?: string

    /** Axis / chart tuning */
    yDomain?: [number | "auto" | "dataMin", number | "auto" | "dataMax"]
    xAxisProps?: Partial<React.ComponentProps<typeof XAxis>>
    yAxisProps?: Partial<React.ComponentProps<typeof YAxis>>
    cartesianGridProps?: Partial<React.ComponentProps<typeof CartesianGrid>>
    chartProps?: Partial<React.ComponentProps<typeof RechartsBarChart>>
    containerProps?: Partial<React.ComponentProps<typeof ResponsiveContainer>>

    /** Bar sizing & spacing */
    barSize?: number // if omitted, width is auto-calculated from gaps
    barGap?: number | string // e.g. 16 or '30%'
    barCategoryGap?: number | string // e.g. 24 or '30%'

    /** Tooltip label for Y value. Pass falsy to hide Tooltip. */
    tooltipLabel?: string

    /** Per-bar <Cell/> overrides */
    getCellProps?: (row: ChartDatum, index: number) => Partial<React.ComponentProps<typeof Cell>>

    /** Direct pass-through to <Bar/> */
    barProps?: Partial<React.ComponentProps<typeof Bar>>

    className?: string
}

const HistogramChart = ({
    data,
    xKey,
    yKey,
    colorKey,
    yDomain = ["auto", "auto"],
    xAxisProps,
    yAxisProps,
    cartesianGridProps,
    chartProps,
    containerProps,
    // Use percentage-based gaps by default for consistent spacing across datasets
    barSize,
    barGap = "10%",
    barCategoryGap = "30%",
    tooltipLabel = "Value",
    getCellProps,
    barProps,
    className,
}: HistogramChartProps) => {
    const chartBarSize = !barSize ? undefined : barSize
    const yAxisWidth = typeof yAxisProps?.width === "number" ? yAxisProps.width : 48

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
                        formatter={(v: any) => [v as number, tooltipLabel]}
                        cursor={false}
                        contentStyle={{
                            backgroundColor: "white",
                            border: "1px solid #d9d9d9",
                            borderRadius: "4px",
                            padding: "4px 8px",
                        }}
                    />
                ) : null}

                <Bar
                    dataKey={yKey}
                    name={tooltipLabel ?? "Value"}
                    fill="#3B82F6"
                    radius={[4, 4, 0, 0]}
                    barSize={chartBarSize}
                    maxBarSize={100}
                    {...barProps}
                >
                    {data.map((row, i) => {
                        const fill =
                            colorKey && typeof row[colorKey] === "string"
                                ? (row[colorKey] as string)
                                : undefined
                        return (
                            <Cell
                                key={`cell-${i}`}
                                fill={fill}
                                {...(getCellProps?.(row, i) ?? {})}
                            />
                        )
                    })}
                </Bar>
            </RechartsBarChart>
        </ResponsiveContainer>
    )
}

export default memo(HistogramChart)
