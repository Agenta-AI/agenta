import {FC} from "react"

import {format3Sig} from "./utils"

interface ChartAxisProps {
    svgWidth: number
    svgHeight: number
    plotWidth: number
    plotHeight: number
    margin: {top: number; right: number; bottom: number; left: number}
    xLabels: (string | number)[]
    yTicks?: number[] // for numeric axes
    yLabels?: (string | number)[] // for categorical axes
    xScale: (idx: number) => number
    yScale: (value: number) => number
    yLabelScale?: (idx: number) => number // for categorical axes
}

export const ChartAxis: FC<ChartAxisProps> = ({
    svgWidth,
    svgHeight,
    plotWidth,
    plotHeight,
    margin,
    xLabels,
    yTicks,
    yLabels,
    xScale,
    yScale,
    yLabelScale,
}) => (
    <g>
        {/* X Axis Line */}
        <line
            x1={margin.left}
            y1={margin.top + plotHeight}
            x2={margin.left + plotWidth}
            y2={margin.top + plotHeight}
            stroke="#d9d9d9"
            strokeWidth={1}
        />
        {/* X Axis Labels */}
        {xLabels.map((label, idx) => (
            <text
                key={"xlabel-" + idx}
                x={margin.left + xScale(idx)}
                y={margin.top + plotHeight + 16}
                fill="#8c8c8c"
                fontSize="10"
                textAnchor="middle"
            >
                {label}
            </text>
        ))}
        {/* Y Axis Line */}
        <line
            x1={margin.left}
            y1={margin.top}
            x2={margin.left}
            y2={margin.top + plotHeight}
            stroke="#d9d9d9"
            strokeWidth={1}
        />
        {/* Y Axis Labels */}
        {yLabels && yLabelScale
            ? yLabels.map((label, idx) => (
                  <text
                      key={"ylabel-" + idx}
                      x={margin.left - 8}
                      y={margin.top + yLabelScale(idx) + 4}
                      fill="#8c8c8c"
                      fontSize="10"
                      textAnchor="end"
                  >
                      {label}
                  </text>
              ))
            : yTicks?.map((tick) => (
                  <text
                      key={"ytick-" + tick}
                      x={margin.left - 8}
                      y={margin.top + yScale(tick) + 4}
                      fill="#8c8c8c"
                      fontSize="10"
                      textAnchor="end"
                  >
                      {format3Sig(tick)}
                  </text>
              ))}
    </g>
)
