import {Typography} from "antd"
import clsx from "clsx"
import {memo, useMemo} from "react"
import {
    PolarAngleAxis,
    PolarGrid,
    PolarRadiusAxis,
    Radar,
    RadarChart,
    ResponsiveContainer,
    Tooltip,
} from "recharts"
import {EvaluatorMetricsSpiderChartProps, MetricData} from "./types"
import {formatCurrency, formatLatency} from "@/oss/lib/helpers/formatters"
import {format3Sig} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/utils"

const EvaluatorMetricsSpiderChart = ({
    className,
    metrics = [],
    maxScore = 100,
}: EvaluatorMetricsSpiderChartProps) => {
    // Build chart data with per-axis normalization to 0-100 so
    // each axis can have its own maxScore while sharing a single radius scale.
    const chartData: MetricData[] = useMemo(() => {
        return metrics.map((m) => {
            const axisMax =
                typeof m.maxScore === "number" && isFinite(m.maxScore) && m.maxScore > 0
                    ? m.maxScore
                    : maxScore
            const raw = typeof m.value === "number" && isFinite(m.value) ? m.value : 0
            // Normalize to percentage of axis max, clamp to [0, 100]
            const normalized = Math.max(0, Math.min(100, (raw / axisMax) * 100))
            return {
                subject: m.name,
                value: normalized,
                rawValue: raw,
                maxScore: axisMax,
                type: m.type,
            }
        })
    }, [metrics, maxScore])

    if (metrics.length === 0) {
        return (
            <div className={clsx("flex items-center justify-center", className)}>
                <Typography.Text type="secondary">No metrics available</Typography.Text>
            </div>
        )
    }

    const LABEL_OFFSET = 12 // distance outside web
    const NUDGE = 5 // small outward nudge
    const RAD = Math.PI / 180

    return (
        <div className={clsx("border border-solid border-[#EAEFF5] rounded", className)}>
            <ResponsiveContainer width="100%" height="100%">
                <RadarChart
                    cx="52%"
                    cy={chartData.length < 4 ? "62%" : "50%"}
                    outerRadius={150}
                    data={chartData}
                >
                    <PolarGrid stroke="#EAEFF5" />
                    <PolarAngleAxis
                        dataKey="subject"
                        tick={(props: any) => {
                            const {cx, cy, radius, payload, index} = props
                            const label = (payload?.value ?? "") as string

                            const angle = Number(payload?.coordinate ?? 0)
                            const r = (radius ?? 0) + LABEL_OFFSET

                            const x = cx + r * Math.cos(-angle * RAD)
                            const y = cy + r * Math.sin(-angle * RAD)

                            const cos = Math.cos(-angle * RAD)
                            const sin = Math.sin(-angle * RAD)

                            const textAnchor =
                                Math.abs(cos) < 0.1 ? "middle" : cos > 0 ? "start" : "end"

                            const nudgeX = cos * NUDGE
                            const nudgeY = sin * NUDGE

                            // simple 2-line clamp to avoid spilling into chart
                            const clampLines = (s: string, max = 18) => {
                                const parts = s.includes(" - ") ? s.split(" - ") : [s]
                                if (parts.length >= 2) return parts.slice(0, 2)
                                const words = s.split(/\s+/)
                                let line1 = ""
                                let line2 = ""
                                for (const w of words) {
                                    if ((line1 + " " + w).trim().length <= max)
                                        line1 = (line1 + " " + w).trim()
                                    else if ((line2 + " " + w).trim().length <= max)
                                        line2 = (line2 + " " + w).trim()
                                    else {
                                        line2 = (line2 || w).slice(0, max - 1) + "…"
                                        break
                                    }
                                }
                                return line2 ? [line1, line2] : [line1]
                            }

                            const lines = clampLines(label, 18)

                            return (
                                <g
                                    transform={`translate(${x + nudgeX},${y + nudgeY})`}
                                    pointerEvents="none"
                                >
                                    <text
                                        textAnchor={textAnchor}
                                        dominantBaseline="middle"
                                        fill="#4B5563"
                                        fontSize={10}
                                        style={{userSelect: "none"}}
                                    >
                                        {lines.map((ln, i) => (
                                            <tspan key={i} x={0} dy={i === 0 ? 0 : 12}>
                                                {ln}
                                            </tspan>
                                        ))}
                                    </text>
                                </g>
                            )
                        }}
                    />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} axisLine={false} tick={false} />
                    <Tooltip
                        formatter={(val: any, _name: any, payload: any) => {
                            try {
                                const d = payload?.payload as MetricData | undefined
                                if (!d) return [val, "Score"]
                                if (d.type == "binary") {
                                    // Show raw value with axis max and percentage
                                    const pct =
                                        typeof d.value === "number" ? d.value.toFixed(2) : val
                                    return [`${pct}% / 100%`]
                                }
                                if (d?.subject?.includes("duration")) {
                                    return [
                                        `${formatLatency(d?.rawValue)} / ${formatLatency(d?.maxScore)}`,
                                    ]
                                }
                                if (d?.subject?.includes("costs")) {
                                    return [
                                        `${formatCurrency(d?.rawValue)} / ${formatCurrency(d?.maxScore)}`,
                                    ]
                                }

                                return [`${format3Sig(d.rawValue)} / ${format3Sig(d.maxScore)}`]
                            } catch (error) {
                                return [`${d.rawValue} / ${d.maxScore}`]
                            }
                        }}
                    />
                    <Radar
                        name="Score"
                        dataKey="value"
                        stroke="#3B82F6"
                        fill="#3B82F6"
                        fillOpacity={0.2}
                        dot={{fill: "#3B82F6", r: 4}}
                    />
                </RadarChart>
            </ResponsiveContainer>
        </div>
    )
}

export default memo(EvaluatorMetricsSpiderChart)
