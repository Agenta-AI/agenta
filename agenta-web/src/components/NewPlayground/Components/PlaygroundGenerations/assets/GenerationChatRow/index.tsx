import {useCallback} from "react"

import clsx from "clsx"
import dynamic from "next/dynamic"

import GenerationOutputText from "../GenerationOutputText"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {
    findPropertyInObject,
    findVariantById,
} from "@/components/NewPlayground/hooks/usePlayground/assets/helpers"
import PromptMessageConfig from "../../../PromptMessageConfig"
import AddButton from "@/components/NewPlayground/assets/AddButton"
import RunButton from "@/components/NewPlayground/assets/RunButton"
import {getMetadataLazy} from "@/components/NewPlayground/state"
import {createMessageFromSchema} from "@/components/NewPlayground/hooks/usePlayground/assets/messageHelpers"

import type {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import type {
    ArrayMetadata,
    ObjectMetadata,
} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import type {GenerationChatRowProps} from "./types"

const GenerationResultUtils = dynamic(() => import("../GenerationResultUtils"), {ssr: false})

export const GenerationChatRowOutput = ({
    variantId,
    message,
    disabled = false,
    rowId,
    deleteMessage,
    viewAs,
    result,
    isRunning,
    isMessageDeletable,
}: GenerationChatRowProps) => {
    const {viewType} = usePlayground()
    const isComparisonView = viewType === "comparison"

    return isRunning && viewType === "single" ? (
        <div className="w-full flex flex-col gap-3">
            <GenerationOutputText
                text={"Generating response..."}
                className="w-full mt-1"
                disabled={disabled}
            />
        </div>
    ) : (
        // <div
        //     className={clsx([
        //         "w-full flex flex-col items-start gap-2 relative group/option",
        //         {
        //             "border-0 border-b border-solid border-[rgba(5,23,41,0.06)] px-4 pt-2":
        //                 isComparisonView,
        //         },
        //     ])}
        // >
        <PromptMessageConfig
            variantId={variantId as string}
            rowId={rowId}
            messageId={message?.__id}
            disabled={disabled}
            deleteMessage={deleteMessage}
            className="w-full"
            isMessageDeletable={isMessageDeletable}
            debug
        />
        //     {!!result ? (
        //         <div className={clsx([{"h-[48px] flex items-center": isComparisonView}])}>
        //             <GenerationResultUtils result={result} />
        //         </div>
        //     ) : null}
        // </div>
    )
}

const GenerationChatRow = ({
    withControls,
    historyId,
    variantId,
    messageId,
    rowId,
    viewAs,
}: GenerationChatRowProps) => {
    const {history, historyItem, messageRow, runTests, mutate, viewType} = usePlayground({
        variantId,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const variant = findVariantById(state, variantId as string)

                if (messageId) {
                    return {
                        history: [findPropertyInObject(variant, messageId)],
                    }
                } else {
                    const messageRow = (state.generationData.messages.value || []).find(
                        (inputRow) => {
                            return inputRow.__id === rowId
                        },
                    )
                    const messageHistory = messageRow.history.value
                    const historyItem = messageHistory.find((item) => item.__id === historyId)
                    return {
                        messageRow,
                        historyItem,
                        history: messageHistory
                            .map((historyItem) => {
                                return !historyItem.__runs
                                    ? historyItem
                                    : variantId && historyItem.__runs[variantId]
                                      ? {
                                            ...historyItem.__runs[variantId].message,
                                            __result: historyItem.__runs[variantId].__result,
                                            __isRunning: historyItem.__runs[variantId].__isRunning,
                                        }
                                      : undefined
                            })
                            .filter(Boolean),
                    }
                }
            },
            [variantId, messageId, rowId, historyId],
        ),
    })

    const isComparisonView = viewType === "comparison"

    const deleteMessage = useCallback((messageId: string) => {
        mutate(
            (clonedState) => {
                if (!clonedState) return clonedState

                if (!variantId) {
                    const row = clonedState.generationData.messages.value.find(
                        (v) => v.__id === rowId,
                    )
                    const isInput = row.history.value.findIndex((m) => m.__id === messageId)
                    if (isInput !== -1) {
                        row.history.value.splice(isInput, 1)
                    }
                } else if (variantId) {
                    const row = clonedState.generationData.messages.value.find(
                        (v) => v.__id === rowId,
                    )
                    const isInput = row.history.value.findIndex((m) => {
                        return m.__id === messageId
                    })
                    if (isInput !== -1) {
                        row.history.value.splice(isInput, 1)
                    } else {
                        const isRunIndex = row.history.value.findIndex((m) => {
                            return m.__runs[variantId]?.message?.__id === messageId
                        })
                        if (isRunIndex !== -1) {
                            delete row.history.value[isRunIndex].__runs[variantId]
                        }
                    }
                }
            },
            {revalidate: false},
        )
    }, [])

    const addNewMessageToRowHistory = useCallback(() => {
        mutate((clonedState) => {
            if (!clonedState) return clonedState

            const messageRow = clonedState.generationData.messages.value.find((inputRow) => {
                return inputRow.__id === rowId
            })

            if (!messageRow) return clonedState

            const _metadata = getMetadataLazy<ArrayMetadata>(messageRow.history.__metadata)

            const itemMetadata = _metadata?.itemMetadata as ObjectMetadata
            const emptyMessage = createMessageFromSchema(itemMetadata, {
                role: "user",
            })

            messageRow.history.value.push(emptyMessage)

            return clonedState
        })
    }, [mutate, rowId])

    console.log("historyItem", historyItem)

    return !historyItem ? null : (
        <>
            <div
                className={clsx([
                    "flex flex-col items-start gap-5 w-full",
                    {"!gap-0": viewType === "comparison"},
                ])}
            >
                <GenerationChatRowOutput
                    key={historyItem.__id || `${variantId}-${rowId}-generating`}
                    message={historyItem}
                    variantId={variantId}
                    deleteMessage={deleteMessage}
                    viewAs={viewAs}
                    rowId={messageRow?.__id}
                    result={historyItem?.__result}
                    isRunning={historyItem?.__isRunning}
                    disabled={!messageRow}
                />
                {/* {history.map((historyItem) => {
                    return (
                    )
                })} */}
            </div>
            {withControls ? (
                <div className={clsx(["flex items-center gap-2 mt-5", {"px-2": isComparisonView}])}>
                    <RunButton size="small" onClick={() => runTests?.()} className="flex" />
                    <AddButton size="small" label="Message" onClick={addNewMessageToRowHistory} />
                </div>
            ) : null}
        </>
    )
}

export default GenerationChatRow
