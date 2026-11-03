import {
    CHART_AXIS_LINE,
    CHART_AXIS_TEXT,
    CHART_FONT_SIZE,
    ChartFrame,
    YGrid,
    useChartFrameState,
    type ChartTooltipContent,
} from "./ChartParts"
import {
    CHAR_WIDTH,
    formatChartValue,
    lineSegments,
    linearScale,
    nearestIndex,
    niceDomain,
    polylinePath,
    seriesColor,
    spreadIndexes,
    ticks as tickValues,
} from "./scale"
import type {LineChartProps} from "./types"

const TOP = 8
const BOTTOM = 24
/** Room for half of the last x label, which is centered on its point. */
const RIGHT = 12
const AREA_OPACITY = 0.12
/** Minimum horizontal room for one x tick label. */
const X_TICK_SPACING = 96

const defaultFormatX = (x: number) => new Date(x).toLocaleString()

/** Values over time, one straight line with a light area per series. A null breaks the line. */
export function LineChart({
    title,
    height,
    series,
    points: unsortedPoints,
    formatValue = formatChartValue,
    formatX = defaultFormatX,
    yDomain,
    className,
}: LineChartProps) {
    const frame = useChartFrameState(unsortedPoints.length)
    if (unsortedPoints.length === 0 || series.length === 0) return null

    const points = [...unsortedPoints].sort((a, b) => a.x - b.x)
    const values = points.flatMap((p) =>
        series.map((s) => p.values[s.key]).filter((v): v is number => v != null),
    )
    const [low, high] =
        yDomain ?? (values.length ? niceDomain(Math.min(...values), Math.max(...values)) : [0, 1])
    const yTicks = tickValues(low, high)

    const left = Math.max(...yTicks.map((t) => formatValue(t).length)) * CHAR_WIDTH + 10
    const plotRight = Math.max(left, frame.width - RIGHT)
    const bottom = height - BOTTOM
    const first = points[0].x
    const last = points[points.length - 1].x
    const x = linearScale([first, last], [left, plotRight])
    const y = linearScale([low, high], [bottom, TOP])
    const xs = points.map((p) => x(p.x))
    const xTicks = spreadIndexes(
        points.length,
        Math.max(2, Math.floor((plotRight - left) / X_TICK_SPACING)),
    )

    const active = frame.active === null ? null : points[frame.active]
    const tooltip: ChartTooltipContent | null =
        frame.active === null || active === null
            ? null
            : {
                  x: xs[frame.active],
                  y: TOP,
                  label: formatX(active.x),
                  rows: series.flatMap((s, index) => {
                      const value = active.values[s.key]
                      return value == null
                          ? []
                          : [
                                {
                                    key: s.key,
                                    name: s.name,
                                    color: seriesColor(s, index),
                                    value: formatValue(value),
                                },
                            ]
                  }),
              }

    return (
        <ChartFrame
            {...frame}
            title={title}
            height={height}
            series={series}
            className={className}
            count={points.length}
            indexAt={(px) => nearestIndex(xs, px)}
            tooltip={tooltip}
            table={{
                columns: ["", ...series.map((s) => s.name)],
                rows: points.map((point, index) => ({
                    key: `${point.x}-${index}`,
                    cells: [
                        formatX(point.x),
                        ...series.map((s) => {
                            const value = point.values[s.key]
                            return value == null ? "" : formatValue(value)
                        }),
                    ],
                })),
            }}
        >
            <YGrid ticks={yTicks} y={y} left={left} right={plotRight} format={formatValue} />
            <line x1={left} x2={plotRight} y1={bottom} y2={bottom} stroke={CHART_AXIS_LINE} />
            {xTicks.map((index) => {
                // The end labels align inwards so they stay inside the chart.
                const anchor =
                    xTicks.length > 1 && index === 0
                        ? "start"
                        : xTicks.length > 1 && index === points.length - 1
                          ? "end"
                          : "middle"
                return (
                    <text
                        key={index}
                        x={xs[index]}
                        y={bottom + 16}
                        textAnchor={anchor}
                        fontSize={CHART_FONT_SIZE}
                        fill={CHART_AXIS_TEXT}
                    >
                        {formatX(points[index].x)}
                    </text>
                )
            })}
            {frame.active !== null ? (
                <line
                    x1={xs[frame.active]}
                    x2={xs[frame.active]}
                    y1={TOP}
                    y2={bottom}
                    stroke={CHART_AXIS_LINE}
                />
            ) : null}
            {series.map((s, seriesIndex) => {
                const color = seriesColor(s, seriesIndex)
                const activeValue = active?.values[s.key]
                const segments = lineSegments(
                    points.map((p, index) => {
                        const value = p.values[s.key]
                        return [xs[index], value == null ? null : y(value)] as const
                    }),
                )
                return (
                    <g key={s.key} data-series={s.key}>
                        {segments.map((segment, index) =>
                            segment.length === 1 ? (
                                <circle
                                    key={index}
                                    cx={segment[0][0]}
                                    cy={segment[0][1]}
                                    r={4}
                                    fill={color}
                                />
                            ) : (
                                <g key={index}>
                                    <path
                                        d={`${polylinePath(segment)} V${bottom} H${segment[0][0]} Z`}
                                        fill={color}
                                        fillOpacity={AREA_OPACITY}
                                    />
                                    <path
                                        d={polylinePath(segment)}
                                        fill="none"
                                        stroke={color}
                                        strokeWidth={2}
                                        strokeLinejoin="round"
                                        strokeLinecap="round"
                                    />
                                </g>
                            ),
                        )}
                        {activeValue != null && frame.active !== null ? (
                            <circle
                                cx={xs[frame.active]}
                                cy={y(activeValue)}
                                r={4}
                                fill={color}
                                stroke="var(--ag-colorBgContainer)"
                                strokeWidth={2}
                            />
                        ) : null}
                    </g>
                )
            })}
        </ChartFrame>
    )
}
