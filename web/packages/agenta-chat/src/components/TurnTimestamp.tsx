import {nowTickAtom} from "@agenta/shared/state"
import {timeAgo} from "@agenta/shared/utils"
import {SkeletonBlock} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {parseTraceTime} from "../model/traceTime"
import {messageCreatedAtAtomFamily} from "../state"

/**
 * When a turn happened — "just now", "5m ago", "13h ago".
 *
 * The time comes from the session turn's start (`startedAt`), not from when the browser first saw the
 * message: a reload re-creates every restored turn at once, so the client-side first-seen stamp
 * would back-date the whole transcript to page-load time. That stamp is only the fallback, for a
 * turn with no session turn yet (a message you just sent). A user turn borrows the start of the turn it
 * started.
 *
 * While the rows load (`pending`), a turn with no stamp holds the slot with a placeholder rather
 * than claiming "just now", which would be plainly wrong for a day-old turn.
 *
 * Subscribes to the shared minute tick so "5m ago" does not sit frozen on an idle screen.
 */
export const TurnTimestamp = ({
    messageId,
    startedAt,
    pending = false,
}: {
    messageId: string
    /** The start time of the session turn (ISO), when known. */
    startedAt?: string | null
    /** The session's turns are still loading. */
    pending?: boolean
}) => {
    useAtomValue(nowTickAtom)
    const createdAt = useAtomValue(messageCreatedAtAtomFamily(messageId))
    const at = parseTraceTime(startedAt) ?? createdAt

    if (!at) {
        return pending ? <SkeletonBlock active className="h-4 w-16 rounded-control-sm" /> : null
    }
    return (
        <span className="whitespace-nowrap text-[12px] text-colorTextTertiary">{timeAgo(at)}</span>
    )
}
