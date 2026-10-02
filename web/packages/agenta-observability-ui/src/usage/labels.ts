import type {UsageWindow} from "@agenta/observability/usage"

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

const isDaily = (window: UsageWindow) => window.interval >= 24 * 60

/** Axis label for one bucket. */
export const shortLabel = (window: UsageWindow, start: number) =>
    isDaily(window) ? monthDay(start) : clock(start)

/** Tooltip and drawer title for one bucket. */
export const fullLabel = (window: UsageWindow, start: number) =>
    isDaily(window)
        ? `${WEEKDAYS[new Date(start).getDay()]}, ${monthDay(start)}`
        : `${monthDay(start)}, ${clock(start)}`

/** "day", "hour" or "5 minutes": what one bucket of the window is. */
export const bucketUnit = (window: UsageWindow) =>
    isDaily(window) ? "day" : window.interval >= 60 ? "hour" : "5 minutes"

export const UNKNOWN_AGENT = "Unknown agent"
