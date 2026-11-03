import {useCallback, useMemo, useState} from "react"

import {executionItemController} from "@agenta/playground"
import type {ChatMessage, SimpleChatMessage} from "@agenta/playground"
import type {ToolCall} from "@agenta/shared/types"
import {generateId, isGatewayToolSlug} from "@agenta/shared/utils"
import {useAtomValue, useSetAtom} from "jotai"
import {v4 as uuidv4} from "uuid"

import {createToolCallPayloads} from "../panels/shared/ToolCallView"

export interface GatewayToolPayload {
    name?: string
    callId?: string
    json: string
}

export interface GatewayToolCallResponse {
    call?: {
        data?: {
            content?: string
            role?: string
            tool_call_id?: string
        } | null
    }
}

export type ExecuteToolCall = (params: {data: ToolCall}) => Promise<GatewayToolCallResponse>

export type GatewayToolOutcome = {ok: true} | {ok: false; error: unknown}

export interface UseGatewayToolActionsParams {
    rowId: string
    entityId: string
    /** The run result of the turn; its tool calls win over the stored assistant message. */
    currentResult?: unknown
    /** Runs the turn ("send to chat"). */
    onRun?: () => void
    /** Calls the tool on the server (`executeToolCall` from `@agenta/entities/gatewayTool`). */
    onExecuteToolCall: ExecuteToolCall
}

const toolCallIdOf = (message: ChatMessage | null | undefined): string | undefined => {
    const id = message?.tool_call_id
    return typeof id === "string" && id.length > 0 ? id : undefined
}

/** The key of the button that runs `payload`, as `executingId` holds it. */
export const gatewayToolKey = (payload: GatewayToolPayload) =>
    payload.callId || payload.name || "default"

/**
 * The gateway tool calls of a turn's last assistant message, and the action that calls one tool
 * and writes its result into the turn: into the tool message with the same call id, else the
 * first tool message when the call has no id, else a new tool message. Failures come back as
 * `{ok: false}`; the caller shows them.
 */
export function useGatewayToolActions({
    rowId,
    entityId,
    currentResult,
    onRun,
    onExecuteToolCall,
}: UseGatewayToolActionsParams) {
    const sessionId = `sess:${entityId}`
    const assistantMessage = useAtomValue(
        useMemo(
            () => executionItemController.selectors.assistantForTurn({turnId: rowId, sessionId}),
            [rowId, sessionId],
        ),
    )
    const toolMessages = useAtomValue(
        useMemo(
            () => executionItemController.selectors.toolsForTurn({turnId: rowId, sessionId}),
            [rowId, sessionId],
        ),
    ) as ChatMessage[]
    const patchMessage = useSetAtom(executionItemController.actions.patchMessage)
    const addMessage = useSetAtom(executionItemController.actions.addMessage)
    const [executingId, setExecutingId] = useState<string | null>(null)

    const payloads = useMemo<GatewayToolPayload[]>(() => {
        const fromResult = currentResult
            ? executionItemController.helpers.buildAssistantMessage(currentResult)
            : null
        const source = fromResult ?? assistantMessage
        return createToolCallPayloads(source?.tool_calls).filter((p) =>
            isGatewayToolSlug(p.name || ""),
        )
    }, [currentResult, assistantMessage])

    const writeResult = useCallback(
        (callId: string, content: string, toolName?: string) => {
            const matchIndex = callId
                ? toolMessages.findIndex((m) => toolCallIdOf(m) === callId)
                : toolMessages.length > 0
                  ? 0
                  : -1
            if (matchIndex >= 0) {
                patchMessage({
                    target: {turnId: rowId, kind: "tool", sessionId, toolIndex: matchIndex},
                    updater: (m: SimpleChatMessage | null) =>
                        m
                            ? {
                                  ...m,
                                  content,
                                  ...(toolName && !m.name ? {name: toolName} : {}),
                                  ...(callId && !m.tool_call_id ? {tool_call_id: callId} : {}),
                              }
                            : m,
                })
                return
            }
            addMessage({
                message: {
                    id: `msg-${generateId()}`,
                    role: "tool",
                    name: toolName || "tool_1",
                    ...(callId ? {tool_call_id: callId} : {}),
                    content,
                    sessionId,
                    parentId: rowId,
                },
            })
        },
        [toolMessages, patchMessage, addMessage, rowId, sessionId],
    )

    const execute = useCallback(
        async (payload: GatewayToolPayload, sendToChat: boolean): Promise<GatewayToolOutcome> => {
            const toolCallId = payload.callId || `call_${uuidv4()}`
            setExecutingId(gatewayToolKey(payload))
            try {
                const response = await onExecuteToolCall({
                    data: {
                        id: toolCallId,
                        type: "function",
                        // The raw JSON string, as the model returned it.
                        function: {name: payload.name ?? "", arguments: payload.json},
                    },
                })
                const data = response.call?.data
                writeResult(
                    toolCallId,
                    data?.content ?? JSON.stringify(data, null, 2),
                    payload.name,
                )
                if (sendToChat) onRun?.()
                return {ok: true}
            } catch (error) {
                return {ok: false, error}
            } finally {
                setExecutingId(null)
            }
        },
        [onExecuteToolCall, writeResult, onRun],
    )

    return {payloads, execute, executingId}
}
