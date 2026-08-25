// Raw one-liner states for the LITE phase (designed states come with the skin pass).

export const ChatLoading = () => <p className="text-muted-foreground grow p-6 text-xs">Loading…</p>

/** Also covers history-unavailable — loadSessionMessages resolves null for both. */
export const ChatEmpty = () => (
    <p className="text-muted-foreground grow p-6 text-xs">
        No messages here — this session has no replayable history.
    </p>
)
