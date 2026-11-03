import {Fragment, memo, type ReactNode} from "react"

import type {SimpleChatMessage} from "@agenta/playground"

import {useChatTurn} from "../../hooks/useChatTurn"
import {RepeatNav} from "../runs/RepeatNav"
import {RunningIndicator} from "../runs/RunningIndicator"

import {ChatMessage} from "./ChatMessage"
import {GatewayToolActions} from "./GatewayToolActions"
import {NoOutputPlaceholder} from "./NoOutputPlaceholder"

export interface ChatTurnProps {
    entityId: string
    /** The session turn id (`turn-<rev>-<logical>`). */
    turnId: string
    /** Only the last turn shows the "No output yet" placeholder. */
    isLastTurn: boolean
    renderTraceFooter?: (traceId: string) => ReactNode
}

const hasToolCalls = (message: unknown): boolean => {
    const calls = (message as {tool_calls?: unknown[]} | null | undefined)?.tool_calls
    return Array.isArray(calls) && calls.length > 0
}

/**
 * One turn of the chat: the user message, then the reply area. While the turn runs with no reply
 * it shows the running line. A reply shows the assistant messages with their tool replies and
 * gateway tool buttons, the repeat pager and the trace footer. The last turn without a reply
 * shows the "No output yet" block.
 */
export const ChatTurn = memo(({entityId, turnId, isLastTurn, renderTraceFooter}: ChatTurnProps) => {
    const {
        isRunning,
        currentResult,
        traceId,
        repetitionIndex,
        repetitionProps,
        run,
        assistantMessages,
        toolMessages,
        displayedAssistantMessage,
        messageOverride,
        fallbackHasToolCalls,
        hasAssistantContent,
        isToolContinuationRunning,
        isRerunning,
    } = useChatTurn({entityId, turnId})

    // The pager sits on the last reply of the turn.
    const pager = repetitionProps ? <RepeatNav {...repetitionProps} /> : undefined

    return (
        <div className="flex flex-col gap-1.5" data-testid={`chat-turn-${turnId}`}>
            <ChatMessage entityId={entityId} rowId={turnId} kind="user" />
            {isRunning && !hasAssistantContent ? (
                <RunningIndicator />
            ) : hasAssistantContent ? (
                <>
                    {isRerunning ? <RunningIndicator label="Re-running..." /> : null}
                    {assistantMessages.length > 0 ? (
                        assistantMessages.map((assistant, index) => {
                            const isLastAssistant = index === assistantMessages.length - 1
                            return (
                                <Fragment
                                    key={`${turnId}-assistant-${assistant.id || index}-${repetitionIndex}`}
                                >
                                    <ChatMessage
                                        entityId={entityId}
                                        rowId={turnId}
                                        kind="assistant"
                                        messageOverride={assistant as SimpleChatMessage}
                                        footer={isLastAssistant ? pager : undefined}
                                    />
                                    {index === 0
                                        ? toolMessages.map((tool, toolIndex) => (
                                              <ChatMessage
                                                  key={`${turnId}-tool-${tool.id || toolIndex}`}
                                                  entityId={entityId}
                                                  rowId={turnId}
                                                  kind="tool"
                                                  toolIndex={toolIndex}
                                              />
                                          ))
                                        : null}
                                    {index === 0 && isToolContinuationRunning ? (
                                        <RunningIndicator />
                                    ) : null}
                                    {isLastAssistant &&
                                    hasToolCalls(assistant) &&
                                    !isToolContinuationRunning ? (
                                        <GatewayToolActions
                                            rowId={turnId}
                                            entityId={entityId}
                                            currentResult={currentResult}
                                            onRun={run}
                                        />
                                    ) : null}
                                </Fragment>
                            )
                        })
                    ) : (
                        <>
                            <ChatMessage
                                key={`${turnId}-assistant-${repetitionIndex}`}
                                entityId={entityId}
                                rowId={turnId}
                                kind="assistant"
                                messageOverride={displayedAssistantMessage ?? messageOverride}
                                footer={pager}
                            />
                            {fallbackHasToolCalls ? (
                                isToolContinuationRunning ? (
                                    <RunningIndicator />
                                ) : (
                                    <GatewayToolActions
                                        rowId={turnId}
                                        entityId={entityId}
                                        currentResult={currentResult}
                                        onRun={run}
                                    />
                                )
                            ) : null}
                        </>
                    )}
                    {traceId && renderTraceFooter ? (
                        <div className="px-1">{renderTraceFooter(traceId)}</div>
                    ) : null}
                </>
            ) : isLastTurn ? (
                <NoOutputPlaceholder />
            ) : null}
        </div>
    )
})
ChatTurn.displayName = "ChatTurn"
