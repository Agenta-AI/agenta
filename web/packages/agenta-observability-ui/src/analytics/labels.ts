import type {AnalyticsWindow} from "@agenta/observability/analytics"
import {getProviderDisplayName} from "@agenta/ui/select-llm-provider"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const pad = (n: number) => String(n).padStart(2, "0")

export const monthDay = (t: number) => {
    const d = new Date(t)
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export const clock = (t: number) => {
    const d = new Date(t)
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const isDaily = (window: AnalyticsWindow) => window.interval >= 24 * 60

// Across a DST change a daily start can fall at 23:00 the day before; the midpoint cannot.
const midday = (start: number) => start + 12 * 60 * 60_000

/** Axis label for one bucket. */
export const shortLabel = (window: AnalyticsWindow, start: number) =>
    isDaily(window) ? monthDay(midday(start)) : clock(start)

/** Tooltip and drawer title for one bucket. */
export const fullLabel = (window: AnalyticsWindow, start: number) =>
    isDaily(window)
        ? `${WEEKDAYS[new Date(midday(start)).getDay()]}, ${monthDay(midday(start))}`
        : `${monthDay(start)}, ${clock(start)}`

/** "day", "hour" or "5 minutes": what one bucket of the window is. */
export const bucketUnit = (window: AnalyticsWindow) =>
    isDaily(window) ? "day" : window.interval >= 60 ? "hour" : "5 minutes"

export const UNKNOWN_AGENT = "Unknown agent"

/** How a group key reads: an agent's name, a model id, or a provider's display name. */
export const groupKeyLabel = (
    dim: "agent" | "model" | "provider",
    agentName: (id: string) => string,
): ((key: string) => string) =>
    dim === "agent" ? agentName : dim === "provider" ? getProviderDisplayName : (key) => key
