import dynamic from "next/dynamic"
import PlaygroundVariantPropertyControl from "../../../PlaygroundVariantPropertyControl"
import GenerationOutputText from "../GenerationOutputText"
import {GenerationChatRowProps} from "./types"
import {useCallback} from "react"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import PromptMessageContentOptions from "../../../PlaygroundVariantPropertyControl/assets/PromptMessageContent/assets/PromptMessageContentOptions"
import clsx from "clsx"
import {
    findPropertyInObject,
    findVariantById,
} from "@/components/NewPlayground/hooks/usePlayground/assets/helpers"
import PromptMessageConfig from "../../../PromptMessageConfig"
import {CopySimple} from "@phosphor-icons/react"
import AddButton from "@/components/NewPlayground/assets/AddButton"
import {getMetadataLazy} from "@/components/NewPlayground/state"
import {createMessageFromSchema} from "@/components/NewPlayground/hooks/usePlayground/assets/messageHelpers"
import {
    ArrayMetadata,
    ObjectMetadata,
} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import RunButton from "@/components/NewPlayground/assets/RunButton"

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
}: GenerationChatRowProps) => {
    const {viewType} = usePlayground()
    const isComparisonView = viewType === "comparison"

    return isRunning ? (
        <div className="w-full flex items-start gap-2 relative group/option">
            <div className="w-[120px]"></div>
            <div className="w-full flex flex-col gap-3 -mt-1">
                <GenerationOutputText
                    text={"Generating response..."}
                    className="w-full mt-1"
                    disabled={disabled}
                />
            </div>
        </div>
    ) : (
        <>
            <div className="w-full flex flex-col items-start gap-2 relative group/option">
                <PromptMessageConfig
                    variantId={variantId}
                    rowId={rowId}
                    messageId={message.__id}
                    disabled={disabled}
                    deleteMessage={deleteMessage}
                    debug
                    className="w-full"
                />
                {!!result ? <GenerationResultUtils result={result} /> : null}
            </div>
        </>
    )
}

const GenerationChatRow = ({
    withControls,
    variantId,
    messageId,
    rowId,
    viewAs,
    noResults,
}: GenerationChatRowProps) => {
    const {history, messageRow, message, runTests, mutate, viewType, result, isRunning} =
        usePlayground({
            variantId,
            stateSelector: useCallback(
                (state: PlaygroundStateData) => {
                    const variant = findVariantById(state, variantId)

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
                        return {
                            messageRow,
                            history: messageHistory
                                .map((historyItem) => {
                                    return !historyItem.__runs
                                        ? historyItem
                                        : variantId && historyItem.__runs[variantId]
                                          ? {
                                                ...historyItem.__runs[variantId].message,
                                                __result: historyItem.__runs[variantId].__result,
                                                __isRunning:
                                                    historyItem.__runs[variantId].__isRunning,
                                            }
                                          : undefined
                                })
                                .filter(Boolean),
                        }
                    }
                },
                [rowId, variantId, messageId],
            ),
        })
    const isComparisonView = viewType === "comparison"

    const deleteMessage = useCallback((messageId: string) => {
        mutate(
            (clonedState) => {
                if (!clonedState) return clonedState

                if (!variantId) {
                    const row = clonedState.generationData.messages.value.find((v) => v.__id === rowId)
                    const isInput = row.history.value.findIndex((m) => m.__id === messageId)
                    if (isInput !== -1) {
                        row.history.value.splice(isInput, 1)
                    }
                } else if (variantId) {
                    const row = clonedState.generationData.messages.value.find((v) => v.__id === rowId)
                    const isInput = row.history.value.findIndex((m) => m.__id === messageId)
                    if (isInput !== -1) {
                        row.history.value.splice(isInput, 1)
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
    }, [rowId])

    return (
        <>
            <div
                className={clsx([
                    "flex flex-col items-start gap-1 w-full",
                    {"!gap-0": viewType === "comparison"},
                    {"px-2": viewType === "comparison"},
                ])}
            >
                {history.map((historyItem) => {
                    return (
                        <GenerationChatRowOutput
                            key={historyItem.__id}
                            message={historyItem}
                            variantId={variantId}
                            deleteMessage={deleteMessage}
                            viewAs={viewAs}
                            rowId={messageRow?.__id}
                            result={historyItem?.__result}
                            isRunning={historyItem?.__isRunning}
                            isMessageDeletable={!!messageRow}
                            disabled={!messageRow}
                        />
                    )
                })}
            </div>
            {withControls ? (
                <div className={clsx(["flex items-center gap-2 px-4 mt-5"])}>
                    <RunButton
                        size="small"
                        onClick={() => runTests?.()}
                        disabled={isRunning}
                        className="flex"
                    />
                    <AddButton
                        disabled={isRunning}
                        size="small"
                        label="Message"
                        onClick={addNewMessageToRowHistory}
                    />
                </div>
            ) : null}
        </>
    )
}

export default GenerationChatRow
