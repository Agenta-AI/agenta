import {useMemo} from "react"

import {executionItemController} from "@agenta/playground"
import type {ChatMessage, SimpleChatMessage} from "@agenta/playground"
import {
    extractAssistantDisplayValue,
    hasAssistantContent as checkHasAssistantContent,
} from "@agenta/playground/utils"
import {useAtomValue} from "jotai"

import {useExecutionCell} from "./useExecutionCell"

const hasToolCalls = (message: unknown): boolean => {
    const toolCalls = (message as {tool_calls?: unknown[]} | null | undefined)?.tool_calls
    return Array.isArray(toolCalls) && toolCalls.length > 0
}

export interface UseChatTurnParams {
    entityId: string
    turnId: string
}

/**
 * The view model of one chat turn: its run state, the assistant and tool messages, the reply
 * to show when the store has none (built from the run result, or an Error message), and
 * whether a re-run or a tool continuation is running.
 */
export function useChatTurn({entityId, turnId}: UseChatTurnParams) {
    const cell = useExecutionCell({entityId, stepId: turnId})
    const {result, currentResult, displayResult, status, errorMessage, isRunning} = cell
    const sessionId = entityId ? `sess:${entityId}` : ""
    const storeTurnId = entityId ? turnId : ""

    const assistantMessages = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.assistantsForTurn({
                    turnId: storeTurnId,
                    sessionId,
                }),
            [storeTurnId, sessionId],
        ),
    ) as ChatMessage[]
    const toolMessages = useAtomValue(
        useMemo(
            () => executionItemController.selectors.toolsForTurn({turnId: storeTurnId, sessionId}),
            [storeTurnId, sessionId],
        ),
    ) as ChatMessage[]

    const messageOverride = useMemo(
        () =>
            Array.isArray(result) && result.length > 0
                ? (executionItemController.helpers.buildAssistantMessage(
                      currentResult,
                  ) as SimpleChatMessage | null)
                : undefined,
        [result, currentResult],
    )

    const lastAssistantMessage =
        assistantMessages.length > 0
            ? (assistantMessages[assistantMessages.length - 1] as SimpleChatMessage)
            : null
    const fallbackAssistantMessage =
        !lastAssistantMessage && messageOverride ? messageOverride : null

    const fallbackErrorMessage = useMemo<SimpleChatMessage | null>(() => {
        if (lastAssistantMessage || fallbackAssistantMessage || status !== "error") return null
        return {
            id: `error-${turnId}-${entityId || "session"}`,
            role: "Error",
            content: errorMessage ?? "Error",
        }
    }, [lastAssistantMessage, fallbackAssistantMessage, status, turnId, entityId, errorMessage])

    const displayedAssistantMessage =
        lastAssistantMessage || fallbackAssistantMessage || fallbackErrorMessage

    const hasAssistantContent = useMemo(
        () =>
            checkHasAssistantContent(
                displayedAssistantMessage,
                extractAssistantDisplayValue(displayedAssistantMessage?.content, displayResult),
                toolMessages.length > 0,
            ),
        [displayedAssistantMessage, displayResult, toolMessages.length],
    )

    const fallbackHasToolCalls = hasToolCalls(fallbackAssistantMessage)
    const hasPendingToolContinuation =
        toolMessages.length > 0 && (assistantMessages.some(hasToolCalls) || fallbackHasToolCalls)
    const isToolContinuationRunning = Boolean(isRunning) && hasPendingToolContinuation
    const isRerunning = Boolean(isRunning) && hasAssistantContent && !isToolContinuationRunning

    return {
        ...cell,
        assistantMessages,
        toolMessages,
        messageOverride,
        fallbackAssistantMessage,
        fallbackErrorMessage,
        displayedAssistantMessage,
        fallbackHasToolCalls,
        hasAssistantContent,
        hasPendingToolContinuation,
        isToolContinuationRunning,
        isRerunning,
    }
}

export type ChatTurnModel = ReturnType<typeof useChatTurn>
