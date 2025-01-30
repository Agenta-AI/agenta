import {useCallback} from "react"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {GenerationComparisonChatOutputProps, GenerationComparisonChatOutputRowProps} from "./types"
import {findPropertyInObject} from "@/components/NewPlayground/hooks/usePlayground/assets/helpers"
import {GenerationChatRowOutput} from "../../PlaygroundGenerations/assets/GenerationChatRow"
import clsx from "clsx"

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

const GenerationComparisonChatOutput = ({
    className,
    rowId,
    historyId,
}: GenerationComparisonChatOutputProps) => {
    const {messages, messageRow} = usePlayground({
        registerToWebWorker: true,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const historyMessage = findPropertyInObject(state, historyId)
                console.log(historyMessage)
                const displayedVariants = state.selected
                const messageRow = findPropertyInObject(state.generationData.messages.value, rowId)
                const runs = displayedVariants
                    .map((variantId) => {
                        return !historyMessage?.__runs?.[variantId]
                            ? undefined
                            : historyMessage?.__runs?.[variantId]
                              ? {
                                    ...historyMessage.__runs[variantId].message,
                                    __result: historyMessage.__runs[variantId].__result,
                                    __isRunning: historyMessage.__runs[variantId].__isRunning,
                                }
                              : undefined
                    })
                    .filter(Boolean)
                return {messages: runs, messageRow}
            },
            [rowId],
        ),
    })

    return (
        <div className="border border-solid border-green-500 flex">
            {(messages || []).map((historyItem) => (
                <div className="!w-[400px] shrink-0">
                    <GenerationChatRowOutput
                        message={historyItem}
                        deleteMessage={() => {}}
                        rowId={messageRow?.__id}
                        result={historyItem?.__result}
                        isRunning={historyItem?.__isRunning}
                        isMessageDeletable={!!messageRow}
                        disabled={!messageRow}
                    />
                </div>
            ))}
        </div>
    )
}

export default GenerationComparisonChatOutput
