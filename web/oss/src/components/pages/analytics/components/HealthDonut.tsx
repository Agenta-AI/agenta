import {PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer} from "recharts"

import type {HealthScore} from "@/oss/services/tracing/lib/agentAnalytics"

import {BAND_LABEL, bandVisual} from "../assets/health"
import {useChartColors} from "../hooks/useChartColors"

interface HealthDonutProps {
    health: HealthScore
}

// Compact success-rate ring: score in the center, band color on the arc. Below
// the run floor it shows a neutral ring and no score.
const HealthDonut = ({health}: HealthDonutProps) => {
    const colors = useChartColors()
    const {ring} = bandVisual(health.band, colors)
    const value = health.hasEnoughRuns ? health.score : 0

    return (
        <div className="relative w-[80px] h-[80px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                    innerRadius="80%"
                    outerRadius="100%"
                    data={[{value}]}
                    startAngle={90}
                    endAngle={-270}
                >
                    <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                    <RadialBar
                        dataKey="value"
                        cornerRadius={999}
                        fill={ring}
                        background={{fill: colors.track}}
                    />
                </RadialBarChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-sm font-bold leading-none text-colorText">
                    {health.hasEnoughRuns ? health.score : "—"}
                </span>
                <span className="text-[9px] tracking-wide text-colorTextTertiary mt-0.5">
                    {BAND_LABEL[health.band]}
                </span>
            </div>
        </div>
    )
}

export default HealthDonut
