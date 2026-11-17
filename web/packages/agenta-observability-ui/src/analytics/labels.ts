import {createT, formatDate, getActiveLanguage} from "@agenta/i18n"
import analyticsCatalog from "@agenta/i18n/catalogs/observabilityUi.analytics"
import {bucketEnd, type AnalyticsWindow} from "@agenta/observability/analytics"
import {getProviderDisplayName} from "@agenta/ui/select-llm-provider"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const pad = (n: number) => String(n).padStart(2, "0")

const tNow = createT(analyticsCatalog)

// English keeps its own short names, so its output never depends on the browser locale.
export const monthDay = (t: number) => {
    const d = new Date(t)
    if (getActiveLanguage() !== "en") return formatDate(d, {month: "short", day: "numeric"})
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

const weekday = (t: number) => {
    const d = new Date(t)
    if (getActiveLanguage() !== "en") return formatDate(d, {weekday: "short"})
    return WEEKDAYS[d.getDay()]
}

export const clock = (t: number) => {
    const d = new Date(t)
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const isWeekly = (window: AnalyticsWindow) => window.interval > 24 * 60
const isDaily = (window: AnalyticsWindow) => window.interval >= 24 * 60

// Across a DST change a daily start can fall at 23:00 the day before; the midpoint cannot.
const midday = (start: number) => start + 12 * 60 * 60_000

// A week's last day: the axis ends on today, and the tooltip reads as a span.
const lastDay = (window: AnalyticsWindow, start: number) =>
    monthDay(midday(bucketEnd(window, start) - 24 * 60 * 60_000))

/** Axis label for one bucket. */
export const shortLabel = (window: AnalyticsWindow, start: number) =>
    isWeekly(window)
        ? lastDay(window, start)
        : isDaily(window)
          ? monthDay(midday(start))
          : window.newest - window.oldest > 24 * 60 * 60_000
            ? `${monthDay(start)} ${clock(start)}`
            : clock(start)

/** Tooltip and drawer title for one bucket. */
export const fullLabel = (window: AnalyticsWindow, start: number) => {
    if (isWeekly(window)) return `${monthDay(midday(start))} – ${lastDay(window, start)}`
    return isDaily(window)
        ? `${weekday(midday(start))}, ${monthDay(midday(start))}`
        : `${monthDay(start)}, ${clock(start)}`
}

/** "week", "day", "hour" or "5 minutes": what one bucket of the window is. */
export const bucketUnit = (window: AnalyticsWindow) =>
    isWeekly(window)
        ? "week"
        : isDaily(window)
          ? "day"
          : window.interval >= 60
            ? "hour"
            : "5 minutes"

/** What an empty card has none of; each is a key of the analytics catalog. */
export type EmptyWhat = "cost" | "runs" | "tokens" | "failedRuns"

/** The reader's word for one `bucketUnit` value; the unit itself stays the English id. */
export const unitLabel = (unit: string): string =>
    unit === "week"
        ? tNow("observabilityUi.analytics.unitWeek")
        : unit === "day"
          ? tNow("observabilityUi.analytics.unitDay")
          : unit === "hour"
            ? tNow("observabilityUi.analytics.unitHour")
            : tNow("observabilityUi.analytics.unit5Minutes")

export const unknownAgentLabel = (): string => tNow("observabilityUi.analytics.unknownAgent")

/** How a group key reads: an agent's name, a model id, or a provider's display name. */
export const groupKeyLabel = (
    dim: "agent" | "model" | "provider",
    agentName: (id: string) => string,
): ((key: string) => string) =>
    dim === "agent" ? agentName : dim === "provider" ? getProviderDisplayName : (key) => key
