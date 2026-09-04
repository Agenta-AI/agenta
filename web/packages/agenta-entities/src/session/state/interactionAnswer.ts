import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {respondInteraction, resumeSessionContinuation, transitionInteraction} from "../api/api"

import {
    fetchSessionInteractionStatesAtom,
    sessionInteractionRowsQueryKey,
    type SessionInteractionRowStates,
} from "./interactionStatus"

/** New rows join through the stamped tool-call id; legacy rows join through token equality. */
const tokenForToolCall = (
    states: SessionInteractionRowStates,
    toolCallId: string,
): string | null => {
    for (const state of states.values()) {
        if (state.toolCallId === toolCallId) return state.token
    }
    return states.has(toolCallId) ? toolCallId : null
}

const rowForToolCall = (states: SessionInteractionRowStates, toolCallId: string) => {
    for (const state of states.values()) {
        if (state.toolCallId === toolCallId) return state
    }
    return states.get(toolCallId) ?? null
}

/**
 * The final admission check before a chat transport invokes the runner directly. `true` means a
 * saved approval continuation owns the session and was redelivered, so the caller must abort its
 * competing fresh turn. In flag-off mode the API returns false and this is a no-op.
 */
export const resumeSessionContinuationAtom = atom(
    null,
    async (get, _set, sessionId: string): Promise<boolean> => {
        const projectId = get(projectIdAtom) ?? ""
        return resumeSessionContinuation({projectId, sessionId})
    },
)

/**
 * Submit an approval through the response endpoint and preserve its failure for the card.
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
            approved: boolean
        },
    ): Promise<{durable: boolean}> => {
        const {sessionId, toolCallId, approved} = params
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
        if (!row?.id) throw new Error("This approval is no longer pending. Refresh and retry.")

        const result = await respondInteraction({
            interactionId: row.id,
            projectId,
            answer: {approved, tool_call_id: toolCallId},
            expectedExecutionId: row.turnId,
            idempotencyKey: `approval:${row.id}:${approved ? "approve" : "deny"}`,
        })
        if (!result) throw new Error("Approval could not be submitted.")
        await queryClient.invalidateQueries({queryKey: rowsQueryKey})
        return {durable: result.accepted}
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
    ): Promise<{durable: boolean; recoverable: boolean}> => {
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
        await queryClient.invalidateQueries({queryKey: rowsQueryKey})
        return {
            durable: result.accepted,
            recoverable: result.execution?.state === "recoverable",
        }
    },
)

/**
 * Best-effort by design: failures preserve today's in-band resume behavior.
 * It never blocks or rejects the client-tool resume path.
 * Callers fire it without awaiting the result.
 */
export const recordInteractionAnswerAtom = atom(
    null,
    async (
        get,
        set,
        params: {
            sessionId: string
            toolCallId: string
            resolution: Record<string, unknown>
        },
    ): Promise<void> => {
        const {sessionId, toolCallId, resolution} = params
        const projectId = get(projectIdAtom) ?? ""
        if (!projectId || !sessionId) return

        const queryClient = get(queryClientAtom)
        const rowsQueryKey = sessionInteractionRowsQueryKey(projectId, sessionId)
        try {
            let states = await set(fetchSessionInteractionStatesAtom, sessionId)
            let token = tokenForToolCall(states, toolCallId)
            if (!token) {
                // The card can be newer than the cached rows, so refetch once before giving up.
                await queryClient.invalidateQueries({queryKey: rowsQueryKey})
                states = await set(fetchSessionInteractionStatesAtom, sessionId)
                token = tokenForToolCall(states, toolCallId)
            }
            if (!token) return

            await transitionInteraction({
                sessionId,
                token,
                status: "responded",
                resolution,
                projectId,
            })

            await queryClient.invalidateQueries({queryKey: rowsQueryKey})
        } catch (err) {
            console.warn("[recordInteractionAnswerAtom] write failed:", err)
        }
    },
)
