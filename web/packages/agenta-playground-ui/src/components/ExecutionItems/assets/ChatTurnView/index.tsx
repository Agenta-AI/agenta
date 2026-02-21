import React, {useMemo} from "react"

import {runnableBridge} from "@agenta/entities/runnable"
import type {PlaygroundNode} from "@agenta/entities/runnable"
import {executionItemController, playgroundController} from "@agenta/playground"
import type {SimpleChatMessage} from "@agenta/playground"
import {
    extractAssistantDisplayValue,
    hasAssistantContent as checkHasAssistantContent,
} from "@agenta/playground/utils"
import {LoadingOutlined} from "@ant-design/icons"
import {Popover, Tag} from "antd"
import clsx from "clsx"
import {atom} from "jotai"
import {useAtomValue, useSetAtom} from "jotai"

import {TurnMessageAdapter} from "@agenta/playground-ui/adapters"

import {usePlaygroundUIOptional} from "../../../../context/PlaygroundUIContext"
import {useExecutionCell} from "../../../../hooks/useExecutionCell"
import {EvaluatorFieldGrid} from "../../../shared/EvaluatorFieldGrid"
import {extractDisplayEntries} from "../../../shared/EvaluatorFieldGrid/utils"
import {ClickRunPlaceholder} from "../ResultPlaceholder"
import TypingIndicator from "../TypingIndicator"

// ============================================================================
// HELPERS
// ============================================================================

// ============================================================================
// SUB-COMPONENT: Evaluator result popover for chat turns
// ============================================================================

const EvaluatorResultPopover = ({
    rowId,
    rootEntityId,
    node,
    nodeName,
}: {
    rowId: string
    rootEntityId: string
    node: PlaygroundNode
    nodeName: string
}) => {
    // Session key is scoped per-variant: sess:rootEntityId:nodeEntityId
    // (matches the key used by webWorkerIntegration.ts when storing results)
    const scopedEntityId = `${rootEntityId}:${node.entityId}`
    const fullResult = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.fullResult({
                    rowId,
                    entityId: scopedEntityId,
                }),
            [rowId, scopedEntityId],
        ),
    ) as {status?: string; output?: unknown; error?: {message: string} | null} | null

    const outputPorts = useAtomValue(
        useMemo(
            () => runnableBridge.forType(node.entityType).outputPorts(node.entityId),
            [node.entityType, node.entityId],
        ),
    )

    const status = fullResult?.status ?? "idle"

    // Determine compact label + color for the tag
    const {tagLabel, tagColor} = useMemo(() => {
        if (!fullResult || status === "idle" || status === "cancelled") {
            return {tagLabel: "Pending", tagColor: "default" as const}
        }
        if (status === "running" || status === "pending") {
            return {tagLabel: "Running", tagColor: "processing" as const}
        }
        if (status === "error") {
            return {tagLabel: "Error", tagColor: "error" as const}
        }

        // Success — try to extract a single summary value for the tag
        const entries = extractDisplayEntries(fullResult.output)

        if (!entries) {
            return {tagLabel: "Done", tagColor: "success" as const}
        }

        if (entries.length === 1) {
            const [, value] = entries[0]
            const label = typeof value === "boolean" ? (value ? "Pass" : "Fail") : String(value)
            return {
                tagLabel: label.length > 20 ? label.slice(0, 17) + "..." : label,
                tagColor: "success" as const,
            }
        }

        return {tagLabel: "Done", tagColor: "success" as const}
    }, [fullResult, status])

    // Build popover content
    const popoverContent = useMemo(() => {
        if (!fullResult || status === "idle" || status === "cancelled") {
            return <span className="text-[#bdc7d1] text-xs">Pending run</span>
        }
        if (status === "running" || status === "pending") {
            return <EvaluatorFieldGrid entries={null} outputPorts={outputPorts} loading />
        }
        if (status === "error") {
            const errorMsg =
                typeof fullResult.error === "object" && fullResult.error?.message
                    ? fullResult.error.message
                    : "Error"
            return (
                <span className="text-[var(--ant-color-error)] text-xs break-words">
                    {errorMsg}
                </span>
            )
        }

        const entries = extractDisplayEntries(fullResult.output)
        if (!entries) return <span className="text-xs">—</span>

        return <EvaluatorFieldGrid entries={entries} outputPorts={outputPorts} />
    }, [fullResult, status, outputPorts])

    return (
        <Popover
            content={popoverContent}
            title={nodeName}
            trigger="hover"
            mouseEnterDelay={0.2}
            overlayStyle={{maxWidth: 360}}
        >
            <Tag color={tagColor} className="!m-0 cursor-pointer text-xs">
                {status === "running" || status === "pending" ? (
                    <span className="flex items-center gap-1">
                        <LoadingOutlined style={{fontSize: 10}} spin />
                        {nodeName}
                    </span>
                ) : (
                    <span>
                        {nodeName}: {tagLabel}
                    </span>
                )}
            </Tag>
        </Popover>
    )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

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

    // Chain nodes for downstream evaluator results
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), [])) as
        | PlaygroundNode[]
        | null
    const isChain = (nodes?.length ?? 0) > 1

    const nodeNamesAtom = useMemo(
        () =>
            atom((get) => {
                if (!nodes) return {} as Record<string, string>
                const names: Record<string, string> = {}
                for (const node of nodes) {
                    const data = get(runnableBridge.dataForType(node.entityType, node.entityId))
                    if (data?.name) {
                        names[node.id] = data.name
                    }
                }
                return names
            }),
        [nodes],
    )
    const nodeNames = useAtomValue(nodeNamesAtom)

    const downstreamNodes = useMemo(() => {
        if (!isChain || !nodes) return []
        return nodes.filter((n) => n.depth > 0 && n.entityId !== entityId)
    }, [isChain, nodes, entityId])

    const hasFooterContent = (traceId && SharedGenerationResultUtils) || downstreamNodes.length > 0

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
                            hasFooterContent ? (
                                <div className="w-full flex items-center justify-start mt-2 gap-2 flex-wrap">
                                    {traceId && SharedGenerationResultUtils ? (
                                        <SharedGenerationResultUtils traceId={traceId} />
                                    ) : null}
                                    {downstreamNodes.map((node) => {
                                        const resolvedName = nodeNames[node.id]
                                        const label =
                                            resolvedName ||
                                            (node.label && !/^[0-9a-f]{8}-/.test(node.label)
                                                ? node.label
                                                : node.entityType.charAt(0).toUpperCase() +
                                                  node.entityType.slice(1))
                                        return (
                                            <EvaluatorResultPopover
                                                key={node.entityId}
                                                rowId={turnId}
                                                rootEntityId={entityId as string}
                                                node={node}
                                                nodeName={label}
                                            />
                                        )
                                    })}
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
