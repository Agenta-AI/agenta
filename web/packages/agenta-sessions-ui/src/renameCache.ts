/** Every cached list that renders a session NAME. `sessions-page` is left out: it holds pending
 * gates, which a rename cannot change. */
export const NAMED_SESSION_QUERY_KEYS = [
    "sidebar-sessions",
    "sidebar-sessions-pinned",
    "session-list",
]

/**
 * Rewrites one session's name wherever a cached list holds it.
 *
 * Three shapes carry sessions: the rail's flat `SessionStream[]`, a single query page
 * (`{sessions}`), and an infinite query's `{pages}`. Anything else is handed back untouched, so
 * an unrecognised cache entry is left alone rather than corrupted. Returns the SAME object when
 * the session is not in it — a fresh identity would re-render every list that never held it.
 */
export const withRenamedSession = (data: unknown, sessionId: string, name: string): unknown => {
    if (Array.isArray(data)) {
        let changed = false
        const next = data.map((row) => {
            if (!row || typeof row !== "object") return row
            if ((row as {session_id?: string}).session_id !== sessionId) return row
            changed = true
            return {...row, name}
        })
        return changed ? next : data
    }
    if (!data || typeof data !== "object") return data
    const {pages, sessions} = data as {pages?: unknown; sessions?: unknown}
    if (Array.isArray(pages)) {
        const next = pages.map((page) => withRenamedSession(page, sessionId, name))
        return next.some((page, index) => page !== pages[index]) ? {...data, pages: next} : data
    }
    if (Array.isArray(sessions)) {
        const next = withRenamedSession(sessions, sessionId, name)
        return next === sessions ? data : {...data, sessions: next}
    }
    return data
}
