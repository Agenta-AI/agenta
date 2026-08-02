import {Bar, BarChart as ReBarChart, ResponsiveContainer, XAxis, YAxis} from "recharts"

import {useChartColors} from "../hooks/useChartColors"

import EmptyOverlay from "./EmptyOverlay"

// Static silhouette so the empty chart still reads as a chart, not a blank box.
const GHOST_DATA = [40, 62, 74, 52, 48, 88, 66].map((v, i) => ({i, v}))

// Faint placeholder bars + dotted grid behind the "no data" message — the design's ghosted chart.
const GhostChart = () => {
    const colors = useChartColors()

    return (
        <div className="relative h-full w-full">
            <ResponsiveContainer width="100%" height="100%">
                <ReBarChart data={GHOST_DATA} margin={{top: 5, right: 5, left: -12, bottom: 0}}>
                    <XAxis dataKey="i" hide />
                    <YAxis hide domain={[0, 100]} />
                    <Bar
                        dataKey="v"
                        fill={colors.primary}
                        fillOpacity={0.15}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={48}
                        isAnimationActive={false}
                    />
                </ReBarChart>
            </ResponsiveContainer>
            <EmptyOverlay />
        </div>
    )
}

export default GhostChart
