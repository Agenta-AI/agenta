import {useCallback, useMemo} from "react"

import {executionItemController} from "@agenta/playground"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {TurnMessageAdapter} from "@agenta/playground-ui/adapters"

import {useRunnableLoading} from "../../../hooks/useRunnableLoading"
import ChatTurnView from "../../ExecutionItems/assets/ChatTurnView"
import ExecutionRow from "../../ExecutionItems/assets/ExecutionRow"

interface GenerationComparisonChatOutputProps {
    turnId: string
    isFirstRow: boolean
}

interface GenerationComparisonChatOutputCellProps {
    entityId: string
    turnId: string
    variantIndex: number
    isFirstRow: boolean
    executionIds: string[]
    /** Render slot for last-turn footer controls */
    renderLastTurnFooter?: (props: {
        logicalId: string
        onRun: () => void
        onCancelAll: () => void
        onAddMessage: () => void
        className?: string
    }) => React.ReactNode
}

const GenerationComparisonChatOutputCell = ({
    entityId,
    turnId,
    variantIndex,
    isFirstRow,
    executionIds,
    renderLastTurnFooter,
}: GenerationComparisonChatOutputCellProps) => {
    const variableRowIds = useAtomValue(executionItemController.selectors.generationVariableRowIds)
    const isRunnableLoading = useRunnableLoading(entityId)

    const allRowIds = useAtomValue(executionItemController.selectors.generationRowIds) as string[]
    const isLastTurn = (allRowIds || [])[Math.max(0, (allRowIds || []).length - 1)] === turnId

    const addUserMessage = useSetAtom(executionItemController.actions.addUserMessage)
    const triggerTests = useSetAtom(executionItemController.actions.triggerTests)
    const cancelTests = useSetAtom(executionItemController.actions.cancelTests)
    const rerunFromTurn = useSetAtom(executionItemController.actions.rerunFromTurn)

    // In the flat model, turnId IS the user message ID
    const userMessageId = turnId

    const handleRunTurn = useCallback(() => {
        triggerTests({executionIds, step: {id: turnId}})
    }, [triggerTests, executionIds, turnId])

    const handleCancelAll = useCallback(() => {
        cancelTests({rowId: turnId, entityIds: executionIds})
    }, [cancelTests, turnId, executionIds])

    const handleAddMessage = useCallback(() => {
        addUserMessage({userMessage: null})
    }, [addUserMessage])

    const runStatusMap = useAtomValue(
        executionItemController.selectors.runStatusByRowEntity,
    ) as Record<string, {resultHash?: string | null} | undefined>
    const resultHashes = useMemo(() => {
        try {
            const hashes = (executionIds || []).map((revId: string) => {
                const entry = runStatusMap?.[`${turnId}:${revId}`]
                return entry?.resultHash as string | undefined
            })
            return hashes.filter((h): h is string => typeof h === "string" && h.length > 0)
        } catch {
            return [] as string[]
        }
    }, [runStatusMap, executionIds, turnId])

    if (isRunnableLoading) {
        return (
            <>
                <div
                    className={clsx([
                        "shrink-0 flex flex-col self-stretch sticky left-0 z-[99] bg-white border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                        {"border-r": variantIndex === 0},
                    ])}
                >
                    {variantIndex === 0 ? (
                        <div className="!w-[400px] shrink-0 sticky top-9 z-[2] p-3">
                            <div className="h-16 rounded bg-[rgba(5,23,41,0.06)] animate-pulse" />
                        </div>
                    ) : null}
                </div>
                <div
                    className={clsx([
                        "!min-w-[400px] flex-1",
                        "shrink-0 bg-white z-[1]",
                        "flex flex-col self-stretch",
                        "border-0 border-r border-b border-solid border-[rgba(5,23,41,0.06)]",
                    ])}
                >
                    <div className="!w-full shrink-0 sticky top-9 z-[1] p-3">
                        <div className="h-20 rounded bg-[rgba(5,23,41,0.06)] animate-pulse" />
                    </div>
                </div>
            </>
        )
    }

    return (
        <>
            <div
                className={clsx([
                    "shrink-0 flex flex-col self-stretch sticky left-0 z-[99] bg-white border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                    {"border-r": variantIndex === 0},
                ])}
            >
                {variantIndex === 0 && (
                    <div className="!w-[400px] shrink-0 sticky top-9 z-[2]">
                        <div>
                            {isFirstRow &&
                                variableRowIds.map((rowId) => {
                                    return (
                                        <ExecutionRow key={rowId} rowId={rowId} inputOnly={true} />
                                    )
                                })}
                        </div>

                        <div className="flex flex-col gap-2">
                            <TurnMessageAdapter
                                entityId={entityId}
                                rowId={turnId as string}
                                kind="user"
                                className="w-full"
                                handleRerun={() =>
                                    rerunFromTurn({
                                        turnId,
                                        executionIds,
                                        userMessageId,
                                    })
                                }
                                resultHashes={resultHashes}
                                messageOptionProps={{
                                    hideAddToTestset: true,
                                    allowFileUpload: true,
                                }}
                                messageProps={{
                                    className:
                                        "!p-0 [&_.agenta-editor-wrapper]:!p-3 !mt-0 [&:nth-child(1)]:!mt-0 mt-2",
                                    editorClassName: "!p-3",
                                    headerClassName:
                                        "min-h-[48px] px-3 border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                                    footerClassName: "px-2",
                                    editorType: "borderless",
                                }}
                            />
                            {isLastTurn
                                ? renderLastTurnFooter?.({
                                      logicalId: turnId,
                                      onRun: handleRunTurn,
                                      onCancelAll: handleCancelAll,
                                      onAddMessage: handleAddMessage,
                                      className: "p-3",
                                  })
                                : null}
                        </div>
                    </div>
                )}
            </div>

            <div
                className={clsx([
                    "!min-w-[400px] flex-1",
                    "shrink-0 bg-white z-[1]",
                    "flex flex-col self-stretch",
                    "border-0 border-r border-b border-solid border-[rgba(5,23,41,0.06)]",
                ])}
            >
                <div className="!w-full shrink-0 sticky top-9 z-[1]">
                    <ChatTurnView
                        turnId={turnId}
                        entityId={entityId}
                        withControls={false}
                        hideUserMessage
                        messageProps={{
                            className:
                                "!p-0 [&_.agenta-editor-wrapper]:!p-3 !mt-0 [&:nth-child(1)]:!mt-0 mt-2",
                            editorClassName: "!p-3",
                            headerClassName:
                                "min-h-[48px] border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                            footerClassName: "px-3 !m-0",
                            editorType: "borderless",
                        }}
                    />
                </div>
            </div>
        </>
    )
}

const GenerationComparisonChatOutput = ({
    turnId,
    isFirstRow,
    renderLastTurnFooter,
}: GenerationComparisonChatOutputProps & {
    renderLastTurnFooter?: GenerationComparisonChatOutputCellProps["renderLastTurnFooter"]
}) => {
    const rowItems = useAtomValue(
        useMemo(() => executionItemController.selectors.itemsByRow(turnId), [turnId]),
    )
    const executionIds = useMemo(() => rowItems.map((item) => item.executionId), [rowItems])

    return (
        <div className="flex">
            {rowItems.map((item) => (
                <GenerationComparisonChatOutputCell
                    key={item.key}
                    entityId={item.executionId}
                    turnId={turnId}
                    variantIndex={item.executionIndex}
                    isFirstRow={isFirstRow}
                    executionIds={executionIds}
                    renderLastTurnFooter={renderLastTurnFooter}
                />
            ))}
        </div>
    )
}

export default GenerationComparisonChatOutput
