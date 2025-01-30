import {useCallback} from "react"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {GenerationComparisonChatOutputProps, GenerationComparisonChatOutputRowProps} from "./types"
import {findPropertyInObject} from "@/components/NewPlayground/hooks/usePlayground/assets/helpers"
import GenerationChatRow, {
    GenerationChatRowOutput,
} from "../../PlaygroundGenerations/assets/GenerationChatRow"
import clsx from "clsx"
import GenerationComparisonOutputHeader from "../assets/GenerationComparisonOutputHeader"
import PlaygroundComparisonGenerationInputHeader from "../assets/GenerationComparisonInputHeader/index."

// const GenerationComparisonChatOutputRow = ({
//     variantId,

//     historyItem,
// }: GenerationComparisonChatOutputRowProps) => {
//     const {mutate, messageRow, history} = usePlayground({
//         variantId,
//         registerToWebWorker: true,
//         stateSelector: useCallback(
//             (state: PlaygroundStateData) => {
//                 // const messageRow = findPropertyInObject(state.generationData.messages.value, rowId)
//                 // const messageHistory = messageRow.history.value
//                 // return {
//                 //     messageRow,
//                 //     history: messageHistory
//                 //         .map((historyItem) => {
//                 //             return !historyItem.__runs?.[variantId]
//                 //                 ? undefined
//                 //                 : historyItem.__runs?.[variantId]
//                 //                   ? {
//                 //                         ...historyItem.__runs[variantId].message,
//                 //                         __result: historyItem.__runs[variantId].__result,
//                 //                         __isRunning: historyItem.__runs[variantId].__isRunning,
//                 //                     }
//                 //                   : undefined
//                 //         })
//                 //         .filter(Boolean),
//                 // }
//             },
//             [variantId],
//         ),
//     })

//     const handleDeleteMessage = useCallback(
//         (messageId: string) => {
//             mutate((clonedState) => {
//                 if (!clonedState) return clonedState

//                 if (!variantId) {
//                     const row = clonedState.generationData.messages.value.find(
//                         (v) => v.__id === rowId,
//                     )
//                     const isInput = row.history.value.findIndex((m) => m.__id === messageId)
//                     if (isInput !== -1) {
//                         row.history.value.splice(isInput, 1)
//                     } else {
//                         const isRunIndex = row.history.value.findIndex((m) => {
//                             return m.__runs[variantId]?.message?.__id === messageId
//                         })
//                     }
//                 } else if (variantId) {
//                     const row = clonedState.generationData.messages.value.find(
//                         (v) => v.__id === rowId,
//                     )
//                     const isInput = row.history.value.findIndex((m) => {
//                         return m.__runs?.[variantId]?.message?.__id === messageId
//                     })
//                     if (isInput !== -1) {
//                         delete row.history.value[isInput].__runs[variantId]
//                     }
//                 }
//             })
//         },
//         [variantId],
//     )

//     return (
//         <div className="flex flex-col gap-0 w-full self-stretch border-0 border-r border-solid border-[rgba(5,23,41,0.06)]">
//             <GenerationChatRowOutput
//                 message={historyItem}
//                 // variantId={variantId}
//                 deleteMessage={handleDeleteMessage}
//                 rowId={messageRow?.__id}
//                 result={historyItem?.__result}
//                 isRunning={historyItem?.__isRunning}
//                 isMessageDeletable={!!messageRow}
//                 disabled={!messageRow}
//             />
//         </div>
//     )
// }

const GenerationComparisonChatOutputCell = ({
    variantId,
    historyId,
    rowId,
    variantIndex,
    historyIndex,
}: any) => {
    const {message, messageRow} = usePlayground({
        variantId,
        registerToWebWorker: true,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
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

                return {
                    message: runs,
                    messageRow,
                }
            },
            [rowId, variantId, historyId],
        ),
    })

    return (
        <>
            {variantIndex === 0 && (
                <div className="!w-[400px]">
                    {historyIndex === 0 && (
                        <PlaygroundComparisonGenerationInputHeader className="sticky top-0 z-[2]" />
                    )}

                    <GenerationChatRow
                        variantId={variantId}
                        rowId={rowId}
                        viewAs={"input"}
                        withControls
                    />
                </div>
            )}

            <div className="!w-[400px] shrink-0">
                {historyIndex === 0 && (
                    <GenerationComparisonOutputHeader
                        key={variantId}
                        variantId={variantId}
                        className="!w-[400px]"
                    />
                )}

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
        </>
    )
}

const GenerationComparisonChatOutput = ({
    className,
    rowId,
    historyId,
    historyIndex,
}: GenerationComparisonChatOutputProps) => {
    const {displayedVariants} = usePlayground()

    return (
        <div className="border border-solid border-green-500 flex">
            {(displayedVariants || []).map((variantId, variantIndex) => (
                <GenerationComparisonChatOutputCell
                    variantId={variantId}
                    historyId={historyId}
                    rowId={rowId}
                    variantIndex={variantIndex}
                    historyIndex={historyIndex}
                />
            ))}
        </div>
    )
}

export default GenerationComparisonChatOutput
