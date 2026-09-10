/** Cached lists that carry a session NAME. `internal-reconciliation` is included though it renders
 * nowhere: the chat panel folds it into its tab cache and prefers the remote title, so an unpatched
 * refetch reverts the rename. `sessions-page` is out (it holds gates a rename cannot change). */
export const NAMED_SESSION_QUERY_KEYS = [
    "sidebar-sessions",
    "sidebar-sessions-pinned",
    "session-list",
    "internal-reconciliation",
    // One session, not a list — `/m` feeds the browser title from it.
    "session-stream",
]

/**
 * Rewrites one session's name wherever a cached list holds it.
 *
 * Four shapes carry sessions: the rail's flat `SessionStream[]`, a single query page
 * (`{sessions}`), an infinite query's `{pages}`, and one bare session. Anything else is handed
 * back untouched, so an unrecognised cache entry is left alone rather than corrupted. Returns the
 * SAME object when the session is not in it — a fresh identity would re-render every list that
 * never held it.
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
    // One session on its own, the shape `/m`'s per-session stream query caches.
    if ((data as {session_id?: string}).session_id === sessionId) return {...data, name}
    return data
}
