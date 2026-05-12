/**
 * EvaluatorMetricBar — horizontal stacked bar for categorical/binary metric distribution.
 *
 * Renders a segmented bar + legend from BasicStats or explicit segments.
 * Handles boolean metrics with deterministic ordering (true first, false second)
 * using a split dual-bar layout matching the Figma design.
 */

import {memo} from "react"

import {Tooltip} from "antd"
import clsx from "clsx"

import type {BasicStats, FrequencyEntry} from "./metricUtils"

const SEGMENT_COLORS = ["#10b981", "#94a3b8", "#d1d5db", "#e5e7eb"]
const LABEL_COLORS = ["#0f766e", "#475467", "#475467", "#475467"]

const TRUE_SEGMENT_COLOR = "#389e0d"
const TRUE_LABEL_COLOR = "#389e0d"
const FALSE_SEGMENT_COLOR = "#bdc7d1"
const FALSE_LABEL_COLOR = "#586673"

const normalizeBoolLabel = (label: unknown) => label?.toString().toLowerCase()

const getSegmentColor = (label: unknown, index: number) => {
    const normalized = normalizeBoolLabel(label)
    if (normalized === "true") return TRUE_SEGMENT_COLOR
    if (normalized === "false") return FALSE_SEGMENT_COLOR
    return SEGMENT_COLORS[index] ?? SEGMENT_COLORS[SEGMENT_COLORS.length - 1]
}

const getLabelColor = (label: unknown, index: number) => {
    const normalized = normalizeBoolLabel(label)
    if (normalized === "true") return TRUE_LABEL_COLOR
    if (normalized === "false") return FALSE_LABEL_COLOR
    return LABEL_COLORS[index] ?? LABEL_COLORS[LABEL_COLORS.length - 1]
}

const Formatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
})

const PercentFormatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
})

export interface EvaluatorMetricBarProps {
    stats?: BasicStats
    segments?: {label: string; value: number}[]
    width?: number
    className?: string
}

const resolveSegments = (stats?: BasicStats): {label: string; value: number}[] => {
    if (!stats) return []

    const mapEntries = (entries: FrequencyEntry[]) =>
        entries
            .map((entry) => ({
                label: String(entry?.value ?? ""),
                value: Number(entry?.count ?? 0),
            }))
            .filter((entry) => Number.isFinite(entry.value) && entry.value > 0)

    if (Array.isArray(stats.rank) && stats.rank.length) {
        return mapEntries(stats.rank)
    }

    if (Array.isArray(stats.frequency) && stats.frequency.length) {
        return mapEntries(stats.frequency)
    }

    if (Array.isArray(stats.freq) && stats.freq.length) {
        return mapEntries(stats.freq)
    }

    if (typeof stats.count === "number" && typeof stats.mean === "number") {
        return [{label: "mean", value: stats.mean * stats.count}]
    }

    if (typeof stats.total === "number") {
        return [{label: "total", value: stats.total as number}]
    }

    return []
}

/** Bar track background — matches Figma `remainingcolor` token */
const TRACK_BG = "rgba(5, 23, 41, 0.06)"

/**
 * Boolean bar layout matching Figma design:
 * - Split dual bars: true (left, green) / false (right, gray)
 * - Labels above each bar
 * - Percentage on the far right
 */
const BAR_WIDTH = 88

const BooleanBar = memo(function BooleanBar({
    trueSeg,
    falseSeg,
    total,
    width,
}: {
    trueSeg: {label: string; value: number; ratio: number; percent: number}
    falseSeg: {label: string; value: number; ratio: number; percent: number}
    total: number
    width: number
}) {
    const truePercent = total > 0 ? (trueSeg.value / total) * 100 : 0

    return (
        <div className="flex items-center gap-2 w-full" style={{maxWidth: width}}>
            <div className="flex items-center" style={{width: BAR_WIDTH, flexShrink: 0}}>
                {/* True half — width proportional to true ratio */}
                <div
                    className="flex flex-col items-start justify-center min-w-0"
                    style={{width: `${trueSeg.ratio * 100}%`}}
                >
                    <span
                        className="text-[10px] leading-[18px] whitespace-nowrap"
                        style={{color: TRUE_LABEL_COLOR}}
                    >
                        true
                    </span>
                    <Tooltip title={`true: ${Formatter.format(trueSeg.percent)}%`}>
                        <div
                            className="w-full h-1 rounded-l-lg"
                            style={{
                                backgroundColor: trueSeg.value > 0 ? TRUE_SEGMENT_COLOR : TRACK_BG,
                                minWidth: trueSeg.value > 0 ? 1 : 0,
                            }}
                        />
                    </Tooltip>
                </div>
                {/* False half — takes the remaining space */}
                <div
                    className="flex flex-col items-end justify-center min-w-0"
                    style={{width: `${falseSeg.ratio * 100}%`}}
                >
                    <span
                        className="text-[10px] leading-[18px] whitespace-nowrap"
                        style={{color: FALSE_LABEL_COLOR}}
                    >
                        false
                    </span>
                    <Tooltip title={`false: ${Formatter.format(falseSeg.percent)}%`}>
                        <div
                            className="w-full h-1 rounded-r-lg"
                            style={{
                                backgroundColor:
                                    falseSeg.value > 0 ? FALSE_SEGMENT_COLOR : TRACK_BG,
                                minWidth: falseSeg.value > 0 ? 1 : 0,
                            }}
                        />
                    </Tooltip>
                </div>
            </div>
            <span className="text-xs whitespace-nowrap">
                {PercentFormatter.format(truePercent)}%
            </span>
        </div>
    )
})

const EvaluatorMetricBar = memo(
    ({stats, segments: explicitSegments, width = 150, className}: EvaluatorMetricBarProps) => {
        const segments =
            (explicitSegments && explicitSegments.length ? explicitSegments : undefined) ??
            resolveSegments(stats)
        if (!segments.length) return null

        const total = segments.reduce((sum, entry) => sum + entry.value, 0)
        if (!total || !Number.isFinite(total) || total <= 0) return null

        const normalized = segments
            .map((entry) => ({
                label: entry.label,
                value: entry.value,
                ratio: entry.value / total,
                percent: (entry.value / total) * 100,
            }))
            .sort((a, b) => b.ratio - a.ratio)

        const uniqueArr = Array.isArray(stats?.unique)
            ? stats.unique
            : Array.isArray(stats?.uniq)
              ? stats.uniq
              : []
        const booleanCandidates = new Set(
            [
                ...normalized.map((entry) => entry.label?.toString().toLowerCase()),
                ...uniqueArr.map((val) =>
                    (val as string | number | boolean)?.toString().toLowerCase(),
                ),
            ].filter(Boolean),
        )

        const isBoolean = booleanCandidates.has("true") || booleanCandidates.has("false")

        if (isBoolean) {
            const byKey = new Map(
                normalized.map((e) => [e.label?.toString().toLowerCase(), e] as const),
            )
            const trueSeg =
                byKey.get("true") ?? ({label: "true", value: 0, ratio: 0, percent: 0} as const)
            const falseSeg =
                byKey.get("false") ?? ({label: "false", value: 0, ratio: 0, percent: 0} as const)

            return (
                <div className={className}>
                    <BooleanBar trueSeg={trueSeg} falseSeg={falseSeg} total={total} width={width} />
                </div>
            )
        }

        // Non-boolean: stacked bar with legend
        const displaySegments = [...normalized]
        if (!displaySegments.length) return null

        const legendEntries = displaySegments.slice(0, Math.min(2, displaySegments.length))

        return (
            <div
                className={clsx(
                    "flex flex-col gap-1 justify-center items-center w-full",
                    className,
                )}
            >
                <div
                    className="flex w-full h-1.5 overflow-hidden rounded-full bg-gray-200"
                    style={{width: "100%", maxWidth: width}}
                >
                    {displaySegments.map((entry, index) => (
                        <Tooltip
                            key={`${entry.label}-${index}`}
                            title={`${entry.label}: ${Formatter.format(entry.percent)}%`}
                        >
                            <div
                                className={clsx("h-full transition-[width] duration-200 ease-out", {
                                    "rounded-l-full": index === 0,
                                    "rounded-r-full": index === displaySegments.length - 1,
                                })}
                                style={{
                                    width: `${entry.ratio * 100}%`,
                                    backgroundColor: getSegmentColor(entry.label, index),
                                }}
                            />
                        </Tooltip>
                    ))}
                </div>
                <div
                    className="flex w-full items-center justify-between gap-1 gap-y-1 text-[11px] leading-tight text-gray-600"
                    style={{width: "100%", maxWidth: width}}
                >
                    {legendEntries.map((entry, index) => (
                        <div
                            key={`${entry.label}-legend-${index}`}
                            className="flex items-center gap-1.5"
                            style={{color: getLabelColor(entry.label, index)}}
                        >
                            <span
                                className="h-2 w-2 rounded-full"
                                style={{
                                    backgroundColor: getSegmentColor(entry.label, index),
                                }}
                            />
                            <span className="font-medium max-w-[5rem] truncate">{entry.label}</span>
                            <span className="text-[10px] text-gray-500">
                                {Formatter.format(entry.percent)}%
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        )
    },
)

export default EvaluatorMetricBar
