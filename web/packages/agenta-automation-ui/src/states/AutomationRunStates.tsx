import {Button, SkeletonBlock} from "@agenta/ui/ui"
import {ChatCircleDots, ClockCounterClockwise} from "@phosphor-icons/react"
import {RefreshCw, TriangleAlert} from "lucide-react"

/**
 * Designed states for the run history and the session pane beside it.
 *
 * The list skeleton mirrors the real list — a day heading over borderless rows, at the same
 * 9/10 padding — so nothing shifts when the deliveries query lands. The pane's states are
 * separate from the list's because "no runs yet" and "this run has no conversation" are
 * different sentences with different fixes.
 */

export const AutomationRunListSkeleton = ({
    groups = 2,
    rows = 3,
}: {
    groups?: number
    rows?: number
}) => (
    <div aria-hidden>
        {Array.from({length: groups}, (_, group) => (
            <div key={group} className="mb-1">
                <div className="px-2.5 pb-1 pt-3">
                    <SkeletonBlock active className="h-2.5 w-20" />
                </div>
                {Array.from({length: rows}, (_, row) => (
                    <div key={row} className="flex items-center gap-[9px] px-2.5 py-[9px]">
                        <SkeletonBlock active className="size-2 shrink-0 rounded-full" />
                        <SkeletonBlock active className="h-3.5 flex-1" />
                        <SkeletonBlock active className="h-3 w-10 shrink-0" />
                    </div>
                ))}
            </div>
        ))}
    </div>
)

/**
 * Never run.
 *
 * Not an error and not a defect: a paused automation, or one whose schedule has not come round
 * yet, is in a perfectly good state — so this says what will happen rather than what is missing.
 */
export const AutomationRunHistoryEmpty = ({filtered = false}: {filtered?: boolean}) => (
    // Centred in the column it fills, not stacked under the heading: the list's own height is
    // the space this speaks for, and a message pinned to the top of an empty page reads as a
    // row that failed to render.
    <div className="flex h-full flex-col items-center justify-center gap-2.5 px-8 py-14 text-center">
        <span className="inline-flex size-10 items-center justify-center rounded-[10px] bg-muted">
            <ClockCounterClockwise aria-hidden size={19} className="text-muted-foreground" />
        </span>
        {/* An automation that has never run and one whose runs are hidden behind a filter are
            different facts, and telling a reader "no runs yet" while a filter is on sends them
            looking for a fault in the automation. */}
        <p className="m-0 text-[14px] font-medium text-foreground">
            {filtered ? "No runs match these filters" : "No runs yet"}
        </p>
        <p className="m-0 max-w-[38ch] text-[13px] leading-snug text-muted-foreground">
            {filtered
                ? "Reset the filters to see everything this automation has done."
                : "The first time this automation runs, it shows up here with the conversation it had."}
        </p>
    </div>
)

export const AutomationRunHistoryError = ({
    message = "Could not load this automation's runs.",
    onRetry,
}: {
    message?: string
    onRetry?: () => void
}) => (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-14 text-center">
        <TriangleAlert className="size-6 text-destructive" />
        <p className="m-0 text-[14px] font-medium text-foreground">{message}</p>
        {onRetry ? (
            <Button variant="outline" size="sm" className="text-xs font-normal" onClick={onRetry}>
                <RefreshCw className="size-3" />
                Try again
            </Button>
        ) : null}
    </div>
)

/**
 * A run with no conversation to read.
 *
 * Three ordinary cases land here (see `runSessionId`): a test capture that never invoked, a
 * delivery rejected before it reached the agent, and a row written before the dispatcher
 * stamped a session. All three are finished runs, not loading ones — so this is a statement,
 * never a spinner.
 */
export const AutomationRunNoConversation = ({reason}: {reason?: string | null}) => (
    <div className="flex h-full flex-col items-center justify-center gap-2.5 px-8 py-12 text-center">
        <span className="inline-flex size-10 items-center justify-center rounded-[10px] bg-muted">
            <ChatCircleDots aria-hidden size={19} className="text-muted-foreground" />
        </span>
        <p className="m-0 text-[14px] font-medium text-foreground">No conversation for this run</p>
        <p className="m-0 max-w-[40ch] text-[13px] leading-snug text-muted-foreground">
            This run didn&apos;t get far enough to start one, so there is no transcript to read.
        </p>
        {reason ? (
            <p className="m-0 max-w-[52ch] break-words rounded-[9px] border border-solid border-destructive/40 bg-destructive/10 px-3 py-2 text-left text-[12.5px] leading-snug text-muted-foreground">
                {reason}
            </p>
        ) : null}
    </div>
)

/**
 * The run has a session, but the agent behind it cannot be resolved.
 *
 * An automation whose agent was archived or unbound still has runs, and those runs still
 * happened — so this reports the missing agent rather than claiming the run produced nothing.
 */
export const AutomationRunConversationUnavailable = () => (
    <div className="flex h-full flex-col items-center justify-center gap-2.5 px-8 py-12 text-center">
        <TriangleAlert className="size-5 text-muted-foreground" />
        <p className="m-0 text-[14px] font-medium text-foreground">
            This conversation can&apos;t be opened
        </p>
        <p className="m-0 max-w-[42ch] text-[13px] leading-snug text-muted-foreground">
            The agent that ran it is no longer available, so its transcript can&apos;t be loaded.
        </p>
    </div>
)
