import GenerationComparisonOutputHeader from "../assets/GenerationComparisonOutputHeader"
import PlaygroundVariantPropertyControl from "../../PlaygroundVariantPropertyControl"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {useCallback} from "react"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import GenerationOutputText from "../../PlaygroundGenerations/assets/GenerationOutputText"
import GenerationResultUtils from "../../PlaygroundGenerations/assets/GenerationResultUtils"
import {GenerationComparisonChatOutputProps, GenerationComparisonChatOutputRowProps} from "./types"
import clsx from "clsx"
import {findPropertyInObject} from "@/components/NewPlayground/hooks/usePlayground/assets/helpers"
import {GenerationChatRowOutput} from "../../PlaygroundGenerations/assets/GenerationChatRow"

const GenerationComparisonChatOutputRow = ({
    variantId,
    rowId,
}: GenerationComparisonChatOutputRowProps) => {
    const {mutate, messageRow, history} = usePlayground({
        variantId,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const messageRow = findPropertyInObject(state.generationData.messages.value, rowId)

                const messageHistory = messageRow.history.value

                return {
                    messageRow,
                    history: messageHistory
                        .map((historyItem) => {
                            return !historyItem.__runs
                                ? undefined
                                : {
                                      ...historyItem.__runs[variantId].message,
                                      __result: historyItem.__runs[variantId].__result,
                                      __isRunning: historyItem.__runs[variantId].__isRunning,
                                  }
                        })
                        .filter(Boolean),
                }
            },
            [rowId],
        ),
    })

    const handleDeleteMessage = useCallback((messageId) => {
        mutate((clonedState) => {
            if (!clonedState) return clonedState
            const row = findPropertyInObject(clonedState.generationData.messages.value, rowId)
        })
    }, [])

    return (
        <div className="flex flex-col w-full p-2 self-stretch">
            {history.map((historyItem) => {
                return (
                    <GenerationChatRowOutput
                        key={historyItem?.__id}
                        message={historyItem}
                        variantId={variantId}
                        deleteMessage={handleDeleteMessage}
                        rowId={messageRow?.__id}
                        result={historyItem?.__result}
                        isRunning={historyItem?.__isRunning}
                        isMessageDeletable={!!messageRow}
                        disabled={!messageRow}
                    />
                )
            })}
        </div>
    )
}

const GenerationComparisonChatOutput = ({
    variantId,
    className,
    indexName,
}: GenerationComparisonChatOutputProps) => {
    const {messageRowIds, isVariantRunning} = usePlayground({
        variantId,
        stateSelector: useCallback((state: PlaygroundStateData) => {
            const messageRows = state.generationData.messages.value || []
            const isVariantRunning = messageRows.some((messageRow) => {
                return !!messageRow.history.value.some((historyMessage) => {
                    return historyMessage.__runs?.[variantId]?.__isRunning
                })
            })

            return {
                isVariantRunning,
                messageRowIds: (messageRows || [])
                    .map((messageRow) => messageRow.__id)
                    .filter(Boolean),
            }
        }, []),
    })

    return (
        <div className={clsx("flex flex-col w-full", className)}>
            <GenerationComparisonOutputHeader
                variantId={variantId}
                indexName={indexName}
                className="sticky top-0 z-[1]"
            />

            <section className="border-0 border-r border-solid border-[rgba(5,23,41,0.06)]">
                {messageRowIds.map((messageRow) => (
                    <GenerationComparisonChatOutputRow
                        key={messageRow}
                        variantId={variantId}
                        rowId={messageRow}
                        isVariantRunning={isVariantRunning}
                    />
                ))}
                {!isVariantRunning ? (
                    <div className="flex items-center justify-center h-[48px] text-[#a0a0a0]">
                        No messages
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-[48px] text-[#a0a0a0]">
                        Loading...
                    </div>
                )}
            </section>
        </div>
    )
}

export default GenerationComparisonChatOutput
