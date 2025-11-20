import clsx from "clsx"
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
    ComposedChart,
} from "recharts"

type ChartDatum = Record<string, string | number | boolean | undefined>

interface BarChartProps {
    data: ReadonlyArray<ChartDatum>
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
    barSize?: number // default 100px
    barGap?: number | string // e.g. 0 or '0%'
    barCategoryGap?: number | string // e.g. 0 or '0%'

    /** Tooltip label for Y value. Pass falsy to hide Tooltip. */
    tooltipLabel?: string

    /** Per-bar <Cell/> overrides */
    getCellProps?: (row: ChartDatum, index: number) => Partial<React.ComponentProps<typeof Cell>>

    /** Direct pass-through to <Bar/> */
    barProps?: Partial<React.ComponentProps<typeof Bar>>

    className?: string
}

const BarChart = ({
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
    barSize = 100,
    barGap = 16,
    barCategoryGap = 24,
    tooltipLabel = "Value",
    getCellProps,
    barProps,
    className,
}: BarChartProps) => {
    const chartBarSize = !barSize ? undefined : barSize
    return (
        <div
            className={clsx(
                "recharts-chart-container w-full h-full  outline-none focus:outline-none focus-visible:outline-none focus-within:outline-none",
                className,
            )}
            tabIndex={0}
        >
            <ResponsiveContainer
                width="100%"
                height="100%"
                className="outline-none focus:outline-none"
                style={{outline: "none"}}
                {...containerProps}
            >
                <ComposedChart
                    data={data as any}
                    barSize={chartBarSize}
                    barGap={barGap}
                    barCategoryGap={barCategoryGap}
                    className="outline-none focus:outline-none"
                    style={{outline: "none"}}
                    {...chartProps}
                >
                    <XAxis dataKey={xKey} tickLine={false} tick={{fill: "#666"}} {...xAxisProps} />
                    <YAxis
                        domain={yDomain as any}
                        tickLine={{stroke: "#05172933"}}
                        tick={{fill: "#666"}}
                        tickMargin={8}
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
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    )
}

export default memo(BarChart)
