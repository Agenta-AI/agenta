import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {respondInteraction, resumeSessionContinuation} from "../api/api"

import {
    fetchSessionInteractionStatesAtom,
    sessionInteractionRowsQueryKey,
    type SessionInteractionRowStates,
} from "./interactionStatus"

/**
 * The gate this answer belongs to is not pending any more.
 *
 * Carried as a code rather than left to the sentence, because the one caller that has to tell this
 * failure apart is in another package and would otherwise match on prose. It is not always a
 * failure: a transcript reloaded after an approved gate replays its tool output, and the second
 * submit is redundant rather than wrong.
 */
export const APPROVAL_NOT_PENDING = "approval_not_pending"

export class ApprovalNotPendingError extends Error {
    readonly code = APPROVAL_NOT_PENDING

    constructor(message = "This approval is no longer pending. Refresh and retry.") {
        super(message)
        this.name = "ApprovalNotPendingError"
    }
}

export const isApprovalNotPendingError = (error: unknown): boolean =>
    typeof error === "object" &&
    error !== null &&
    (error as {code?: unknown}).code === APPROVAL_NOT_PENDING

const rowForToolCall = (states: SessionInteractionRowStates, toolCallId: string) => {
    for (const state of states.values()) {
        if (state.toolCallId === toolCallId) return state
    }
    return states.get(toolCallId) ?? null
}

/**
 * The final admission check before a chat transport invokes the runner directly. `true` means a
 * saved approval continuation owns the session and was redelivered, so the caller must abort its
 * competing fresh turn.
 */
export const resumeSessionContinuationAtom = atom(
    null,
    async (get, _set, sessionId: string): Promise<boolean> => {
        const projectId = get(projectIdAtom) ?? ""
        return resumeSessionContinuation({projectId, sessionId})
    },
)

/**
 * Submit a gate answer through the response endpoint and preserve its failure for the card.
 * HTTP 202 means the server durably owns continuation; HTTP 200 is the flag-off server dispatcher
 * path. Both are server-owned, so callers never also release the local AI SDK gate.
 */
export const respondInteractionAnswerAtom = atom(
    null,
    async (
        get,
        set,
        params: {
            sessionId: string
            toolCallId: string
        } & ({approved: boolean} | {resolution: Record<string, unknown>}),
    ): Promise<{durable: boolean; recoverable: boolean; executionId?: string}> => {
        const {sessionId, toolCallId} = params
        const answer =
            "resolution" in params
                ? params.resolution
                : {approved: params.approved, tool_call_id: toolCallId}
        const projectId = get(projectIdAtom) ?? ""
        if (!projectId || !sessionId) throw new Error("Approval has no project or session scope.")

        const queryClient = get(queryClientAtom)
        const rowsQueryKey = sessionInteractionRowsQueryKey(projectId, sessionId)
        let states = await set(fetchSessionInteractionStatesAtom, sessionId)
        let row = rowForToolCall(states, toolCallId)
        if (!row) {
            await queryClient.invalidateQueries({queryKey: rowsQueryKey})
            states = await set(fetchSessionInteractionStatesAtom, sessionId)
            row = rowForToolCall(states, toolCallId)
        }
        if (!row?.id) throw new ApprovalNotPendingError()

        const result = await respondInteraction({
            interactionId: row.id,
            projectId,
            answer,
            expectedExecutionId: row.turnId,
            idempotencyKey:
                "resolution" in params
                    ? `client-tool:${row.id}`
                    : `approval:${row.id}:${params.approved ? "approve" : "deny"}`,
        })
        if (!result) throw new Error("Approval could not be submitted.")
        // NOT awaited. `invalidateQueries` resolves only once the active row query has REFETCHED,
        // so awaiting it put a whole round trip between the server's answer and the card closing —
        // on top of the respond call, which already waits for the runner to pick the turn up. The
        // row is settled server-side the moment `respondInteraction` returns; the refetch only
        // catches the local cache up, and every reader of a stale row is guarded (a second submit
        // carries the same idempotency key and the route answers 409).
        void queryClient.invalidateQueries({queryKey: rowsQueryKey})
        return {
            durable: result.accepted,
            recoverable: result.execution?.state === "recoverable",
            ...(result.execution?.id ? {executionId: result.execution.id} : {}),
        }
    },
)

/** Submit every approval currently shown by Approve all as one durable transaction. */
export const respondInteractionAnswersAtom = atom(
    null,
    async (
        get,
        set,
        params: {
            sessionId: string
            toolCallIds: string[]
            approved: boolean
        },
    ): Promise<{durable: boolean; recoverable: boolean; executionId?: string}> => {
        const {sessionId, toolCallIds, approved} = params
        const projectId = get(projectIdAtom) ?? ""
        if (!projectId || !sessionId) throw new Error("Approval has no project or session scope.")
        if (toolCallIds.length === 0) throw new Error("No pending approvals were selected.")

        const queryClient = get(queryClientAtom)
        const rowsQueryKey = sessionInteractionRowsQueryKey(projectId, sessionId)
        let states = await set(fetchSessionInteractionStatesAtom, sessionId)
        let rows = toolCallIds.map((toolCallId) => rowForToolCall(states, toolCallId))
        if (rows.some((row) => !row?.id)) {
            await queryClient.invalidateQueries({queryKey: rowsQueryKey})
            states = await set(fetchSessionInteractionStatesAtom, sessionId)
            rows = toolCallIds.map((toolCallId) => rowForToolCall(states, toolCallId))
        }
        if (rows.some((row) => !row?.id)) {
            throw new Error("One or more approvals are no longer pending. Refresh and retry.")
        }

        const resolvedRows = rows as NonNullable<(typeof rows)[number]>[]
        const executionIds = new Set(resolvedRows.map((row) => row.turnId).filter(Boolean))
        if (executionIds.size !== 1) {
            throw new Error("Approve all can only answer approvals from one execution.")
        }
        const decision = approved ? "approve" : "deny"
        const sortedIds = resolvedRows.map((row) => row.id as string).sort()
        const result = await respondInteraction({
            interactionId: sortedIds[0],
            projectId,
            answers: resolvedRows.map((row, index) => ({
                interactionId: row.id as string,
                answer: {approved, tool_call_id: toolCallIds[index]},
            })),
            expectedExecutionId: resolvedRows[0].turnId,
            idempotencyKey: `approval-batch:${sortedIds[0]}:${sortedIds.length}:${decision}`,
        })
        if (!result) throw new Error("Approvals could not be submitted.")
        // Not awaited — see the single-answer atom above.
        void queryClient.invalidateQueries({queryKey: rowsQueryKey})
        return {
            durable: result.accepted,
            recoverable: result.execution?.state === "recoverable",
            ...(result.execution?.id ? {executionId: result.execution.id} : {}),
        }
    },
)
