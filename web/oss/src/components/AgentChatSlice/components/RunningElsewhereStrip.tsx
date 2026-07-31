import clsx from "clsx"

/**
 * "This session is running somewhere else" — shown when the backend reports a live run for the
 * session while THIS browser isn't the one streaming it (another tab, another device).
 *
 * Issue #5530: a second browser gave no sign at all that anything was happening, so a session that
 * was mid-turn looked identical to an idle one. There is no push channel to browsers today, so the
 * transcript catches up by polling the durable record log — this strip is what makes that
 * legible instead of looking frozen.
 *
 * Matches the `running` dot in the session bar (`bg-colorInfo`, pulsing) so the two read as one
 * signal.
 */
const RunningElsewhereStrip = ({className}: {className?: string}) => (
    <div
        className={clsx(
            "mb-2 box-border flex items-center gap-2 rounded-lg border border-solid px-3 py-2",
            "border-colorBorder bg-colorFillQuaternary",
            className,
        )}
        role="status"
    >
        <span className="relative flex size-2 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-colorInfo opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-colorInfo" />
        </span>
        <span className="text-xs text-colorTextSecondary">
            This session is running somewhere else — the transcript updates as the turn progresses.
        </span>
    </div>
)

export default RunningElsewhereStrip
