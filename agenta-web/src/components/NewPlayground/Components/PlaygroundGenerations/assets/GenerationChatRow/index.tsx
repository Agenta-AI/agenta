import {useCallback, useMemo} from "react"

import clsx from "clsx"
import dynamic from "next/dynamic"

import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {
    findPropertyInObject,
    findVariantById,
} from "@/components/NewPlayground/hooks/usePlayground/assets/helpers"
import PromptMessageConfig from "../../../PromptMessageConfig"
import AddButton from "@/components/NewPlayground/assets/AddButton"
import RunButton from "@/components/NewPlayground/assets/RunButton"
import {getMetadataLazy, getResponseLazy} from "@/components/NewPlayground/state"
import {createMessageFromSchema} from "@/components/NewPlayground/hooks/usePlayground/assets/messageHelpers"

import type {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import type {
    ArrayMetadata,
    ObjectMetadata,
} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import type {GenerationChatRowProps} from "./types"
import TextControl from "../../../PlaygroundVariantPropertyControl/assets/TextControl"

const GenerationResultUtils = dynamic(() => import("../GenerationResultUtils"), {ssr: false})

export const GenerationChatRowOutput = ({
    variantId,
    message,
    disabled = false,
    rowId,
    deleteMessage,
    rerunMessage,
    viewAs,
    resultHash,
    isRunning: propsIsRunning,
    isMessageDeletable,
    placeholder,
    messageProps,
}: GenerationChatRowProps) => {
    const {viewType} = usePlayground({
        variantId,
        rowId,
        registerToWebWorker: true,
    })
    const isComparisonView = viewType === "comparison"
    const result = useMemo(() => {
        return getResponseLazy(resultHash)
    }, [resultHash])

    const messageResult = useMemo(() => {
        if (message?.__result) {
            return getResponseLazy(message.__result)
        }

        return undefined
    }, [message?.__result])

    return propsIsRunning ? (
        <div className="w-full flex flex-col gap-3 items-center justify-center h-full self-stretch">
            <TextControl
                value="Generating response..."
                editorType="borderless"
                state="readOnly"
                metadata={{}}
            />
        </div>
    ) : (
        <div
            className={clsx([
                "w-full flex flex-col items-start gap-2 relative group/option",
                {"!gap-0": isComparisonView},
            ])}
        >
            <PromptMessageConfig
                {...messageProps}
                variantId={variantId as string}
                rowId={rowId}
                messageId={message?.__id}
                disabled={disabled}
                className={clsx([
                    "w-full",
                    messageProps?.className,
                    {
                        "[&_.agenta-rich-text-editor_*]:!text-[red] [&_.message-user-select]:text-[red] [&_.message-user-select]:pointer-events-none":
                            messageResult?.error,
                    },
                ])}
                isMessageDeletable={isMessageDeletable}
                debug
                placeholder={placeholder}
                deleteMessage={deleteMessage}
                rerunMessage={rerunMessage}
                footer={
                    !!result ? (
                        <div
                            className={clsx([
                                "flex items-center mt-2",
                                messageProps?.footerClassName,
                            ])}
                        >
                            <GenerationResultUtils result={result} />
                        </div>
                    ) : null
                }
                state={messageResult?.error ? "readOnly" : "filled"}
            />
        </div>
    )
}

const GenerationChatRow = ({
    withControls,
    historyId,
    variantId,
    messageId,
    rowId,
    viewAs,
    isMessageDeletable,
    messageProps,
    isRunning,
}: GenerationChatRowProps) => {
    const {
        historyItem,
        messageRow,
        runTests,
        mutate,
        viewType,
        displayedVariants,
        rerunChatOutput,
    } = usePlayground({
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
                    const messageHistory = messageRow?.history?.value || []
                    let historyItem = findPropertyInObject(messageHistory, historyId)
                    if (historyItem?.message) {
                        historyItem = {
                            ...historyItem,
                            ...historyItem.message,
                        }
                    }
                    return {
                        messageRow,
                        historyItem,
                        // isRunning: historyItem?.__runs?.[variantId]?.__isRunning,
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

    const canRerunMessage = useMemo(() => {
        // check for input row [comparison], and complete message information (content, role)
        if (
            viewType === "comparison" &&
            !variantId &&
            !!historyItem?.content?.value &&
            !!historyItem?.role?.value
        ) {
            const areAllRunning = Object.values(historyItem?.__runs || {}).every(
                (run) => run?.__isRunning,
            )
            const gotAllResponses = (displayedVariants || []).every((variantId) => {
                return !!historyItem?.__runs?.[variantId]?.__result
            })
            return !areAllRunning && gotAllResponses
        } else if (viewType === "single" && !!variantId && !!historyItem) {
            if (!historyItem?.__runs && !historyItem?.message) {
                // this is an input row
                const isRunning = Object.values(historyItem?.__runs || {}).every(
                    (run) => run?.__isRunning,
                )
                return !isRunning
            } else {
                // this is a chat row
                const isRunning = historyItem?.__isRunning
                return !isRunning
            }
        }
        return undefined
    }, [viewType, variantId, historyItem, displayedVariants])

    const rerunMessage = useCallback(
        (messageId: string) => {
            rerunChatOutput(messageId)
        },
        [rerunChatOutput],
    )

    return (
        <>
            <div
                className={clsx([
                    "flex flex-col items-start gap-5 w-full",
                    {"!gap-0": viewType === "comparison"},
                ])}
            >
                <GenerationChatRowOutput
                    key={historyItem?.__id || `${variantId}-${rowId}-generating`}
                    message={historyItem}
                    variantId={variantId}
                    viewAs={viewAs}
                    rowId={messageRow?.__id}
                    resultHash={historyItem?.__result}
                    isRunning={historyItem?.__isRunning || isRunning}
                    disabled={!messageRow}
                    placeholder="Type a message..."
                    messageProps={{
                        className: "[&]:!min-h-4",
                        ...messageProps,
                    }}
                    isMessageDeletable={isMessageDeletable}
                    deleteMessage={deleteMessage}
                    rerunMessage={canRerunMessage ? rerunMessage : undefined}
                />
            </div>
            {withControls ? (
                <div
                    className={clsx([
                        "flex items-center gap-2 mt-5",
                        {"px-3": viewType === "comparison"},
                    ])}
                >
                    <RunButton
                        size="small"
                        disabled={historyItem?.__isRunning}
                        onClick={() => runTests?.()}
                        className="flex"
                    />
                    <AddButton size="small" label="Message" onClick={addNewMessageToRowHistory} />
                </div>
            ) : null}
        </>
    )
}

export default GenerationChatRow
