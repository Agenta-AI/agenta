import {useMemo, useRef} from "react"

import {isSessionFresh} from "@agenta/entities/session"

import {sharingCopy} from "@/lib/sharingCopy"

import {
    isNotFoundError,
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
 * `readOnly`: the reader may read but not send (a Viewer, an ownerless chat, an owner who left,
 * a private agent), with the texts for the composer's place and the approval card.
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

    const reason = sessionReadOnlyReason({sharing: notFound ? null : sharing, agentHidden})
    const owner = ownerName || sharingCopy.ownerFallback
    const readOnly = useMemo<SessionReadOnly | null>(
        () =>
            reason
                ? {
                      reason,
                      notice: sessionReadOnlyText(reason, owner),
                      approvalNote: sharingCopy.approvalWaiting(owner),
                  }
                : null,
        [owner, reason],
    )
    return {blocked, readOnly}
}
