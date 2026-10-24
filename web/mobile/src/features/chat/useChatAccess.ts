import {useMemo, useRef} from "react"

import {isSessionFresh} from "@agenta/entities/session"

import {sharingCopy} from "@/lib/sharingCopy"

import {
    isNotFoundError,
    sessionAccessKnown,
    sessionReadOnlyReason,
    sessionReadOnlyText,
    type SessionReadOnly,
} from "./sessionReadOnly"
import {useSessionHeader} from "./useSessionHeader"
import {useSessionSharing} from "./useSessionSharing"

/**
 * What the chat screen may show for this session, from its sharing state.
 *
 * `blocked`: the sharing read answers 404. A chat that was readable on this screen and now is
 * not had its access taken away ("removed"); one that never was is "not_found", the same page
 * for a private and an unknown chat. A session minted here a moment ago has no row yet, so its
 * 404 means nothing.
 *
 * `readOnly`: the reader may read but not send (a Viewer, a Slack chat, an ownerless chat, an
 * owner who left, a private agent), with the texts for the composer's place and the approval
 * card. A sharing read that failed is read-only too, with the Share dialog's load-error text.
 *
 * `canSend`: every control that writes (send, approvals and their shortcut, queued messages, tool
 * answers, rewind, templates) may act. False while read-only, and while the sharing state of a
 * session that exists on the server is still loading: no notice then, the controls just wait.
 * The query re-reads every 60 s and on focus, so a revoked grant blocks the chat, and a lowered
 * role takes the controls away, within that bound.
 *
 * During a background re-read the last answer holds: the controls stay as they were until the
 * re-read answers. One that answers without send access, or fails, takes them away. The API
 * refuses a send from someone who lost access in any case; blocking on every re-read would
 * flicker the composer once a minute.
 *
 * `checkedAt`: when the sharing state was last read, answered or failed.
 */
export const useChatAccess = ({
    sessionId,
    projectId,
    routeAgentId,
    agentHidden,
}: {
    sessionId: string
    projectId: string
    routeAgentId?: string | null
    agentHidden: boolean
}) => {
    const {query, sharing, ownerName} = useSessionSharing(sessionId)
    const header = useSessionHeader(projectId, sessionId)
    const hadAccess = useRef(false)
    const notFound = isNotFoundError(query.error)
    if (sharing && !notFound) hadAccess.current = true

    let blocked: "not_found" | "removed" | null = null
    if (notFound) {
        if (hadAccess.current) blocked = "removed"
        else if (!isSessionFresh(sessionId) && !routeAgentId && header.isSuccess && !header.data)
            blocked = "not_found"
    }

    const fresh = isSessionFresh(sessionId)
    const failed = query.isError
    const known = sessionAccessKnown({fresh, loaded: Boolean(sharing), failed})
    const sharingReason = sessionReadOnlyReason({sharing: failed ? null : sharing, agentHidden})
    // A failed read says so in the composer's place; a 404 is the blocked page's, or a session
    // whose row is not readable yet, which waits like a load.
    const reason =
        sharingReason ?? (!fresh && failed && !notFound && !blocked ? "access_unknown" : null)
    const owner = ownerName || sharingCopy.ownerFallback
    const readOnly = useMemo<SessionReadOnly | null>(
        () =>
            reason
                ? {
                      reason,
                      notice: sessionReadOnlyText(reason, owner),
                      approvalNote:
                          reason === "access_unknown" ? null : sharingCopy.approvalWaiting(owner),
                  }
                : null,
        [owner, reason],
    )
    const canSend = !blocked && !readOnly && known
    // The recheck's clock: the agent's visibility is re-read on the same beat.
    const checkedAt = Math.max(query.dataUpdatedAt ?? 0, query.errorUpdatedAt ?? 0)
    return {blocked, readOnly, canSend, checkedAt}
}
