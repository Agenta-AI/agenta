// Raw one-liner states for the LITE phase (designed states come with the skin pass);
// a single file of small named exports is the sanctioned shape for this phase.

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
    onLoadMore,
}: {
    unloaded: number
    canLoadMore: boolean
    loading: boolean
    onLoadMore: () => void
}) => (
    <div className="flex grow flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted-foreground text-xs">
            {unloaded > 0
                ? `${unloaded} waiting session${unloaded === 1 ? "" : "s"} further down the list, not loaded yet.`
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

export const SessionListError = ({onRetry}: {onRetry: () => void}) => (
    <div className="flex grow flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted-foreground text-xs">Something went wrong.</p>
        <button
            type="button"
            className="border-border min-h-11 rounded-md border px-3 py-2 text-xs"
            onClick={onRetry}
        >
            Retry
        </button>
    </div>
)
