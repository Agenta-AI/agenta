interface RowLike {
    session_id?: string | null
}

export interface PendingFilter<T> {
    rows: T[]
    /** Sessions with a pending gate that the loaded pages do not contain yet. */
    unloaded: number
}

/**
 * Narrow the list to sessions waiting on a human.
 *
 * The interactions poll is project-wide but the list is paged, so a waiting session can exist
 * beyond what has been fetched. Report that count rather than silently showing a short list —
 * "2 waiting" next to one row is a bug the user cannot explain.
 */
export const filterPendingRows = <T extends RowLike>(
    rows: T[],
    pendingBySession: Map<string, number> | undefined,
    /**
     * True while a search narrows the list. The interactions poll is project-wide, so a waiting
     * session absent from the loaded rows might simply not match the search — and no amount of
     * paging the searched query will ever produce it. Counting those as "further down" promises
     * rows that cannot arrive, so under a search there is no unloaded count to report.
     */
    searching = false,
): PendingFilter<T> => {
    if (!pendingBySession) return {rows, unloaded: 0}

    const loaded = new Set<string>()
    for (const row of rows) if (row.session_id) loaded.add(row.session_id)

    let unloaded = 0
    if (!searching) {
        for (const sessionId of pendingBySession.keys()) {
            if (!loaded.has(sessionId)) unloaded += 1
        }
    }

    return {
        rows: rows.filter(
            (row) => (row.session_id ? (pendingBySession.get(row.session_id) ?? 0) : 0) > 0,
        ),
        unloaded,
    }
}
