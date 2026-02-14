import {useMemo} from "react"

import {legacyAppRevisionMolecule} from "@agenta/entities/legacyAppRevision"
import {executionItemController} from "@agenta/playground"
import {extractPromptTemplateContext, normalizeEnhancedMessages} from "@agenta/shared/utils"
import {ChatMessageList} from "@agenta/ui/chat-message"
import {HeightCollapse} from "@agenta/ui/components"
import {atom, useAtomValue, useSetAtom} from "jotai"

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

interface PromptLike {
    messages?: {value?: unknown} | unknown
}

const extractPromptMessages = (prompt: unknown): unknown[] => {
    if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return []
    const promptRec = prompt as PromptLike
    const messages = promptRec.messages
    if (Array.isArray(messages)) return messages
    if (messages && typeof messages === "object" && "value" in messages) {
        const wrapped = (messages as {value?: unknown}).value
        return Array.isArray(wrapped) ? wrapped : []
    }
    return []
}

/** @deprecated Alias kept for backward compatibility */
export type GenerationChatProps = ChatModeProps

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
    // Config messages (read-only, single view only) - use molecule-backed prompts
    const prompts = useAtomValue(
        entityId ? legacyAppRevisionMolecule.atoms.enhancedPrompts(entityId) : atom([]),
    ) as unknown[]

    const rawConfigMessages = (prompts || []).flatMap((prompt) => extractPromptMessages(prompt))
    const configMessages = useMemo(
        () => normalizeEnhancedMessages(rawConfigMessages),
        [rawConfigMessages],
    )

    const {templateFormat, tokens} = useMemo(() => extractPromptTemplateContext(prompts), [prompts])

    return (
        <section className="flex flex-col">
            {/* Chat turns */}
            <div className="flex flex-col border-0 border-b border-solid border-[rgba(5,23,41,0.06)]">
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
                                <div className="rounded-md border border-solid border-colorBorderSecondary">
                                    <ChatMessageList
                                        messages={configMessages}
                                        onChange={noop}
                                        disabled
                                        showControls={false}
                                        allowFileUpload={false}
                                        enableTokens={tokens.length > 0}
                                        templateFormat={templateFormat}
                                        tokens={tokens}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </HeightCollapse>
                <div className="flex flex-col gap-2 px-4 pb-4">
                    {turnIds.map((turnId) => (
                        <ChatTurnView
                            key={turnId}
                            turnId={turnId}
                            entityId={entityId as string}
                            withControls
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
                className="p-3"
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
                className: "p-3",
            })}
        </>
    )
}

export default ChatMode
