import React, {useCallback, useMemo} from "react"

import {executionItemController, type ChatMessage, type SimpleChatMessage} from "@agenta/playground"
import {generateId} from "@agenta/shared/utils"
import {useAtomValue, useSetAtom} from "jotai"

import {createToolCallPayloads, type ChatTurnAssistantActionsProps} from "@agenta/playground-ui"

import GatewayToolExecuteButton from "./GatewayToolExecuteButton"

function toolCallIdOf(message: ChatMessage | null | undefined): string | undefined {
    if (!message) return undefined
    const id = message.tool_call_id
    return typeof id === "string" && id.length > 0 ? id : undefined
}

interface GatewayToolAssistantActionsProps extends ChatTurnAssistantActionsProps {
    onExecuteToolCall: (params: {data: any}) => Promise<{call?: {data?: any}}>
}

const GatewayToolAssistantActions: React.FC<GatewayToolAssistantActionsProps> = ({
    rowId,
    entityId,
    currentResult,
    onRun,
    onExecuteToolCall,
}) => {
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

    const messageOverride = useMemo(
        () =>
            currentResult
                ? executionItemController.helpers.buildAssistantMessage(currentResult)
                : null,
        [currentResult],
    )

    const assistantForToolCalls = messageOverride ?? assistantMessage
    const toolPayloads = useMemo(
        () => createToolCallPayloads(assistantForToolCalls?.tool_calls),
        [assistantForToolCalls],
    )

    const handleUpdateToolResponse = useCallback(
        (callId: string | undefined, resultStr: string, toolName?: string) => {
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
                                  content: resultStr,
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
                    content: resultStr,
                    sessionId,
                    parentId: rowId,
                },
            })
        },
        [toolMessages, patchMessage, addMessage, rowId, sessionId],
    )

    if (!toolPayloads.length) return null

    return (
        <div className="px-1">
            <GatewayToolExecuteButton
                toolPayloads={toolPayloads}
                onUpdateToolResponse={handleUpdateToolResponse}
                onExecuteAndSendToChat={onRun}
                onExecuteToolCall={onExecuteToolCall}
            />
        </div>
    )
}

export default GatewayToolAssistantActions
