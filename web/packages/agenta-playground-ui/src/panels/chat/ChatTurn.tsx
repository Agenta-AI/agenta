import {Fragment, memo, type ReactNode} from "react"

import type {SimpleChatMessage} from "@agenta/playground"

import {hasToolCalls, useChatTurn} from "../../hooks/useChatTurn"
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
    /** Leaves the user message out: the compare view shows it once, in its input column. */
    hideUserMessage?: boolean
    renderTraceFooter?: (traceId: string) => ReactNode
}

/**
 * One turn of the chat: the user message, then the reply area. While the turn runs with no reply
 * it shows the running line. A reply shows the assistant messages with their tool replies and
 * gateway tool buttons, the repeat pager and the trace footer. The last turn without a reply
 * shows the "No output yet" block.
 */
export const ChatTurn = memo(
    ({entityId, turnId, isLastTurn, hideUserMessage, renderTraceFooter}: ChatTurnProps) => {
        const {
            isRunning,
            result,
            currentResult,
            traceId,
            repetitionIndex,
            repetitionProps,
            run,
            assistantMessages,
            toolMessages,
            displayedAssistantMessage,
            messageOverride,
            hasAssistantContent,
            isToolContinuationRunning,
            isRerunning,
        } = useChatTurn({entityId, turnId})

        // With repeats, the selected repeat's reply comes from the run result; the store keeps one.
        const hasRepeats = Array.isArray(result) && result.length > 1
        const replies =
            hasRepeats && messageOverride
                ? [messageOverride]
                : assistantMessages.length > 0
                  ? (assistantMessages as SimpleChatMessage[])
                  : displayedAssistantMessage
                    ? [displayedAssistantMessage]
                    : []
        // The pager sits on the last reply of the turn.
        const pager = repetitionProps ? <RepeatNav {...repetitionProps} /> : undefined

        return (
            <div className="flex flex-col gap-1.5" data-testid={`chat-turn-${turnId}`}>
                {hideUserMessage ? null : (
                    <ChatMessage entityId={entityId} rowId={turnId} kind="user" />
                )}
                {isRunning && !hasAssistantContent ? (
                    <RunningIndicator />
                ) : hasAssistantContent ? (
                    <>
                        {isRerunning ? <RunningIndicator label="Re-running..." /> : null}
                        {replies.map((reply, index) => {
                            const isLastReply = index === replies.length - 1
                            return (
                                <Fragment
                                    key={`${turnId}-assistant-${reply.id || index}-${repetitionIndex}`}
                                >
                                    <ChatMessage
                                        entityId={entityId}
                                        rowId={turnId}
                                        kind="assistant"
                                        messageOverride={reply}
                                        footer={isLastReply ? pager : undefined}
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
                                    {isLastReply &&
                                    hasToolCalls(reply) &&
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
                        })}
                        {traceId && renderTraceFooter ? (
                            <div className="px-1">{renderTraceFooter(traceId)}</div>
                        ) : null}
                    </>
                ) : isLastTurn ? (
                    <NoOutputPlaceholder />
                ) : null}
            </div>
        )
    },
)
ChatTurn.displayName = "ChatTurn"
