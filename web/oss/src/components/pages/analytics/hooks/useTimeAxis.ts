import {useMemo} from "react"

import dayjs from "dayjs"

import {formatTick} from "@/oss/services/tracing/lib/helpers"
import type {AgentAnalyticsBucket} from "@/oss/services/tracing/types/agentAnalytics"

// Upper bound on x-axis labels. High enough that a week-long window labels every day,
// low enough that a long or dense window (and the wider "h:mm a" labels) never crowds.
const MAX_TICKS = 10

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

        // Distinct labels present (days on a multi-day window). Aiming for one tick per
        // distinct label up to MAX_TICKS stops a fixed budget from dropping an interior
        // day — e.g. a 7-day window has 8 day-labels, which a budget of 7 would thin.
        let distinctCount = 0
        let prevLabel: string | null = null
        for (const b of data) {
            const label = tickFormatter(b.timestamp)
            if (label !== prevLabel) {
                distinctCount++
                prevLabel = label
            }
        }

        const ticks: string[] = []
        let lastLabel: string | null = null
        if (data.length) {
            const count = Math.min(Math.max(distinctCount, 1), MAX_TICKS, data.length)
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
