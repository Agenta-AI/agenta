import type {PendingApproval} from "@agenta/chat/model"
import type {SessionInteraction, SessionStream} from "@agenta/entities/session"

/** The approvals one child session of the open chat waits on, in the order the child asked. */
export interface ChildApprovals {
    sessionId: string
    approvals: PendingApproval[]
}

const isApproval = (row: SessionInteraction): boolean =>
    row.kind === "user_approval" && typeof row.token === "string" && Boolean(row.token)

/** The server refuses a longer `session_ids` list (422). */
const MAX_SESSION_IDS_PER_QUERY = 500

/**
 * Sessions other than the open one that wait on an approval, from the project's actionable
 * interactions. Sorted, so a reorder of the same rows keeps the list query's key, and capped at
 * the server's id limit.
 */
export const otherWaitingSessionIds = (
    interactions: SessionInteraction[] | null | undefined,
    sessionId: string,
): string[] =>
    [
        ...new Set(
            (interactions ?? [])
                .filter((row) => isApproval(row) && row.session_id !== sessionId)
                .map((row) => row.session_id),
        ),
    ]
        .sort()
        .slice(0, MAX_SESSION_IDS_PER_QUERY)

/**
 * The card's view of one stored approval. The transcript keys a gate by the row's `token` (the
 * runner's gate id), so the approval id is the token; the tool and its arguments are what the
 * runner stored on the row (`data.request`). A row carries no frozen manifest, so a card here
 * has no file preview.
 */
const pendingApprovalOf = (row: SessionInteraction): PendingApproval => {
    const request = row.data?.request
    const tool = request?.tool
    return {
        approvalId: row.token as string,
        toolName: typeof tool === "string" ? tool : "",
        input: request?.args,
    }
}

/**
 * The pending approvals of each child session of the open chat. A child is a session whose
 * `calling_session` is the open one; the server only lists the sessions the reader may see.
 * One entry per child, so a second child's approval shows as its own card.
 */
export const childApprovalsOf = ({
    interactions,
    sessions,
    sessionId,
}: {
    interactions: SessionInteraction[] | null | undefined
    sessions: SessionStream[]
    sessionId: string
}): ChildApprovals[] => {
    const children = new Set(
        sessions
            .filter((row) => row.calling_session?.id === sessionId)
            .map((row) => row.session_id),
    )
    const rows = (interactions ?? [])
        .filter((row) => isApproval(row) && children.has(row.session_id))
        // The query has no order; the time the child asked does.
        .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))
    const bySession = new Map<string, PendingApproval[]>()
    for (const row of rows) {
        const approvals = bySession.get(row.session_id) ?? []
        approvals.push(pendingApprovalOf(row))
        bySession.set(row.session_id, approvals)
    }
    return [...bySession].map(([childId, approvals]) => ({sessionId: childId, approvals}))
}
