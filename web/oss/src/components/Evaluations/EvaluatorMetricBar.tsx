import {Tooltip} from "antd"
import clsx from "clsx"

import type {BasicStats} from "@/oss/lib/metricUtils"

const BASE_BAR_WIDTH = 150
const SEGMENT_COLORS = ["#10b981", "#94a3b8", "#d1d5db", "#e5e7eb"]
const LABEL_COLORS = ["#0f766e", "#475467", "#475467", "#475467"]

// Fixed semantic colors for boolean metrics
const TRUE_SEGMENT_COLOR = "#10b981" // emerald-500
const TRUE_LABEL_COLOR = "#0f766e" // teal-700
const FALSE_SEGMENT_COLOR = "#94a3b8" // slate-400
const FALSE_LABEL_COLOR = "#475467" // gray-600

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

export interface EvaluatorMetricBarProps {
    stats?: BasicStats
    segments?: {label: string; value: number}[]
    width?: number
    className?: string
}

const resolveSegments = (stats?: BasicStats): {label: string; value: number}[] => {
    if (!stats) return []

    const mapEntries = (entries: any[]) =>
        entries
            .map((entry: any) => ({
                label: String(entry?.value ?? ""),
                value: Number(entry?.count ?? entry?.frequency ?? 0),
            }))
            .filter((entry) => Number.isFinite(entry.value) && entry.value > 0)

    if (Array.isArray(stats.rank) && stats.rank.length) {
        return mapEntries(stats.rank)
    }

    if (Array.isArray(stats.frequency) && stats.frequency.length) {
        return mapEntries(stats.frequency)
    }

    if (typeof stats.count === "number" && typeof stats.mean === "number") {
        return [
            {
                label: "mean",
                value: stats.mean * stats.count,
            },
        ]
    }

    if (typeof stats.total === "number") {
        return [
            {
                label: "total",
                value: stats.total,
            },
        ]
    }

    return []
}

const EvaluatorMetricBar = ({
    stats,
    segments: explicitSegments,
    width = BASE_BAR_WIDTH,
    className,
}: EvaluatorMetricBarProps) => {
    const segments =
        (explicitSegments && explicitSegments.length ? explicitSegments : undefined) ??
        resolveSegments(stats)
    if (!segments.length) {
        return null
    }

    const total = segments.reduce((sum, entry) => sum + entry.value, 0)
    if (!total || !Number.isFinite(total) || total <= 0) {
        return null
    }

    const normalized = segments
        .map((entry) => ({
            label: entry.label,
            value: entry.value,
            ratio: entry.value / total,
            percent: (entry.value / total) * 100,
        }))
        .sort((a, b) => b.ratio - a.ratio)

    const booleanCandidates = new Set(
        [
            ...normalized.map((entry) => entry.label?.toString().toLowerCase()),
            ...((Array.isArray((stats as any)?.unique) ? (stats as any).unique : []) as any[]).map(
                (val) => val?.toString().toLowerCase(),
            ),
        ].filter(Boolean),
    )

    // Always enforce deterministic ordering for boolean categories: [true, false]
    const isBoolean = booleanCandidates.has("true") || booleanCandidates.has("false")
    const displaySegments = (() => {
        if (!isBoolean) return [...normalized]
        const byKey = new Map(
            normalized.map((e) => [e.label?.toString().toLowerCase(), e] as const),
        )
        const trueSeg =
            byKey.get("true") ?? ({label: "true", value: 0, ratio: 0, percent: 0} as const)
        const falseSeg =
            byKey.get("false") ?? ({label: "false", value: 0, ratio: 0, percent: 0} as const)
        return [trueSeg, falseSeg]
    })()

    if (!displaySegments.length) {
        return null
    }

    const legendEntries = displaySegments.slice(0, Math.min(2, displaySegments.length))

    return (
        <div className={clsx("flex flex-col gap-1 justify-center items-center w-full", className)}>
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
}

export default EvaluatorMetricBar
