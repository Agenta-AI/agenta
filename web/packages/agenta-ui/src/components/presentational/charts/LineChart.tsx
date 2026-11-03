import {
    CHART_AXIS_LINE,
    CHART_AXIS_TEXT,
    CHART_FONT_SIZE,
    ChartFrame,
    YGrid,
    seriesValues,
    tooltipRows,
    useChartFrameState,
} from "./ChartParts"
import {
    CHAR_WIDTH,
    finiteOrNull,
    formatChartValue,
    lineSegments,
    linearScale,
    nearestIndex,
    niceDomain,
    polylinePath,
    seriesColor,
    spreadIndexes,
    ticks,
    yAxisWidth,
} from "./scale"
import type {LineChartProps, LinePoint} from "./types"

const MARGIN_TOP = 8
const MARGIN_BOTTOM = 24
const MARGIN_RIGHT = 12
const AREA_OPACITY = 0.12
/** Empty space between two x tick labels. */
const X_TICK_GAP = 24

const defaultFormatX = (x: number) =>
    new Date(x).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })

/** The y domain the caller fixed, when it is usable; otherwise null. */
function fixedDomain(domain: LineChartProps["yDomain"]): [number, number] | null {
    if (!domain) return null
    const [low, high] = domain.map(finiteOrNull)
    return low !== null && high !== null && high > low ? [low, high] : null
}

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
    const valueOf = (point: LinePoint, key: string) => finiteOrNull(point.values[key])
    const values = points.flatMap((p) =>
        series.map((s) => valueOf(p, s.key)).filter((v): v is number => v !== null),
    )
    const [low, high] =
        fixedDomain(yDomain) ??
        (values.length ? niceDomain(Math.min(...values), Math.max(...values)) : [0, 1])
    const yTicks = ticks(low, high)

    const left = yAxisWidth(yTicks, formatValue)
    const plotRight = Math.max(left, frame.width - MARGIN_RIGHT)
    const plotBottom = height - MARGIN_BOTTOM
    const x = linearScale([points[0].x, points[points.length - 1].x], [left, plotRight])
    const y = linearScale([low, high], [plotBottom, MARGIN_TOP])
    const xs = points.map((p) => x(p.x))
    const xLabels = points.map((p) => formatX(p.x))
    const labelWidth = Math.max(...xLabels.map((label) => label.length)) * CHAR_WIDTH
    const xTicks = spreadIndexes(
        points.length,
        Math.max(2, Math.floor((plotRight - left) / (labelWidth + X_TICK_GAP))),
    )

    const valuesAt = (point: LinePoint) =>
        seriesValues(series, (key) => {
            const value = valueOf(point, key)
            return value === null ? null : formatValue(value)
        })
    const activePoint = frame.active === null ? null : points[frame.active]
    const activeX = frame.active === null ? null : xs[frame.active]

    return (
        <ChartFrame
            {...frame}
            title={title}
            height={height}
            series={series}
            className={className}
            indexAt={(px) => nearestIndex(xs, px)}
            tooltip={
                activePoint === null || activeX === null
                    ? null
                    : {
                          x: activeX,
                          y: MARGIN_TOP,
                          label: formatX(activePoint.x),
                          rows: tooltipRows(valuesAt(activePoint)),
                      }
            }
            table={{
                columns: ["", ...series.map((s) => s.name)],
                rows: points.map((point, index) => ({
                    key: `${point.x}-${index}`,
                    cells: [xLabels[index], ...valuesAt(point).map((row) => row.value ?? "")],
                })),
            }}
        >
            <YGrid ticks={yTicks} y={y} left={left} right={plotRight} format={formatValue} />
            <line
                x1={left}
                x2={plotRight}
                y1={plotBottom}
                y2={plotBottom}
                stroke={CHART_AXIS_LINE}
            />
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
                        y={plotBottom + 16}
                        textAnchor={anchor}
                        fontSize={CHART_FONT_SIZE}
                        fill={CHART_AXIS_TEXT}
                    >
                        {xLabels[index]}
                    </text>
                )
            })}
            {activeX !== null ? (
                <line
                    x1={activeX}
                    x2={activeX}
                    y1={MARGIN_TOP}
                    y2={plotBottom}
                    stroke={CHART_AXIS_LINE}
                />
            ) : null}
            {series.map((s, seriesIndex) => {
                const color = seriesColor(s, seriesIndex)
                const activeValue = activePoint === null ? null : valueOf(activePoint, s.key)
                const segments = lineSegments(
                    points.map((p, index) => {
                        const value = valueOf(p, s.key)
                        return [xs[index], value === null ? null : y(value)] as const
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
                                        d={`${polylinePath(segment)} V${plotBottom} H${segment[0][0]} Z`}
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
                        {activeValue !== null && activeX !== null ? (
                            <circle
                                cx={activeX}
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
