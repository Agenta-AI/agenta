import {traceDataSummaryAtomFamily} from "@agenta/entities/loadable"
import {nowTickAtom} from "@agenta/shared/state"
import {timeAgo} from "@agenta/shared/utils"
import {SkeletonBlock} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {messageCreatedAtAtomFamily} from "../state"

const parseTraceTime = (value: unknown): number | undefined => {
    if (value == null) return undefined
    const ms = new Date(value as string | number).getTime()
    return Number.isFinite(ms) ? ms : undefined
}

/**
 * When a turn happened — "just now", "5m ago", "13h ago".
 *
 * The time comes from the run's TRACE, not from when the browser first saw the message: a reload
 * re-creates every restored turn at once, so the client-side first-seen stamp would back-date the
 * whole transcript to page-load time. That stamp is only the fallback, for a turn with no trace yet
 * (a user message you just sent). A user turn has no trace of its own, so it borrows the trace of
 * the turn it started, which is why `turnTraceId` is a separate prop.
 *
 * A restored turn whose trace is still loading holds the slot with a placeholder rather than
 * claiming "just now", which would be plainly wrong for a day-old turn. A settled turn whose trace
 * is gone (deleted or expired) shows nothing.
 *
 * Subscribes to the shared minute tick so "5m ago" does not sit frozen on an idle screen.
 */
export const TurnTimestamp = ({
    messageId,
    traceId,
    turnTraceId,
}: {
    messageId: string
    /** The turn's own trace. Assistant turns have one; user turns do not. */
    traceId?: string | null
    /** The trace of the turn this message belongs to — the user turn's only source of time. */
    turnTraceId?: string | null
}) => {
    useAtomValue(nowTickAtom)
    const createdAt = useAtomValue(messageCreatedAtAtomFamily(messageId))
    const summary = useAtomValue(
        traceDataSummaryAtomFamily(traceId ?? (turnTraceId || null) ?? null),
    )
    const at = parseTraceTime(summary.rootSpan?.start_time) ?? createdAt

    if (!at) {
        return summary.isPending ? (
            <SkeletonBlock active className="h-4 w-16 rounded-control-sm" />
        ) : null
    }
    return (
        <span className="whitespace-nowrap text-[12px] text-colorTextTertiary">{timeAgo(at)}</span>
    )
}
