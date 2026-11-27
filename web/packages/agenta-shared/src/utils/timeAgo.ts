import {formatLocale, formatRelativeTime} from "@agenta/i18n"

/**
 * Coarse relative time for an activity stamp — "just now", "5m ago", "3d ago".
 *
 * Deliberately coarse: list rows re-render on their own cadence (a shared minute tick, a
 * refetch), so sub-minute precision would only promise a liveness the row doesn't have.
 *
 * English keeps these exact words; another language gets the same buckets from
 * `Intl.RelativeTimeFormat` ("vor 5 Min.", "5分钟前").
 */
export const timeAgo = (ts?: number): string => {
    if (!ts) return ""
    const english = formatLocale() === undefined
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
    if (s < 60) return english ? "just now" : formatRelativeTime(0, "second")
    const m = Math.round(s / 60)
    if (m < 60) return english ? `${m}m ago` : formatRelativeTime(-m, "minute")
    const h = Math.round(m / 60)
    if (h < 24) return english ? `${h}h ago` : formatRelativeTime(-h, "hour")
    const d = Math.round(h / 24)
    return english ? `${d}d ago` : formatRelativeTime(-d, "day")
}
