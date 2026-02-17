import {useMemo} from "react"

import {executionItemController} from "@agenta/playground"
import type {SimpleChatMessage} from "@agenta/playground"
import {
    extractAssistantDisplayValue,
    hasAssistantContent as checkHasAssistantContent,
} from "@agenta/playground/utils"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {TurnMessageAdapter} from "@agenta/playground-ui/adapters"

import {usePlaygroundUIOptional} from "../../../../context/PlaygroundUIContext"
import {useExecutionCell} from "../../../../hooks/useExecutionCell"
import {ClickRunPlaceholder} from "../ResultPlaceholder"
import TypingIndicator from "../TypingIndicator"

interface Props {
    turnId: string
    entityId?: string
    withControls?: boolean
    className?: string
    hideUserMessage?: boolean

    messageProps?: Record<string, unknown>
    /** Render slot for controls bar (run/cancel/add message) */
    renderControlsBar?: (props: {
        isRunning: boolean
        onRun: () => void
        onCancel: () => void
        onAddMessage: () => void
    }) => React.ReactNode
}

const ChatTurnView = ({
    turnId,
    entityId,
    withControls,
    className,
    hideUserMessage = false,
    messageProps,
    renderControlsBar,
}: Props) => {
    const providers = usePlaygroundUIOptional()
    const SharedGenerationResultUtils = providers?.SharedGenerationResultUtils
    const addUserMessage = useSetAtom(executionItemController.actions.addUserMessage)

    const {
        isRunning,
        result,
        currentResult,
        traceId,
        repetitionIndex,
        repetitionProps,
        run,
        cancel,
    } = useExecutionCell({
        entityId: entityId as string,
        stepId: turnId,
    })

    const messageOverride = useMemo(() => {
        if (Array.isArray(result) && result.length > 0) {
            return executionItemController.helpers.buildAssistantMessage(currentResult)
        }
        return undefined
    }, [result, currentResult])

    const sessionId = entityId ? `sess:${entityId}` : null

    const assistantMsg = useAtomValue(
        useMemo(
            () =>
                sessionId
                    ? executionItemController.selectors.assistantForTurn({turnId, sessionId})
                    : executionItemController.selectors.assistantForTurn({
                          turnId: "",
                          sessionId: "",
                      }),
            [turnId, sessionId],
        ),
    ) as SimpleChatMessage | null

    const toolMessages = useAtomValue(
        useMemo(
            () =>
                sessionId
                    ? executionItemController.selectors.toolsForTurn({turnId, sessionId})
                    : executionItemController.selectors.toolsForTurn({turnId: "", sessionId: ""}),
            [turnId, sessionId],
        ),
    ) as SimpleChatMessage[]

    const displayAssistantValue = useMemo(
        () =>
            extractAssistantDisplayValue((messageOverride || assistantMsg)?.content, currentResult),
        [messageOverride, assistantMsg, currentResult],
    )

    const hasAssistantContent = useMemo(
        () =>
            checkHasAssistantContent(
                messageOverride || assistantMsg,
                displayAssistantValue,
                toolMessages.length > 0,
            ),
        [messageOverride, assistantMsg, displayAssistantValue, toolMessages.length],
    )
    const isRerunning = isRunning && hasAssistantContent

    return (
        <div className={clsx("flex flex-col gap-2", className)}>
            {!hideUserMessage ? (
                <TurnMessageAdapter
                    entityId={entityId as string}
                    rowId={turnId}
                    kind="user"
                    className="w-full"
                    messageOptionProps={{
                        allowFileUpload: true,
                    }}
                    messageProps={messageProps}
                />
            ) : null}
            {withControls
                ? renderControlsBar?.({
                      isRunning: Boolean(isRunning),
                      onRun: run,
                      onCancel: cancel,
                      onAddMessage: () => addUserMessage({userMessage: null}),
                  })
                : null}
            {isRunning && !hasAssistantContent ? (
                <TypingIndicator />
            ) : hasAssistantContent ? (
                <>
                    {isRerunning ? <TypingIndicator label="Re-running..." size="small" /> : null}
                    <TurnMessageAdapter
                        key={`${turnId}-assistant-${repetitionIndex}`}
                        entityId={entityId as string}
                        rowId={turnId}
                        kind="assistant"
                        className="w-full"
                        headerClassName="border-0 border-b border-solid border-[rgba(5,23,41,0.06)]"
                        footer={
                            traceId && SharedGenerationResultUtils ? (
                                <div className="w-full flex items-center justify-start mt-2 gap-2 flex-nowrap overflow-hidden">
                                    <SharedGenerationResultUtils traceId={traceId} />
                                </div>
                            ) : null
                        }
                        messageProps={messageProps}
                        messageOverride={messageOverride}
                        repetitionProps={repetitionProps}
                    />
                    {entityId
                        ? toolMessages.map((_, index) => (
                              <TurnMessageAdapter
                                  key={`${turnId}-tool-${index}`}
                                  entityId={entityId}
                                  rowId={turnId}
                                  kind="tool"
                                  toolIndex={index}
                                  className="w-full"
                                  messageProps={messageProps}
                              />
                          ))
                        : null}
                </>
            ) : (
                <ClickRunPlaceholder />
            )}
        </div>
    )
}

export default ChatTurnView
