import {useEffect, useMemo, useRef} from "react"

import {isSessionFresh} from "@agenta/entities/session"

import {sharingCopy} from "@/lib/sharingCopy"

import {
    sessionAccessKnown,
    sessionReadOnlyReason,
    sessionReadOnlyText,
    type SessionReadOnly,
} from "./sessionReadOnly"
import {useSessionSharing} from "./useSessionSharing"

/**
 * What the chat screen may show for this session. Controls wait while the sharing state of a
 * session that exists is loading, and a revoked grant or lowered role applies within the 60 s
 * re-read; during a re-read the last answer holds.
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
    // The session row the screen already reads carries the reader's sharing state: one read,
    // re-read every 60 s and on focus (see `useSessionHeader`).
    const {query, sharing, ownerName} = useSessionSharing(sessionId, projectId)
    // The session this screen last read with access: the screen stays mounted across a
    // session switch, so "had access" belongs to one session id.
    const accessSessionRef = useRef<string | null>(null)
    // The row is not readable: a private chat, an unknown id, or one whose access was removed.
    const notFound = query.isSuccess && !query.data
    const readable = Boolean(sharing) && !notFound
    useEffect(() => {
        if (readable) accessSessionRef.current = sessionId
    }, [readable, sessionId])
    const hadAccess = accessSessionRef.current === sessionId

    let blocked: "not_found" | "removed" | null = null
    if (notFound) {
        if (hadAccess) blocked = "removed"
        else if (!isSessionFresh(sessionId) && !routeAgentId) blocked = "not_found"
    }

    const fresh = isSessionFresh(sessionId)
    const failed = query.isError
    const known = sessionAccessKnown({fresh, loaded: Boolean(sharing), failed})
    // The row read says whether the chat's agent is hidden from this reader (it polls, so an
    // agent made private while the chat is open is seen within the recheck bound). Null when
    // the row names no workflow: the agent's own revision read decides then.
    const rowAgentHidden = sharing?.agent_hidden ?? null
    const effectiveAgentHidden = agentHidden || rowAgentHidden === true
    const sharingReason = sessionReadOnlyReason({
        sharing: failed ? null : sharing,
        agentHidden: effectiveAgentHidden,
    })
    // A failed read says so in the composer's place; a session whose row is not readable yet
    // waits like a load.
    const reason = sharingReason ?? (!fresh && failed && !blocked ? "access_unknown" : null)
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
    // The row read has not answered yet. "No row" is an answer: a chat with no turns has none.
    const accessPending = !fresh && query.isPending
    // The recheck's clock: the agent's visibility is re-read on the same beat.
    const checkedAt = Math.max(query.dataUpdatedAt ?? 0, query.errorUpdatedAt ?? 0)
    return {
        blocked,
        readOnly,
        canSend,
        accessPending,
        checkedAt,
        agentHidden: effectiveAgentHidden,
        rowAgentHidden,
    }
}
