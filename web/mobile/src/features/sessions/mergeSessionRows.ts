interface SessionLike {
    id?: string | null
    session_id?: string | null
    archived_at?: string | null
}

/** A session's stable identity across the two queries; `id` is the paging cursor key. */
const identity = (session: SessionLike): string => session.session_id || session.id || ""

/**
 * Merge the polled head (newest page) into the paged rows.
 *
 * Head wins on both presence and ORDER: a session that just became active is returned at its new
 * position by the server, and would otherwise render twice — once fresh at the top, once stale
 * from the page it was in when that page was fetched. Rows without an identity are dropped; they
 * cannot be deduped and cannot be linked to.
 */
export const mergeSessionRows = <T extends SessionLike>(head: T[], paged: T[]): T[] => {
    const seen = new Set<string>()
    const merged: T[] = []
    for (const session of [...head, ...paged]) {
        const key = identity(session)
        if (!key || seen.has(key)) continue
        if (session.archived_at) continue
        seen.add(key)
        merged.push(session)
    }
    return merged
}
