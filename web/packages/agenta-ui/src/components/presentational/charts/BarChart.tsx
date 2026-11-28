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
/** Room above the plot for a value label. */
const VALUE_LABEL_ROOM = 14
const VALUE_LABEL_FONT_SIZE = 10
/** `CHAR_WIDTH` is for the axis font; a value label is a little smaller. */
const VALUE_LABEL_CHAR_WIDTH = (CHAR_WIDTH * VALUE_LABEL_FONT_SIZE) / CHART_FONT_SIZE
/** Vertical x labels are cut after this many characters. */
const VERTICAL_LABEL_MAX = 52
/** Average width of one character of a vertical label, to size the room under the plot. */
const VERTICAL_CHAR_WIDTH = 6

/** Vertical bars, one group per category and one bar per series. Renders nothing without data. */
export function BarChart({
    title,
    height,
    series,
    data,
    yMax,
    formatValue = formatChartValue,
    valueLabel,
    verticalLabels = false,
    barColor,
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
    const longest = Math.max(...data.map((d) => d.category.length))
    // Vertical labels add their own room under the plot, so the plot keeps its height.
    const labelChars = Math.min(longest, VERTICAL_LABEL_MAX)
    const extraBottom = verticalLabels
        ? Math.max(0, Math.ceil(labelChars * VERTICAL_CHAR_WIDTH) + 8 - MARGIN_BOTTOM)
        : 0
    const top = MARGIN_TOP + (valueLabel ? VALUE_LABEL_ROOM : 0)
    const plotBottom = height - MARGIN_BOTTOM
    const y = linearScale([low, high], [plotBottom, top])
    const baseline = y(0)
    const bands = bandLayout(plotWidth, data.length, series.length)
    /** The width a value label may take: its bar's share of the group. */
    const barRoom = bands.groupWidth / Math.max(1, series.length)
    const labels = verticalLabels
        ? {every: 1, maxChars: VERTICAL_LABEL_MAX}
        : xLabelEvery(bands.groupWidth, longest)

    const textOf = (value: number, datum: BarChartDatum, key: string) =>
        valueLabel ? valueLabel(value, datum.category, key) : formatValue(value)
    const colorOf = (datum: BarChartDatum, key: string, index: number) =>
        barColor?.(datum.category, key) ?? seriesColor(series[index], index)
    const valuesAt = (datum: BarChartDatum) =>
        seriesValues(series, (key) => {
            const value = valueOf(datum, key)
            return value === null ? null : textOf(value, datum, key)
        }).map((row, index) => ({...row, color: colorOf(datum, row.key, index)}))
    const activeDatum = frame.active === null ? null : data[frame.active]

    return (
        <ChartFrame
            {...frame}
            title={title}
            height={height + extraBottom}
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
                          y: top,
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
                    y={top}
                    width={bands.groupWidth}
                    height={plotBottom - top}
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
                        const barX = left + bands.barStart(index, seriesIndex)
                        const label = valueLabel?.(value, datum.category, s.key)
                        return (
                            <g key={s.key}>
                                <path
                                    data-series={s.key}
                                    d={barPath(barX, bands.barWidth, stubbed, baseline)}
                                    fill={colorOf(datum, s.key, seriesIndex)}
                                />
                                {label && label.length * VALUE_LABEL_CHAR_WIDTH <= barRoom ? (
                                    <text
                                        data-value-label={s.key}
                                        x={barX + bands.barWidth / 2}
                                        y={Math.min(stubbed, baseline) - 4}
                                        textAnchor="middle"
                                        fontSize={VALUE_LABEL_FONT_SIZE}
                                        fill={CHART_AXIS_TEXT}
                                        className="tabular-nums"
                                    >
                                        {label}
                                    </text>
                                ) : null}
                            </g>
                        )
                    })}
                    {verticalLabels ? (
                        <text
                            transform={`rotate(-90 ${left + bands.bandStart(index) + bands.bandWidth / 2} ${plotBottom + 6})`}
                            x={left + bands.bandStart(index) + bands.bandWidth / 2}
                            y={plotBottom + 6}
                            dy="0.32em"
                            textAnchor="end"
                            fontSize={CHART_FONT_SIZE}
                            fill={CHART_AXIS_TEXT}
                        >
                            {truncate(datum.category, labels.maxChars)}
                        </text>
                    ) : index % labels.every === 0 ? (
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
