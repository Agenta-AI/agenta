import {useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {executionItemController} from "@agenta/playground"
import {extractPromptTemplateContext, normalizeEnhancedMessages} from "@agenta/shared/utils"
import {ChatMessageList} from "@agenta/ui/chat-message"
import {HeightCollapse} from "@agenta/ui/components"
import {useAtomValue, useSetAtom} from "jotai"

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

/** Extract messages from a prompt config object (raw ag_config value) */
const extractPromptMessages = (promptConfig: unknown): unknown[] => {
    if (!promptConfig || typeof promptConfig !== "object" || Array.isArray(promptConfig)) return []
    const cfg = promptConfig as Record<string, unknown>
    const messages = cfg.messages
    if (Array.isArray(messages)) return messages
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
    // Config messages (read-only) — read configuration from the runnable bridge
    const entityConfig = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(entityId || ""), [entityId]),
    )
    const agConfig = useMemo(() => {
        const params = entityConfig as Record<string, unknown> | undefined
        return (params?.ag_config || params || {}) as Record<string, unknown>
    }, [entityConfig])

    // Extract prompt config objects from ag_config (objects with messages or llm_config)
    const promptConfigs = useMemo(() => {
        const configs: Record<string, unknown>[] = []
        for (const val of Object.values(agConfig)) {
            if (val && typeof val === "object" && !Array.isArray(val)) {
                const cfg = val as Record<string, unknown>
                if (cfg.messages || cfg.llm_config) {
                    configs.push(cfg)
                }
            }
        }
        return configs
    }, [agConfig])

    const rawConfigMessages = useMemo(
        () => promptConfigs.flatMap((cfg) => extractPromptMessages(cfg)),
        [promptConfigs],
    )
    const configMessages = useMemo(
        () => normalizeEnhancedMessages(rawConfigMessages),
        [rawConfigMessages],
    )

    const {templateFormat, tokens} = useMemo(
        () => extractPromptTemplateContext(promptConfigs),
        [promptConfigs],
    )

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
