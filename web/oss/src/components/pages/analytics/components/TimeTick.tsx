interface TimeTickProps {
    x?: number
    y?: number
    payload?: {value: string}
    /** The full ordered tick list, so the first/last tick can right/left-anchor. */
    ticks: string[]
    formatter: (value: string) => string
    fill: string
}

// Custom x-axis tick that end-anchors the last label and start-anchors the first, so
// the edge labels ("4 Aug") stay inside the plot instead of clipping against the margin.
const TimeTick = ({x = 0, y = 0, payload, ticks, formatter, fill}: TimeTickProps) => {
    const value = payload?.value ?? ""
    const anchor =
        value === ticks[ticks.length - 1] ? "end" : value === ticks[0] ? "start" : "middle"

    return (
        <text x={x} y={y} dy={12} textAnchor={anchor} fill={fill} fontSize={12}>
            {formatter(value)}
        </text>
    )
}

export default TimeTick
