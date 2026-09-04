import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {respondInteraction, transitionInteraction} from "../api/api"

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
 * Submit an approval through the response endpoint and preserve its failure for the card.
 * HTTP 202 means the server durably owns continuation; HTTP 200 is the flag-off legacy path and
 * tells the caller to release the local AI SDK gate exactly as before.
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
