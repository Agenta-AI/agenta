import {memo} from "react"

import {
    PolarAngleAxis,
    PolarGrid,
    PolarRadiusAxis,
    Radar,
    RadarChart,
    ResponsiveContainer,
} from "recharts"

const SPIDER_PLACEHOLDER_POINTS: readonly {subject: string; value: number}[] = [
    {subject: "Evaluator quality", value: 58},
    {subject: "Latency", value: 36},
    {subject: "Tokens", value: 64},
    {subject: "Cost", value: 48},
    {subject: "Stability", value: 72},
] as const

const SpiderChartPlaceholder = memo(({className}: {className?: string}) => (
    <div className={className}>
        <ResponsiveContainer width="100%" height="100%">
            <RadarChart cx="50%" cy="50%" outerRadius="70%" data={SPIDER_PLACEHOLDER_POINTS}>
                <PolarGrid stroke="#EAEFF5" />
                <PolarAngleAxis dataKey="subject" tick={false} />
                <PolarRadiusAxis domain={[0, 100]} axisLine={false} tick={false} />
                <Radar
                    dataKey="value"
                    stroke="#9EB8FF"
                    fill="#3B82F6"
                    fillOpacity={0.15}
                    isAnimationActive={false}
                />
            </RadarChart>
        </ResponsiveContainer>
    </div>
))

SpiderChartPlaceholder.displayName = "SpiderChartPlaceholder"

export default SpiderChartPlaceholder
