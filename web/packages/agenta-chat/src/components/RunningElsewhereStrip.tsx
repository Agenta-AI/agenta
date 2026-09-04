import type {ReactNode} from "react"

import {cn} from "@agenta/ui/ui"

/**
 * "This session is running somewhere else" — shown when the backend reports a live run for the
 * session while THIS browser isn't the one streaming it (another tab, another device).
 *
 * Issue #5530: a second browser gave no sign at all that anything was happening, so a session that
 * was mid-turn looked identical to an idle one. There is no push channel to browsers today, so the
 * transcript catches up by polling the durable record log — this strip is what makes that
 * legible instead of looking frozen.
 *
 * NOT shown while this browser is the one streaming: the composer's send button is already a Stop
 * and the transcript already shows the turn working, so a second "running" banner is noise — and
 * one that mounts and unmounts around every turn shifts the layout twice per run.
 *
 * The copy stops short of promising the transcript WILL move. `is_running` says a turn took the
 * lock, not that anything is still serving it: a runner that dies mid-turn leaves the flag set
 * until its shutdown drain completes, or failing that until the orphan sweep clears it
 * (`ORPHAN_THRESHOLD_SECONDS`, 300s). Measured on a dev stack, that window runs from ~20s to a few
 * minutes. Asserting progress through it told people to keep waiting on a run that was over, so
 * the second sentence names that possibility instead. It is deliberately not a call to action:
 * only /m passes a Stop here, and the desktop has no control to point at.
 *
 * Matches the `running` dot in the session bar (`bg-colorInfo`, pulsing) so the two read as one
 * signal.
 */
export const RunningElsewhereStrip = ({
    className,
    action,
}: {
    className?: string
    /** Optional trailing control — /m offers stopping a run this device is not driving. */
    action?: ReactNode
}) => (
    <div
        className={cn(
            "mb-2 box-border flex items-center gap-2 rounded-lg border border-solid px-3 py-2",
            "border-colorBorder bg-colorFillQuaternary",
            className,
        )}
        role="status"
    >
        <span className="relative flex size-2 shrink-0">
            <span className="bg-colorInfo absolute inline-flex size-full animate-ping rounded-full opacity-60" />
            <span className="bg-colorInfo relative inline-flex size-2 rounded-full" />
        </span>
        <span className="text-colorTextSecondary text-xs">
            This session is running somewhere else — the transcript updates as the turn progresses.
            If it stays still, the run may have already ended.
        </span>
        {action ? <span className="ml-auto shrink-0">{action}</span> : null}
    </div>
)
