/**
 * Coarse relative time for an activity stamp — "just now", "5m ago", "3d ago".
 *
 * Deliberately coarse: list rows re-render on their own cadence (a shared minute tick, a
 * refetch), so sub-minute precision would only promise a liveness the row doesn't have.
 */
export const timeAgo = (ts?: number): string => {
    if (!ts) return ""
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
    if (s < 60) return "just now"
    const m = Math.round(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.round(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.round(h / 24)}d ago`
}
