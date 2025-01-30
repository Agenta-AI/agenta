import {useCallback} from "react"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {GenerationComparisonChatOutputProps} from "./types"
import {findPropertyInObject} from "@/components/NewPlayground/hooks/usePlayground/assets/helpers"
import GenerationChatRow, {
    GenerationChatRowOutput,
} from "../../PlaygroundGenerations/assets/GenerationChatRow"
import clsx from "clsx"
import GenerationCompletionRow from "../../PlaygroundGenerations/assets/GenerationCompletionRow"
import {getMetadataLazy} from "@/components/NewPlayground/state"

const GenerationComparisonChatOutputCell = ({
    variantId,
    historyId,
    rowId,
    variantIndex,
    isFirstRow,
    isLastRow,
}: any) => {
    const {message, messageRow, inputRowIds} = usePlayground({
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
            <div className="shrink-0 sticky left-0 z-[4] bg-white border-0 border-r border-solid border-[rgba(5,23,41,0.06)]">
                {variantIndex === 0 && (
                    <div className="!w-[399.2px] shrink-0 sticky top-8 z-[2]">
                        {isFirstRow &&
                            inputRowIds.map((inputRowId) => {
                                return (
                                    <GenerationCompletionRow
                                        key={inputRowId}
                                        variantId={variantId}
                                        rowId={inputRowId}
                                        inputOnly={true}
                                    />
                                )
                            })}

                        <GenerationChatRow
                            rowId={rowId}
                            historyId={historyId}
                            viewAs={"input"}
                            withControls={isLastRow} // Only show controls (to add a message) in the last row
                        />
                    </div>
                )}
            </div>

            <div>
                <div className="!w-[399px] shrink-0 sticky top-8 z-[2]">
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
    rowId,
    historyId,
    isLastRow,
    isFirstRow,
}: GenerationComparisonChatOutputProps) => {
    const {displayedVariants} = usePlayground()

    return (
        <div
            className={clsx([
                "flex",
                {" border-0 border-b border-solid border-[rgba(5,23,41,0.06)]": !isLastRow},
            ])}
        >
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
