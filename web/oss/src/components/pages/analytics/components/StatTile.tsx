import {Area, AreaChart, ResponsiveContainer} from "recharts"

import {useChartColors} from "../hooks/useChartColors"

export interface StatChange {
    /** Preformatted delta, e.g. "+2.1%" or "+0.3pt". */
    display: string
    /** True when the direction is good for this metric (lower cost/latency is good). */
    good: boolean
}

interface StatTileProps {
    label: string
    value: string
    /** Secondary figure shown next to the value, e.g. "5.5% failed". */
    secondary?: string
    change: StatChange | null
    /** Per-bucket values for the sparkline. */
    spark: number[]
    color: string
}

const StatTile = ({label, value, secondary, change, spark, color}: StatTileProps) => {
    const colors = useChartColors()
    const gradientId = `spark-${label.replace(/\s+/g, "-").toLowerCase()}`
    const sparkData = spark.map((v, i) => ({i, v}))

    return (
        <div className="flex flex-col gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer p-3">
            <span className="text-[11px] font-medium uppercase tracking-wide text-colorTextSecondary">
                {label}
            </span>
            <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold leading-none text-colorText">{value}</span>
                {secondary ? (
                    <span className="text-[12px] text-colorTextTertiary">{secondary}</span>
                ) : null}
            </div>
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                    {change ? (
                        <span
                            className="rounded-md px-1.5 py-0.5 whitespace-nowrap"
                            style={{
                                backgroundColor: change.good ? colors.successBg : colors.errorBg,
                                color: change.good ? colors.success : colors.failed,
                            }}
                        >
                            {change.display}
                        </span>
                    ) : null}
                    <span className="text-[11px] text-colorTextTertiary">vs prev</span>
                </div>
                <div className="h-[36px] w-[90px] shrink-0">
                    {spark.length > 1 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                                data={sparkData}
                                margin={{top: 2, right: 0, left: 0, bottom: 0}}
                            >
                                <defs>
                                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                                        <stop offset="100%" stopColor={color} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <Area
                                    type="monotone"
                                    dataKey="v"
                                    stroke={color}
                                    strokeWidth={1.5}
                                    fill={`url(#${gradientId})`}
                                    dot={false}
                                    isAnimationActive={false}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : null}
                </div>
            </div>
        </div>
    )
}

export default StatTile
