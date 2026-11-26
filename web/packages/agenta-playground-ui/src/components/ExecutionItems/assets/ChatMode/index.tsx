import {useMemo} from "react"

import {executionItemController} from "@agenta/playground"
import {ChatMessageList} from "@agenta/ui/chat-message"
import {HeightCollapse} from "@agenta/ui/components"
import {useAtomValue, useSetAtom} from "jotai"

import {useChatConfigMessages} from "../../../../hooks/useChatConfigMessages"
import {useExecutionCell} from "../../../../hooks/useExecutionCell"
import ControlsBar from "../../../ControlsBar"
import ChatTurnView from "../ChatTurnView"
import ExecutionRow from "../ExecutionRow"

export interface ChatModeProps {
    className?: string
    entityId?: string
    viewAs?: "input" | "output"
    /** Render slot for last-turn footer controls (run/cancel/add message) */
    renderLastTurnFooter?: (props: {
        logicalId: string
        onRun: () => void
        onCancelAll: () => void
        onAddMessage: () => void
        className?: string
    }) => React.ReactNode
    /** Render slot for controls bar in chat turns */
    renderControlsBar?: (props: {
        isRunning: boolean
        onRun: () => void
        onCancel: () => void
        onAddMessage: () => void
    }) => React.ReactNode
}

const noop = () => {}

const ChatMode = ({entityId, renderLastTurnFooter, renderControlsBar}: ChatModeProps) => {
    // Completion-style variable inputs for chat use normalized input rows with a derived fallback
    const variableRowIds = useAtomValue(
        executionItemController.selectors.generationVariableRowIds,
    ) as string[]
    const isAllCollapsed = useAtomValue(executionItemController.selectors.allRowsCollapsed)
    const renderableItemsForExecution = useAtomValue(
        useMemo(
            () => executionItemController.selectors.itemsByExecutionId(entityId || ""),
            [entityId],
        ),
    )
    const turnIds = useMemo(
        () =>
            Array.from(new Set(renderableItemsForExecution.map((item) => item.rowId))) as string[],
        [renderableItemsForExecution],
    )
    // Config messages (read-only)
    const {messages: configMessages, templateFormat, tokens} = useChatConfigMessages(entityId || "")

    return (
        <section className="flex flex-col">
            {/* Chat turns */}
            <div className="flex flex-col">
                <HeightCollapse
                    open={!isAllCollapsed}
                    className={!isAllCollapsed ? "mb-2" : undefined}
                >
                    <div className="flex flex-col">
                        {!!entityId &&
                            variableRowIds.map((rowId) => (
                                <ExecutionRow
                                    key={rowId}
                                    entityId={entityId}
                                    rowId={rowId}
                                    inputOnly={true}
                                />
                            ))}
                        {configMessages.length > 0 && (
                            <div className="px-4 pb-2">
                                <div className="rounded-md border border-solid border-colorBorderSecondary mt-4">
                                    <ChatMessageList
                                        messages={configMessages}
                                        onChange={noop}
                                        disabled
                                        showControls={false}
                                        allowFileUpload={false}
                                        enableTokens
                                        templateFormat={templateFormat}
                                        tokens={tokens}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </HeightCollapse>
                <div className="flex flex-col gap-4 px-4 pt-2 pb-4">
                    {turnIds.map((turnId, index) => (
                        <ChatTurnView
                            key={turnId}
                            turnId={turnId}
                            entityId={entityId as string}
                            withControls
                            isLastTurn={index === turnIds.length - 1}
                            renderControlsBar={renderControlsBar}
                        />
                    ))}
                    {turnIds.length > 0 ? (
                        <FooterControlsSingle
                            entityId={entityId as string}
                            lastLogicalId={turnIds[turnIds.length - 1]}
                            renderLastTurnFooter={renderLastTurnFooter}
                        />
                    ) : null}
                </div>
            </div>
        </section>
    )
}

const FooterControlsSingle = ({
    entityId,
    lastLogicalId,
    renderLastTurnFooter,
}: {
    entityId: string
    lastLogicalId: string
    renderLastTurnFooter?: ChatModeProps["renderLastTurnFooter"]
}) => {
    const addUserMessage = useSetAtom(executionItemController.actions.addUserMessage)
    const {isRunning, run, cancel} = useExecutionCell({
        entityId: entityId,
        stepId: lastLogicalId,
    })

    const onAddMessage = () => addUserMessage({userMessage: null})

    if (!renderLastTurnFooter) {
        return (
            <ControlsBar
                isRunning={Boolean(isRunning)}
                onRun={run}
                onCancel={cancel}
                onAddMessage={onAddMessage}
                className="py-3"
            />
        )
    }

    return (
        <>
            {renderLastTurnFooter({
                logicalId: lastLogicalId,
                onRun: run,
                onCancelAll: cancel,
                onAddMessage,
                className: "py-3",
            })}
        </>
    )
}

export default ChatMode
