import {useMemo} from "react"

import dayjs from "dayjs"

import {formatTick} from "@/oss/services/tracing/lib/helpers"
import type {AgentAnalyticsBucket} from "@/oss/services/tracing/types/agentAnalytics"

// Cap on how many x-axis labels we render, so a dense window (dozens of buckets)
// stays readable.
const MAX_TICKS = 7

export interface TimeAxis {
    /** Explicit x-axis tick values (raw timestamps), one per distinct label. */
    ticks: string[]
    /** Formats a raw bucket timestamp into its short axis label. */
    tickFormatter: (value: string) => string
    /** Finer date+time label for the tooltip title (distinguishes sub-day buckets). */
    formatTooltipLabel: (value: string) => string
}

// The x-axis key is the raw bucket timestamp, so every bucket is an equal-width band.
// We place at most MAX_TICKS labels spaced evenly by BUCKET POSITION, not by distinct
// day: a window is sub-day bucketed, so days hold unequal bucket counts and spacing by
// day would push a one-bucket day (e.g. 27 Jul) right up against the next label. Even
// band spacing keeps a constant pixel gap; dropping any label that repeats the previous
// one stops the same date printing twice and covers the first and last buckets.
export const useTimeAxis = (data: AgentAnalyticsBucket[], range: string): TimeAxis =>
    useMemo(() => {
        const tickFormatter = (value: string) => formatTick(value, range)

        const ticks: string[] = []
        let lastLabel: string | null = null
        if (data.length) {
            const count = Math.min(MAX_TICKS, data.length)
            const step = count > 1 ? (data.length - 1) / (count - 1) : 0
            for (let i = 0; i < count; i++) {
                const bucket = data[Math.round(i * step)]
                const label = tickFormatter(bucket.timestamp)
                if (label !== lastLabel) {
                    ticks.push(bucket.timestamp)
                    lastLabel = label
                }
            }
        }

        const tooltipFormat = range === "24_hours" ? "MMM D, h:mm A" : "MMM D, h A"
        const formatTooltipLabel = (value: string) => dayjs(value).format(tooltipFormat)

        return {ticks, tickFormatter, formatTooltipLabel}
    }, [data, range])
