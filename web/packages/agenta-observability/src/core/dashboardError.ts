/**
 * Shown when the server gives no reason (for example a proxy's HTML error page or a network
 * failure). No range advice here: only a 504 means the range was too long, and its `detail`
 * already says so.
 */
export const DASHBOARD_ERROR_FALLBACK = "Could not load analytics. Try again."

const statusCodeOf = (error: unknown): number | undefined => {
    const status = (error as {statusCode?: unknown} | null)?.statusCode
    return typeof status === "number" ? status : undefined
}

/** The analytics query ran past the server's statement timeout; retrying the same range repeats it. */
export const isDashboardTimeout = (error: unknown): boolean => statusCodeOf(error) === 504

/**
 * TanStack `retry` for analytics queries: retry a network failure or a transient 5xx up to
 * three times. A 4xx needs a caller change and a 504 times out again, so neither retries.
 */
export const shouldRetryDashboard = (failureCount: number, error: unknown): boolean => {
    const status = statusCodeOf(error)
    if (status !== undefined && (status < 500 || status === 504)) return false
    return failureCount < 3
}

/** The server's `detail` from a failed Fern call, or the fallback. */
export const dashboardErrorMessage = (error: unknown): string => {
    const detail = (error as {body?: {detail?: unknown}} | null)?.body?.detail
    if (typeof detail === "string" && detail.trim()) return detail
    return DASHBOARD_ERROR_FALLBACK
}
