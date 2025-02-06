import {useCallback, useMemo} from "react"

import clsx from "clsx"

import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {GenerationComparisonChatOutputProps, GenerationComparisonChatOutputCellProps} from "./types"
import {findPropertyInObject} from "@/components/NewPlayground/hooks/usePlayground/assets/helpers"
import GenerationChatRow, {
    GenerationChatRowOutput,
} from "../../PlaygroundGenerations/assets/GenerationChatRow"
import GenerationCompletionRow from "../../PlaygroundGenerations/assets/GenerationCompletionRow"
import {getMetadataLazy} from "@/components/NewPlayground/state"
import GenerationOutputText from "../../PlaygroundGenerations/assets/GenerationOutputText"

const GenerationComparisonChatOutputCell = ({
    variantId,
    historyId,
    rowId,
    variantIndex,
    isFirstRow,
    isLastRow,
    isLastVariant,
}: GenerationComparisonChatOutputCellProps) => {
    const {rerunChatOutput, message, messageRow, inputRowIds, mutate} = usePlayground({
        variantId,
        registerToWebWorker: true,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const inputRows = state.generationData.inputs.value || []

                const historyMessage = findPropertyInObject(state, historyId)
                const messageRow = findPropertyInObject(state.generationData.messages.value, rowId)

                const runs = !historyMessage?.__runs?.[variantId]
                    ? undefined
                    : historyMessage?.__runs?.[variantId]
                      ? {
                            ...historyMessage.__runs[variantId].message,
                            __result: historyMessage.__runs[variantId].__result,
                            __isRunning: historyMessage.__runs[variantId].__isRunning,
                        }
                      : undefined

                const inputRowIds = (inputRows || [])
                    .filter((inputRow) => {
                        return (
                            Object.keys(getMetadataLazy(inputRow.__metadata)?.properties).length > 0
                        )
                    })
                    .map((inputRow) => inputRow.__id)

                return {
                    message: runs,
                    messageRow,
                    inputRowIds,
                }
            },
            [rowId, variantId, historyId],
        ),
    })

    const handleDeleteMessage = useCallback(
        (messageId: string) => {
            mutate((clonedState) => {
                if (!clonedState) return clonedState

                if (!variantId) {
                    const row = clonedState.generationData.messages.value.find(
                        (v) => v.__id === rowId,
                    )
                    const isInput = row.history.value.findIndex((m) => m.__id === messageId)
                    if (isInput !== -1) {
                        row.history.value.splice(isInput, 1)
                    } else {
                        const isRunIndex = row.history.value.findIndex((m) => {
                            return m.__runs[variantId]?.message?.__id === messageId
                        })
                    }
                } else if (variantId) {
                    const row = clonedState.generationData.messages.value.find(
                        (v) => v.__id === rowId,
                    )
                    const isInput = row.history.value.findIndex((m) => {
                        return m.__runs?.[variantId]?.message?.__id === messageId
                    })
                    if (isInput !== -1) {
                        delete row.history.value[isInput].__runs[variantId]
                    }
                }
            })
        },
        [variantId],
    )

    const canRerunMessage = useMemo(() => {
        return !message?.__isRunning && !!message?.__result
    }, [variantId, message])

    const rerunMessage = useCallback(
        (messageId: string) => {
            rerunChatOutput(messageId, variantId)
        },
        [variantId],
    )

    return (
        <>
            <div
                className={clsx([
                    "shrink-0 flex flex-col self-stretch sticky left-0 z-[4] bg-white border-0 border-solid border-[rgba(5,23,41,0.06)]",
                    {"border-r": variantIndex === 0},
                    {"border-b": !isLastRow},
                ])}
            >
                {variantIndex === 0 && (
                    <div className="!w-[399.2px] shrink-0 sticky top-9 z-[2]">
                        <div
                            className={clsx([
                                {
                                    "border-0 border-b border-solid border-[rgba(5,23,41,0.06)]":
                                        isFirstRow,
                                },
                            ])}
                        >
                            {isFirstRow &&
                                inputRowIds.map((inputRowId) => {
                                    return (
                                        <GenerationCompletionRow
                                            key={inputRowId}
                                            rowId={inputRowId}
                                            inputOnly={true}
                                        />
                                    )
                                })}
                        </div>

                        <div>
                            <GenerationChatRow
                                rowId={rowId}
                                historyId={historyId}
                                viewAs={"input"}
                                withControls={isLastRow} // Only show controls (to add a message) in the last row
                                isMessageDeletable={messageRow.history?.value?.length === 1}
                                messageProps={{
                                    className: "!p-0",
                                    editorClassName: "!p-3",
                                    headerClassName:
                                        "h-[48px] px-3 border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                                    footerClassName: "px-3",
                                }}
                            />
                        </div>
                    </div>
                )}
            </div>

            <div
                className={clsx([
                    "!min-w-[400px] flex-1",
                    "shrink-0",
                    "flex flex-col self-stretch",
                    "border-0 border-r border-solid border-[rgba(5,23,41,0.06)]",
                    {"border-b": !isLastRow},
                ])}
            >
                <div className="!w-full shrink-0 sticky top-9 z-[2]">
                    {!!message ? (
                        <GenerationChatRowOutput
                            message={message}
                            deleteMessage={handleDeleteMessage}
                            variantId={variantId}
                            rerunMessage={canRerunMessage ? rerunMessage : undefined}
                            rowId={messageRow?.__id}
                            resultHash={message?.__result}
                            isRunning={message?.__isRunning}
                            disabled={!messageRow}
                            messageProps={{
                                className: "!p-0",
                                editorClassName: "!p-3",
                                headerClassName:
                                    "h-[48px] px-3 border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                                footerClassName: "px-3 h-[48px] !m-0",
                            }}
                        />
                    ) : (
                        <div className="p-3">
                            <GenerationOutputText text="Click Run to generate" />
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}

const GenerationComparisonChatOutput = ({
    rowId,
    historyId,
    isLastRow,
    isFirstRow,
}: GenerationComparisonChatOutputProps) => {
    const {displayedVariants} = usePlayground()

    return (
        <div className="flex">
            {(displayedVariants || []).map((variantId, variantIndex) => (
                <GenerationComparisonChatOutputCell
                    key={`${historyId}-${variantId}`}
                    variantId={variantId}
                    historyId={historyId}
                    rowId={rowId}
                    variantIndex={variantIndex}
                    isLastRow={isLastRow}
                    isFirstRow={isFirstRow}
                    isLastVariant={variantIndex === (displayedVariants || []).length - 1}
                />
            ))}
        </div>
    )
}

export default GenerationComparisonChatOutput
