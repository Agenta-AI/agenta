import {useEffect, useMemo, useState} from "react"

import {Skeleton, Typography} from "antd"
import clsx from "clsx"
import {
    PolarAngleAxis,
    PolarGrid,
    PolarRadiusAxis,
    Radar,
    RadarChart,
    ResponsiveContainer,
} from "recharts"

interface PlaceholderProps {
    title?: string
    description?: string
    minHeight?: number
    variant?: "chart" | "list"
}

export const OverviewLoadingPlaceholder = ({
    title,
    description,
    minHeight = 240,
    variant = "list",
}: PlaceholderProps) => {
    const RadarLoadingMock = () => {
        const subjects = useMemo(
            () => ["Evaluator quality", "Latency", "Tokens", "Cost", "Stability"],
            [],
        )
        const totalFrames = 24
        // Precompute frames once to reduce per-tick math
        const frames = useMemo(() => {
            const ampMain = 9
            const ampAlt = 4 // secondary layer moves less
            const base = 50
            const baseAltBias = -5 // stronger baseline offset for alt layer to avoid overlap
            const speedAltBase = 2.0 // slightly faster base speed for alt
            const phiAltBase = Math.PI / 5 // base phase offset for alt

            const prng = (seed: number) => {
                const x = Math.sin(seed) * 10000
                return x - Math.floor(x)
            }

            const arr: {subject: string; value: number; alt: number}[][] = []
            for (let f = 0; f < totalFrames; f++) {
                const t = (f / totalFrames) * Math.PI * 2
                const frame = subjects.map((s, i) => {
                    const seed = i * 97.3
                    const phase = i * 0.9
                    const mainAmpFactor = 0.9 + 0.3 * prng(seed + 13)
                    const mainPhaseJitter = (prng(seed + 17) - 0.5) * 0.6
                    const jitterMain = 0.6 * Math.sin(3 * t + i * 2.1 + prng(seed + 19) * 10)

                    const primary = Math.max(
                        5,
                        Math.min(
                            95,
                            base +
                                ampMain * mainAmpFactor * Math.sin(t + phase + mainPhaseJitter) +
                                jitterMain,
                        ),
                    )

                    // Alternate direction per axis and slightly modulate amplitude/speed/phase for variation
                    const dir = prng(seed + 23) > 0.5 ? 1 : -1
                    const altAmp = ampAlt * (0.8 + 0.2 * prng(seed + 29))
                    const speedAlt = speedAltBase * (0.9 + 0.3 * prng(seed + 31))
                    const phiAlt = phiAltBase + (prng(seed + 37) - 0.5) * 1.2
                    const phaseAlt = i * (1.0 + 0.25 * prng(seed + 41)) + phiAlt
                    const altBiasPerAxis = baseAltBias + (prng(seed + 43) - 0.5) * 2
                    const jitterAlt = 0.4 * Math.cos(2.6 * t + i * 1.7 + prng(seed + 47) * 12)

                    const secondary = Math.max(
                        5,
                        Math.min(
                            95,
                            base +
                                altBiasPerAxis +
                                altAmp * Math.cos(speedAlt * t + dir * phaseAlt) +
                                jitterAlt,
                        ),
                    )

                    return {subject: s, value: primary, alt: secondary}
                })
                arr.push(frame)
            }
            return arr
        }, [subjects, totalFrames])

        const [idx, setIdx] = useState(0)
        useEffect(() => {
            let rafId = 0
            let mounted = true
            const speedMsPerFrame = 100
            const start = performance.now()
            const loop = () => {
                if (!mounted) return
                const elapsed = performance.now() - start
                const nextIdx = Math.floor(elapsed / speedMsPerFrame) % totalFrames
                setIdx((prev) => (prev !== nextIdx ? nextIdx : prev))
                rafId = requestAnimationFrame(loop)
            }
            rafId = requestAnimationFrame(loop)
            return () => {
                mounted = false
                cancelAnimationFrame(rafId)
            }
        }, [totalFrames])

        const data = frames[idx]
        const t = (idx / totalFrames) * Math.PI * 2
        const BASE_OPACITY = 0.12
        const PULSE_AMPLITUDE = 0.02
        const PULSE_CENTER = 0.5
        const pulse = BASE_OPACITY + PULSE_AMPLITUDE * (PULSE_CENTER + PULSE_CENTER * Math.sin(t))
        return (
            <div className="opacity-80 h-full w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="72%" data={data}>
                        <PolarGrid stroke="#EAEFF5" />
                        <PolarAngleAxis dataKey="subject" tick={false} />
                        <PolarRadiusAxis domain={[0, 100]} axisLine={false} tick={false} />
                        <Radar
                            dataKey="value"
                            stroke="#6EA8FE"
                            fill="#3B82F6"
                            fillOpacity={pulse}
                            isAnimationActive={false}
                        />
                        <Radar
                            dataKey="alt"
                            stroke="#C4B5FD"
                            fill="#A78BFA"
                            fillOpacity={0.04}
                            strokeDasharray="4 3"
                            isAnimationActive={false}
                        />
                    </RadarChart>
                </ResponsiveContainer>
            </div>
        )
    }
    const renderBody = () => {
        if (variant === "chart") {
            return (
                <div className="flex w-full flex-col items-center gap-3 px-6 py-8 text-center">
                    <div className="h-[240px] w-full max-w-[480px]">
                        <RadarLoadingMock />
                    </div>
                    {title ? (
                        <Typography.Text className="text-sm font-medium text-neutral-700">
                            {title}
                        </Typography.Text>
                    ) : null}
                    {description ? (
                        <Typography.Paragraph className="!mb-0 text-xs text-neutral-500 max-w-[320px]">
                            {description}
                        </Typography.Paragraph>
                    ) : null}
                </div>
            )
        }

        return (
            <div className="w-full max-w-[380px] px-4 py-6">
                {title ? (
                    <Typography.Text className="block text-sm font-medium text-neutral-700">
                        {title}
                    </Typography.Text>
                ) : null}
                {description ? (
                    <Typography.Paragraph className="!mb-3 text-xs text-neutral-500">
                        {description}
                    </Typography.Paragraph>
                ) : null}
                <Skeleton active paragraph={{rows: 3}} title={false} />
            </div>
        )
    }

    return (
        <div
            className={clsx(
                "flex w-full items-center justify-center rounded-lg bg-[#F8FAFC]",
                "border border-dashed border-[#E2E8F0]",
            )}
            style={{minHeight}}
        >
            {renderBody()}
        </div>
    )
}

export const OverviewEmptyPlaceholder = ({
    title,
    description,
    minHeight = 240,
}: PlaceholderProps) => (
    <div
        className={clsx(
            "flex w-full flex-col items-center justify-center gap-2 rounded-lg bg-[#F8FAFC] px-6 py-10",
            "border border-dashed border-[#E2E8F0] text-center",
        )}
        style={{minHeight}}
    >
        {title ? (
            <Typography.Text className="text-sm font-medium text-neutral-700">
                {title}
            </Typography.Text>
        ) : null}
        {description ? (
            <Typography.Paragraph className="!mb-0 text-xs text-neutral-500">
                {description}
            </Typography.Paragraph>
        ) : null}
    </div>
)
