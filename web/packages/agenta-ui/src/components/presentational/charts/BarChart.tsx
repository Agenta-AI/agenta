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
    bandLayout,
    barPath,
    finiteOrNull,
    formatChartValue,
    linearScale,
    niceDomain,
    niceMax,
    seriesColor,
    ticks,
    truncate,
    xLabelEvery,
    yAxisWidth,
} from "./scale"
import type {BarChartDatum, BarChartProps} from "./types"

const MARGIN_TOP = 8
const MARGIN_RIGHT = 8
const MARGIN_BOTTOM = 24
/** A bar for a zero value is still this tall, so it reads as "zero", not "missing". */
const MIN_BAR = 2

/** Vertical bars, one group per category and one bar per series. Renders nothing without data. */
export function BarChart({
    title,
    height,
    series,
    data,
    yMax,
    formatValue = formatChartValue,
    className,
}: BarChartProps) {
    const frame = useChartFrameState(data.length)
    if (data.length === 0 || series.length === 0) return null

    const valueOf = (datum: BarChartDatum, key: string) => finiteOrNull(datum.values[key])
    const values = data.flatMap((datum) =>
        series.map((s) => valueOf(datum, s.key)).filter((v): v is number => v !== null),
    )
    const dataMax = Math.max(0, ...values)
    const dataMin = Math.min(0, ...values)
    const fixedMax = finiteOrNull(yMax) ?? undefined
    const [low, high] =
        dataMin < 0 ? niceDomain(dataMin, fixedMax ?? dataMax) : [0, fixedMax ?? niceMax(dataMax)]
    const yTicks = ticks(low, high)

    const left = yAxisWidth(yTicks, formatValue)
    const plotWidth = Math.max(0, frame.width - left - MARGIN_RIGHT)
    const plotBottom = height - MARGIN_BOTTOM
    const y = linearScale([low, high], [plotBottom, MARGIN_TOP])
    const baseline = y(0)
    const bands = bandLayout(plotWidth, data.length, series.length)
    const labels = xLabelEvery(bands.groupWidth, Math.max(...data.map((d) => d.category.length)))

    const valuesAt = (datum: BarChartDatum) =>
        seriesValues(series, (key) => {
            const value = valueOf(datum, key)
            return value === null ? null : formatValue(value)
        })
    const activeDatum = frame.active === null ? null : data[frame.active]

    return (
        <ChartFrame
            {...frame}
            title={title}
            height={height}
            series={series}
            className={className}
            indexAt={(x) => {
                if (x < left || x > left + plotWidth) return null
                return Math.min(data.length - 1, Math.floor((x - left) / bands.groupWidth))
            }}
            tooltip={
                frame.active === null || activeDatum === null
                    ? null
                    : {
                          x: left + bands.bandStart(frame.active) + bands.bandWidth / 2,
                          y: MARGIN_TOP,
                          label: activeDatum.category,
                          rows: tooltipRows(valuesAt(activeDatum)),
                      }
            }
            table={{
                columns: ["", ...series.map((s) => s.name)],
                rows: data.map((datum) => ({
                    key: datum.category,
                    cells: [datum.category, ...valuesAt(datum).map((row) => row.value ?? "")],
                })),
            }}
        >
            <YGrid ticks={yTicks} y={y} left={left} right={left + plotWidth} format={formatValue} />
            {frame.active !== null ? (
                <rect
                    x={left + frame.active * bands.groupWidth}
                    y={MARGIN_TOP}
                    width={bands.groupWidth}
                    height={plotBottom - MARGIN_TOP}
                    fill="var(--ag-chart-track)"
                    opacity={0.5}
                />
            ) : null}
            {data.map((datum, index) => (
                <g key={datum.category}>
                    {series.map((s, seriesIndex) => {
                        const value = valueOf(datum, s.key)
                        if (value === null) return null
                        const valueY = y(value)
                        const stubbed =
                            Math.abs(baseline - valueY) >= MIN_BAR
                                ? valueY
                                : value < 0
                                  ? baseline + MIN_BAR
                                  : baseline - MIN_BAR
                        return (
                            <path
                                key={s.key}
                                data-series={s.key}
                                d={barPath(
                                    left + bands.barStart(index, seriesIndex),
                                    bands.barWidth,
                                    stubbed,
                                    baseline,
                                )}
                                fill={seriesColor(s, seriesIndex)}
                            />
                        )
                    })}
                    {index % labels.every === 0 ? (
                        <text
                            x={left + bands.bandStart(index) + bands.bandWidth / 2}
                            y={plotBottom + 16}
                            textAnchor="middle"
                            fontSize={CHART_FONT_SIZE}
                            fill={CHART_AXIS_TEXT}
                        >
                            {truncate(datum.category, labels.maxChars)}
                        </text>
                    ) : null}
                </g>
            ))}
            <line
                x1={left}
                x2={left + plotWidth}
                y1={baseline}
                y2={baseline}
                stroke={CHART_AXIS_LINE}
            />
        </ChartFrame>
    )
}
