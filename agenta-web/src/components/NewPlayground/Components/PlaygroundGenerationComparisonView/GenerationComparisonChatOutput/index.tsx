import {useCallback} from "react"

import clsx from "clsx"

import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {GenerationComparisonChatOutputProps, GenerationComparisonChatOutputRowProps} from "./types"
import {findPropertyInObject} from "@/components/NewPlayground/hooks/usePlayground/assets/helpers"
import GenerationChatRow, {
    GenerationChatRowOutput,
} from "../../PlaygroundGenerations/assets/GenerationChatRow"
import GenerationComparisonOutputHeader from "../assets/GenerationComparisonOutputHeader"
import PlaygroundComparisonGenerationInputHeader from "../assets/GenerationComparisonInputHeader/index."
import GenerationCompletionRow from "../../PlaygroundGenerations/assets/GenerationCompletionRow"
import {getMetadataLazy} from "@/components/NewPlayground/state"

const GenerationComparisonChatOutputCell = ({
    variantId,
    historyId,
    rowId,
    variantIndex,
    historyIndex,
    isFirstRow,
    isLastRow,
}: any) => {
    const {message, messageRow, viewType, inputRowIds} = usePlayground({
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

    return (
        <>
            {/**
             * The first cell in the comparison view should show the input
             * and the following cells should show the output from service
             */}
            {variantIndex === 0 && (
                <div className="!w-[400px]">
                    {/**
                     * We want to show dynamic variables only in the first history
                     * row of the comparison view
                     */}
                    {isFirstRow && (
                        <>
                            <PlaygroundComparisonGenerationInputHeader className="sticky top-0 z-[2]" />
                            {inputRowIds.map((inputRowId) => {
                                return (
                                    <GenerationCompletionRow
                                        key={inputRowId}
                                        variantId={variantId}
                                        rowId={inputRowId}
                                        inputOnly={true}
                                        className={clsx([
                                            {
                                                "bg-[#f5f7fa] border-0 border-r border-solid border-[rgba(5,23,41,0.06)]":
                                                    viewType === "comparison",
                                            },
                                        ])}
                                    />
                                )
                            })}
                        </>
                    )}

                    <GenerationChatRow
                        rowId={rowId}
                        historyId={historyId}
                        viewAs={"input"}
                        withControls={isLastRow} // Only show controls (to add a message) in the last row
                    />
                </div>
            )}

            <div className="!w-[400px] shrink-0 self-stretch flex flex-col">
                {isFirstRow && (
                    <GenerationComparisonOutputHeader
                        key={variantId}
                        variantId={variantId}
                        className="!w-[400px] sticky top-0 z-[2]"
                    />
                )}

                <div
                    className={clsx([
                        "sticky top-8 z-[2]",
                        {
                            grow: message?.__isRunning && variantId,
                        },
                    ])}
                >
                    <GenerationChatRowOutput
                        message={message}
                        deleteMessage={() => {}}
                        rowId={messageRow?.__id}
                        result={message?.__result}
                        isRunning={message?.__isRunning}
                        isMessageDeletable={!!messageRow}
                        disabled={!messageRow}
                    />
                </div>
            </div>
        </>
    )
}

const GenerationComparisonChatOutput = ({
    className,
    rowId,
    historyId,
    isLastRow,
    isFirstRow,
}: GenerationComparisonChatOutputProps) => {
    const {displayedVariants} = usePlayground()

    return (
        <div className="border border-solid border-green-500 flex">
            {(displayedVariants || []).map((variantId, variantIndex) => (
                <GenerationComparisonChatOutputCell
                    key={`${historyId}-${variantId}`}
                    variantId={variantId}
                    historyId={historyId}
                    rowId={rowId}
                    variantIndex={variantIndex}
                    isLastRow={isLastRow}
                    isFirstRow={isFirstRow}
                />
            ))}
        </div>
    )
}

export default GenerationComparisonChatOutput
