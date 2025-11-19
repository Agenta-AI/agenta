import {FC, memo, useState} from "react"

import type {ChartDatum} from "../types"

import {ChartAxis} from "./ChartAxis"
import ChartFrame from "./ChartFrame"
import {format3Sig} from "./utils"

interface ResponsiveMetricChartProps {
    chartData: ChartDatum[]
    extraDimensions: Record<string, any>
    highlightValue?: number
    labelWidth?: number
    direction?: "horizontal" | "vertical"
    dynamicMargin?: Partial<{top: number; right: number; bottom: number; left: number}>
    /** Optional: color for bars (also used for highlight). Default keeps current blue. */
    barColor?: string
    /** Optional: when true, disables gradient and uses a solid color for bars. */
    disableGradient?: boolean
}

const DEFAULT_PRIMARY = "#69B1FF"

/**
 * ResponsiveMetricChart is a functional component that renders a responsive histogram
 * visualization using SVG. This chart displays data as bars with optional highlighted
 * bins, reference lines, and tooltips for detailed information. The chart adapts to
 * its container's size and provides scale functions for accurately positioning elements.
 */
/**
 * ResponsiveMetricChart is a functional component that renders a responsive histogram
 * visualization using SVG. This chart displays data as bars with optional highlighted
 * bins, reference lines, and tooltips for detailed information. The chart adapts to
 * its container's size and provides scale functions for accurately positioning elements.
 *
 * The highlighted bin is automatically inferred from highlightValue (if provided).
 */
const ResponsiveMetricChart: FC<ResponsiveMetricChartProps> = memo(
    ({
        chartData,
        extraDimensions,
        highlightValue,
        labelWidth,
        direction = "horizontal",
        dynamicMargin: dynamicPropsMargin,
        barColor,
        disableGradient = false,
    }) => {
        const binSize = extraDimensions.binSize || 1
        const yMin = Math.min(...(chartData.map((d) => d.edge) as number[]))
        const yMax = Math.max(...(chartData.map((d) => d.edge) as number[])) + binSize
        const xMax = Math.max(...chartData.map((d) => d.value))

        // Y axis: bin midpoints
        const yTicks: number[] = chartData.map((d) => (d.edge ?? 0) + binSize / 2)
        // X axis: value ticks
        const xTicks: number[] = []
        const xTickCount = Math.min(4, xMax)
        for (let i = 0; i <= xTickCount; i++) {
            xTicks.push((i / xTickCount) * xMax)
        }

        const clipPathId = `clip-histogram-${Math.random().toString(36).substr(2, 9)}`
        // Tooltip state
        const [hoveredBin, setHoveredBin] = useState<number | null>(null)
        const [mousePos, setMousePos] = useState<{x: number; y: number} | null>(null)

        // Compute highlighted bin index from highlightValue
        let computedHighlightBinIndex: number | null = null
        if (typeof highlightValue === "number" && chartData.length > 0) {
            const roundTo = (n: number, digits: number) => {
                const factor = Math.pow(10, digits)
                return Math.round(n * factor) / factor
            }
            const DECIMALS = 6
            computedHighlightBinIndex = chartData.findIndex((d, i) => {
                const binStart = d.edge ?? 0
                const binEnd = (d.edge ?? 0) + binSize
                if (i === chartData.length - 1) {
                    // Last bin: inclusive of upper edge, round both values for robust comparison
                    const closeEnough = Math.abs(highlightValue - binEnd) < Math.pow(10, -DECIMALS)
                    return (
                        roundTo(highlightValue, DECIMALS) >= roundTo(binStart, DECIMALS) &&
                        (roundTo(highlightValue, DECIMALS) <= roundTo(binEnd, DECIMALS) ||
                            closeEnough)
                    )
                }
                // Other bins: upper edge exclusive, round for robust comparison
                return (
                    roundTo(highlightValue, DECIMALS) >= roundTo(binStart, DECIMALS) &&
                    roundTo(highlightValue, DECIMALS) < roundTo(binEnd, DECIMALS)
                )
            })
            if (computedHighlightBinIndex === -1) computedHighlightBinIndex = null
        }

        // Dynamically calculate left margin for long y-labels
        const yLabelsFormatted = yTicks.map(format3Sig)
        const defaultMargin = {top: 16, right: 16, bottom: 32, left: 40}
        let dynamicMargin = defaultMargin
        if (direction === "horizontal") {
            const longestLabelLength = yLabelsFormatted.reduce(
                (max, label) => Math.max(max, String(label).length),
                0,
            )
            const dynamicLeftMargin = Math.max(40, Math.min(120, longestLabelLength * 7 + 16))
            dynamicMargin = {...defaultMargin, left: dynamicLeftMargin}
        } else {
            const yAxisLabels = xTicks.map(format3Sig)
            const longestLeft = yAxisLabels.reduce(
                (max, label) => Math.max(max, String(label).length),
                0,
            )
            const dynamicLeftMargin = Math.max(40, Math.min(120, longestLeft * 7 + 16))
            const xAxisLabels = yTicks.map(format3Sig)
            const longestBottom = xAxisLabels.reduce(
                (max, label) => Math.max(max, String(label).length),
                0,
            )
            const dynamicBottomMargin = Math.max(32, Math.min(120, longestBottom * 7 + 16))
            dynamicMargin = {
                ...defaultMargin,
                left: dynamicLeftMargin,
                bottom: dynamicBottomMargin,
                ...dynamicPropsMargin,
            }
        }

        // NEW: resolve fills (keep defaults)
        const baseSolid = barColor || DEFAULT_PRIMARY
        const baseFill = disableGradient ? baseSolid : "url(#barGradientBlue)"
        const highlightFill = barColor || DEFAULT_PRIMARY

        return (
            <div style={{position: "relative"}}>
                <ChartFrame margin={dynamicMargin}>
                    {({svgWidth, svgHeight, plotWidth, plotHeight, margin}) => {
                        // Scales for both orientations
                        const xScaleHorizontal = (value: number) => (value / xMax) * plotWidth
                        const yScaleHorizontal = (value: number) =>
                            ((yMax - value) / (yMax - yMin)) * plotHeight

                        const xScaleVertical = (value: number) =>
                            ((value - yMin) / (yMax - yMin)) * plotWidth
                        const yScaleVertical = (value: number) =>
                            ((xMax - value) / xMax) * plotHeight

                        const isVertical = direction === "vertical"
                        const xScale = isVertical ? xScaleVertical : xScaleHorizontal
                        const yScale = isVertical ? yScaleVertical : yScaleHorizontal

                        return (
                            <>
                                <svg
                                    width={svgWidth}
                                    height={svgHeight}
                                    style={{
                                        margin: 0,
                                        padding: 0,
                                        display: "block",
                                    }}
                                >
                                    {/* Bar gradient (use barColor if provided) */}
                                    <defs>
                                        {!disableGradient && (
                                            <linearGradient
                                                id="barGradientBlue"
                                                x1="0%"
                                                y1="100%"
                                                x2="100%"
                                                y2="0%"
                                            >
                                                <stop
                                                    offset="0%"
                                                    stopColor={barColor ? barColor : "#BAE0FF"}
                                                />
                                                <stop
                                                    offset="100%"
                                                    stopColor={barColor ? barColor : "#69B1FF"}
                                                />
                                            </linearGradient>
                                        )}
                                    </defs>

                                    {/* Bin size overlay */}
                                    {typeof extraDimensions.binSize === "number" && (
                                        <text
                                            x={svgWidth - 8}
                                            y={16}
                                            fontSize="10"
                                            fill="#888"
                                            textAnchor="end"
                                        >
                                            bin {format3Sig(extraDimensions.binSize)}
                                        </text>
                                    )}

                                    {/* Grid lines */}
                                    <g>
                                        {(isVertical ? xTicks : yTicks).map((tick, idx) => (
                                            <line
                                                key={`grid-${idx}`}
                                                x1={margin.left}
                                                y1={
                                                    margin.top +
                                                    (isVertical
                                                        ? yScaleVertical(tick)
                                                        : yScale(tick))
                                                }
                                                x2={margin.left + plotWidth}
                                                y2={
                                                    margin.top +
                                                    (isVertical
                                                        ? yScaleVertical(tick)
                                                        : yScale(tick))
                                                }
                                                stroke="#05172933"
                                                strokeWidth={1}
                                                strokeDasharray="5 5"
                                            />
                                        ))}
                                    </g>

                                    {/* Histogram bars */}
                                    <g clipPath={`url(#${clipPathId})`}>
                                        {chartData.map((d, idx) => {
                                            const isHighlighted = idx === computedHighlightBinIndex
                                            if (isVertical) {
                                                const barLeft =
                                                    margin.left + xScaleVertical(d.edge as number)
                                                const barRight =
                                                    margin.left + xScaleVertical(d.edge + binSize)
                                                const barWidth = Math.abs(barRight - barLeft)
                                                const barHeight =
                                                    plotHeight - yScaleVertical(d.value)
                                                return (
                                                    <g key={idx}>
                                                        <rect
                                                            x={Math.min(barLeft, barRight)}
                                                            y={margin.top + yScaleVertical(d.value)}
                                                            width={barWidth}
                                                            height={barHeight}
                                                            fill={
                                                                isHighlighted
                                                                    ? highlightFill
                                                                    : baseFill
                                                            }
                                                            strokeWidth={0}
                                                            className="histogram-bar cursor-pointer"
                                                        />
                                                        <rect
                                                            x={Math.min(barLeft, barRight)}
                                                            y={margin.top}
                                                            width={Math.max(barWidth, 20)}
                                                            height={plotHeight}
                                                            fill="transparent"
                                                            className="cursor-pointer"
                                                            onMouseEnter={(e) => {
                                                                setHoveredBin(idx)
                                                                const svgRect = (
                                                                    e.target as SVGRectElement
                                                                ).ownerSVGElement?.getBoundingClientRect()
                                                                setMousePos({
                                                                    x:
                                                                        e.clientX -
                                                                        (svgRect?.left ?? 0),
                                                                    y:
                                                                        e.clientY -
                                                                        (svgRect?.top ?? 0),
                                                                })
                                                            }}
                                                            onMouseMove={(e) => {
                                                                const svgRect = (
                                                                    e.target as SVGRectElement
                                                                ).ownerSVGElement?.getBoundingClientRect()
                                                                setMousePos({
                                                                    x:
                                                                        e.clientX -
                                                                        (svgRect?.left ?? 0),
                                                                    y:
                                                                        e.clientY -
                                                                        (svgRect?.top ?? 0),
                                                                })
                                                            }}
                                                            onMouseLeave={() => {
                                                                setHoveredBin(null)
                                                                setMousePos(null)
                                                            }}
                                                        />
                                                    </g>
                                                )
                                            }

                                            const barTop =
                                                margin.top + yScaleHorizontal(d.edge + binSize)
                                            const barBottom =
                                                margin.top + yScaleHorizontal(d.edge as number)
                                            const barHeight = Math.abs(barBottom - barTop)
                                            const rawBarWidth = xScaleHorizontal(d.value)
                                            const barWidth = Math.min(rawBarWidth, plotWidth)
                                            return (
                                                <g key={idx}>
                                                    <rect
                                                        x={margin.left}
                                                        y={Math.min(barTop, barBottom)}
                                                        width={barWidth}
                                                        height={barHeight}
                                                        fill={
                                                            isHighlighted ? highlightFill : baseFill
                                                        }
                                                        strokeWidth={0}
                                                        className="histogram-bar cursor-pointer [clip-path:inset(0_0_0_-4px_round_0_4px_4px_0)]"
                                                    />
                                                    <rect
                                                        x={margin.left}
                                                        y={Math.min(barTop, barBottom)}
                                                        width={Math.max(barWidth, 20)}
                                                        height={barHeight}
                                                        fill="transparent"
                                                        className="cursor-pointer"
                                                        onMouseEnter={(e) => {
                                                            setHoveredBin(idx)
                                                            const svgRect = (
                                                                e.target as SVGRectElement
                                                            ).ownerSVGElement?.getBoundingClientRect()
                                                            setMousePos({
                                                                x: e.clientX - (svgRect?.left ?? 0),
                                                                y: e.clientY - (svgRect?.top ?? 0),
                                                            })
                                                        }}
                                                        onMouseMove={(e) => {
                                                            const svgRect = (
                                                                e.target as SVGRectElement
                                                            ).ownerSVGElement?.getBoundingClientRect()
                                                            setMousePos({
                                                                x: e.clientX - (svgRect?.left ?? 0),
                                                                y: e.clientY - (svgRect?.top ?? 0),
                                                            })
                                                        }}
                                                        onMouseLeave={() => {
                                                            setHoveredBin(null)
                                                            setMousePos(null)
                                                        }}
                                                    />
                                                </g>
                                            )
                                        })}
                                    </g>

                                    {/* Reference lines */}
                                    {typeof extraDimensions.mean === "number" &&
                                        (isVertical ? (
                                            <g>
                                                <line
                                                    x1={
                                                        margin.left +
                                                        xScaleVertical(extraDimensions.mean)
                                                    }
                                                    y1={margin.top}
                                                    x2={
                                                        margin.left +
                                                        xScaleVertical(extraDimensions.mean)
                                                    }
                                                    y2={margin.top + plotHeight}
                                                    stroke="#1C2C3D"
                                                    strokeWidth={2}
                                                    strokeDasharray="5 5"
                                                />
                                                <text
                                                    x={
                                                        margin.left +
                                                        xScaleVertical(extraDimensions.mean)
                                                    }
                                                    y={margin.top - 5}
                                                    fill="#1C2C3D"
                                                    fontSize="10"
                                                    fontWeight="bold"
                                                    textAnchor="middle"
                                                >
                                                    {`μ=${format3Sig(extraDimensions.mean)}`}
                                                </text>
                                            </g>
                                        ) : (
                                            <g>
                                                <line
                                                    x1={margin.left}
                                                    y1={
                                                        margin.top +
                                                        yScaleHorizontal(extraDimensions.mean)
                                                    }
                                                    x2={margin.left + plotWidth}
                                                    y2={
                                                        margin.top +
                                                        yScaleHorizontal(extraDimensions.mean)
                                                    }
                                                    stroke="#1C2C3D"
                                                    strokeWidth={2}
                                                    strokeDasharray="5 5"
                                                />
                                                <text
                                                    x={margin.left + plotWidth - 5}
                                                    y={
                                                        margin.top +
                                                        yScaleHorizontal(extraDimensions.mean) -
                                                        5
                                                    }
                                                    fill="#1C2C3D"
                                                    fontSize="10"
                                                    fontWeight="bold"
                                                    textAnchor="end"
                                                >
                                                    {`μ=${format3Sig(extraDimensions.mean)}`}
                                                </text>
                                            </g>
                                        ))}

                                    {typeof highlightValue === "number" &&
                                        highlightValue !== extraDimensions.mean &&
                                        (isVertical ? (
                                            <g>
                                                <line
                                                    x1={
                                                        margin.left + xScaleVertical(highlightValue)
                                                    }
                                                    y1={margin.top}
                                                    x2={
                                                        margin.left + xScaleVertical(highlightValue)
                                                    }
                                                    y2={margin.top + plotHeight}
                                                    stroke="#52c41a"
                                                    strokeWidth={3}
                                                    strokeDasharray="6 2"
                                                    style={{filter: "drop-shadow(0 0 2px #fff)"}}
                                                />
                                                <text
                                                    x={margin.left + xScaleVertical(highlightValue)}
                                                    y={margin.top - 5}
                                                    fill="#fff"
                                                    fontSize="10"
                                                    fontWeight="bold"
                                                    textAnchor="middle"
                                                    stroke="#fff"
                                                    strokeWidth={3}
                                                    paintOrder="stroke"
                                                    style={{pointerEvents: "none"}}
                                                >
                                                    {format3Sig(highlightValue)}
                                                </text>
                                                <text
                                                    x={margin.left + xScaleVertical(highlightValue)}
                                                    y={margin.top - 5}
                                                    fill="#52c41a"
                                                    fontSize="10"
                                                    fontWeight="bold"
                                                    textAnchor="middle"
                                                    style={{pointerEvents: "none"}}
                                                >
                                                    {format3Sig(highlightValue)}
                                                </text>
                                            </g>
                                        ) : (
                                            <g>
                                                <line
                                                    x1={margin.left}
                                                    y1={
                                                        margin.top +
                                                        yScaleHorizontal(highlightValue)
                                                    }
                                                    x2={margin.left + plotWidth}
                                                    y2={
                                                        margin.top +
                                                        yScaleHorizontal(highlightValue)
                                                    }
                                                    stroke="#52c41a"
                                                    strokeWidth={3}
                                                    strokeDasharray="6 2"
                                                    style={{filter: "drop-shadow(0 0 2px #fff)"}}
                                                />
                                                <text
                                                    x={margin.left + plotWidth - 5}
                                                    y={
                                                        margin.top +
                                                        yScaleHorizontal(highlightValue) -
                                                        5
                                                    }
                                                    fill="#fff"
                                                    fontSize="10"
                                                    fontWeight="bold"
                                                    textAnchor="end"
                                                    stroke="#fff"
                                                    strokeWidth={3}
                                                    paintOrder="stroke"
                                                    style={{pointerEvents: "none"}}
                                                >
                                                    {format3Sig(highlightValue)}
                                                </text>
                                                <text
                                                    x={margin.left + plotWidth - 5}
                                                    y={
                                                        margin.top +
                                                        yScaleHorizontal(highlightValue) -
                                                        5
                                                    }
                                                    fill="#52c41a"
                                                    fontSize="10"
                                                    fontWeight="bold"
                                                    textAnchor="end"
                                                    style={{pointerEvents: "none"}}
                                                >
                                                    {format3Sig(highlightValue)}
                                                </text>
                                            </g>
                                        ))}

                                    {/* Y-axis */}
                                    <g>
                                        <line
                                            x1={margin.left}
                                            y1={margin.top}
                                            x2={margin.left}
                                            y2={margin.top + plotHeight}
                                            stroke="#d9d9d9"
                                            strokeWidth={1}
                                        />
                                    </g>

                                    {/* X/Y Axes */}
                                    {/*
                                        y-axis: categorical labels (formatted bin midpoints)
                                        const yLabels = yTicks.map(format3Sig)
                                        const yLabelScale = (idx: number) => ((yTicks.length - idx - 0.5) * (plotHeight / yTicks.length))
                                    */}
                                    <ChartAxis
                                        svgWidth={svgWidth}
                                        svgHeight={svgHeight}
                                        plotWidth={plotWidth}
                                        plotHeight={plotHeight}
                                        margin={margin}
                                        xLabels={
                                            isVertical
                                                ? yTicks.map(format3Sig)
                                                : xTicks.map(format3Sig)
                                        }
                                        yTicks={isVertical ? xTicks : yTicks}
                                        xScale={(idx: number) =>
                                            isVertical
                                                ? xScaleVertical(yTicks[idx])
                                                : xScaleHorizontal(xTicks[idx])
                                        }
                                        yScale={isVertical ? yScaleVertical : yScaleHorizontal}
                                        yLabels={isVertical ? undefined : yTicks.map(format3Sig)}
                                        yLabelScale={
                                            isVertical
                                                ? undefined
                                                : (idx: number) =>
                                                      (yTicks.length - idx - 0.5) *
                                                      (plotHeight / yTicks.length)
                                        }
                                    />
                                </svg>

                                {/* Tooltip outside SVG */}
                                {hoveredBin !== null &&
                                    chartData[hoveredBin] &&
                                    mousePos &&
                                    (() => {
                                        const total = chartData.reduce((sum, d) => sum + d.value, 0)
                                        const count = chartData[hoveredBin].value
                                        const percent = total > 0 ? (count / total) * 100 : 0
                                        const isHighlighted =
                                            hoveredBin === computedHighlightBinIndex
                                        return (
                                            <div
                                                className="pointer-events-none z-50 absolute px-3 py-2 rounded border border-gray-300 bg-white/95 shadow-lg text-xs text-gray-900 animate-fadein"
                                                style={{
                                                    left: mousePos.x + 16,
                                                    top: mousePos.y - 32,
                                                    minWidth: 120,
                                                    maxWidth: 220,
                                                    whiteSpace: "nowrap",
                                                }}
                                                role="tooltip"
                                                aria-live="polite"
                                            >
                                                {/* Caret */}
                                                <div
                                                    style={{
                                                        position: "absolute",
                                                        left: 4,
                                                        top: "100%",
                                                        width: 0,
                                                        height: 0,
                                                        borderLeft: "7px solid transparent",
                                                        borderRight: "7px solid transparent",
                                                        borderTop: "7px solid #d1d5db",
                                                    }}
                                                />
                                                <div className="mb-1 flex items-center gap-2">
                                                    <span className="font-semibold">Range:</span>
                                                    <span>
                                                        {format3Sig(
                                                            chartData[hoveredBin].edge as number,
                                                        )}
                                                        –
                                                        {format3Sig(
                                                            chartData[hoveredBin].edge + binSize,
                                                        )}
                                                    </span>
                                                    {isHighlighted && (
                                                        <span className="ml-2 px-1 py-0.5 rounded bg-yellow-100 text-yellow-800 font-semibold text-[10px] border border-yellow-300">
                                                            Highlighted
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold">Count:</span>{" "}
                                                    <span>{count}</span>
                                                    <span className="ml-2 text-gray-500">
                                                        ({percent.toFixed(1)}%)
                                                    </span>
                                                </div>
                                            </div>
                                        )
                                    })()}
                            </>
                        )
                    }}
                </ChartFrame>
            </div>
        )
    },
)

export default ResponsiveMetricChart
