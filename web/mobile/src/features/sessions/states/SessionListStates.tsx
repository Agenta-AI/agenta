// Raw one-liner states for the LITE phase (designed states come with the skin pass);
// a single file of small named exports is the sanctioned shape for this phase.

export const SessionListLoading = () => (
    <p className="text-muted-foreground grow p-6 text-center text-xs">Loading…</p>
)

export const SessionListEmpty = () => (
    <p className="text-muted-foreground grow p-6 text-center text-xs">No sessions.</p>
)

export const SessionListError = ({onRetry}: {onRetry: () => void}) => (
    <div className="flex grow flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted-foreground text-xs">Something went wrong.</p>
        <button
            type="button"
            className="border-border rounded-md border px-3 py-2 text-xs"
            onClick={onRetry}
        >
            Retry
        </button>
    </div>
)
