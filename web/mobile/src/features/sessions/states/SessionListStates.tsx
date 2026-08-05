// Raw one-liner states for the LITE phase (designed states come with the skin pass);
// a single file of small named exports is the sanctioned shape for this phase.

import Link from "next/link"

export const SessionListLoading = () => (
    <p className="text-muted-foreground grow p-6 text-center text-xs">Loading…</p>
)

export const SessionListEmpty = () => (
    <p className="text-muted-foreground grow p-6 text-center text-xs">No sessions.</p>
)

/**
 * The waiting filter matched nothing in the loaded pages. `unloaded` sessions are waiting further
 * down, so this offers the way to reach them instead of claiming there is nothing to do.
 */
export const SessionListPendingEmpty = ({
    unloaded,
    canLoadMore,
    loading,
    searching = false,
    onLoadMore,
}: {
    unloaded: number
    canLoadMore: boolean
    loading: boolean
    /** A search is narrowing the list, so "nothing waiting" is only true of the matches. */
    searching?: boolean
    onLoadMore: () => void
}) => (
    <div className="flex grow flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted-foreground text-xs">
            {unloaded > 0
                ? `${unloaded} waiting session${unloaded === 1 ? "" : "s"} further down the list, not loaded yet.`
                : searching
                  ? "No waiting sessions match this search."
                  : "Nothing waiting on you."}
        </p>
        {unloaded > 0 && canLoadMore ? (
            <button
                type="button"
                className="border-border min-h-11 rounded-md border px-3 py-2 text-xs"
                disabled={loading}
                onClick={onLoadMore}
            >
                {loading ? "Loading…" : "Load more"}
            </button>
        ) : null}
    </div>
)

/**
 * The stored context is dropped before this renders, but dropping it only helps the NEXT visit
 * to `/m`. Without a way back the user is parked on a route for a project that may be deleted
 * or no longer theirs, with the picker and the signed-out notice both unreachable. Retry stays
 * first because the common cause is a transient fetch.
 */
export const SessionListError = ({onRetry}: {onRetry: () => void}) => (
    <div className="flex grow flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted-foreground text-xs">Something went wrong.</p>
        <div className="flex items-center gap-2">
            <button
                type="button"
                className="border-border min-h-11 rounded-md border px-3 py-2 text-xs"
                onClick={onRetry}
            >
                Retry
            </button>
            <Link
                href="/?switch=1"
                className="border-border flex min-h-11 items-center rounded-md border px-3 py-2 text-xs"
            >
                Choose another project
            </Link>
        </div>
    </div>
)
