import {useCallback} from "react"

import {Typography} from "antd"
import clsx from "clsx"

import GenerationCompletionRow from "../GenerationCompletionRow"
import GenerationChatRow from "../GenerationChatRow"
import {getMetadataLazy} from "../../../../state"

import usePlayground from "../../../../hooks/usePlayground"

import type {GenerationChatProps} from "./types"
import type {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import PromptMessageConfig from "../../../PromptMessageConfig"
import TextControl from "../../../PlaygroundVariantPropertyControl/assets/TextControl"

const GenerationChat = ({variantId, viewAs}: GenerationChatProps) => {
    const {inputRowIds, messageRowIds, viewType, historyIds, configMessageIds} = usePlayground({
        variantId,
        hookId: "PlaygroundConfigVariantPrompts",
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const inputRows = state.generationData.inputs.value || []
                const messageRows = state.generationData.messages.value || []
                const configMessages = (
                    state.variants.find((v) => v.id === variantId)?.prompts || []
                ).flatMap((variant) => {
                    return variant.messages.value
                })

                const isRunning = messageRows.some((messageRow) => {
                    return Object.values(messageRow?.__runs || {}).some((run) => run.__isRunning)
                })

                const isComparisonView = state.selected.length > 1
                const historyIds = state.generationData.messages.value.reduce((acc, messageRow) => {
                    return {
                        ...acc,
                        [messageRow.__id]: messageRow.history.value.reduce((acc, historyItem) => {
                            const copyItem = structuredClone(historyItem)
                            delete copyItem.__runs
                            return [
                                ...acc,
                                copyItem?.__id,
                                historyItem.__runs?.[variantId]?.__isRunning
                                    ? `isRunning-${copyItem?.__id}`
                                    : historyItem.__runs?.[variantId]?.__id,
                            ].filter(Boolean)
                        }, []),
                    }
                }, {})

                return {
                    isRunning,
                    inputRowIds: (inputRows || [])
                        .filter((inputRow) => {
                            return (
                                Object.keys(getMetadataLazy(inputRow.__metadata)?.properties)
                                    .length > 0
                            )
                        })
                        .map((inputRow) => inputRow.__id),
                    messageRowIds: (messageRows || [])
                        .map((messageRow) => {
                            return isComparisonView
                                ? !Object.keys(messageRow.__runs || {}).length
                                    ? messageRow.__id
                                    : undefined
                                : messageRow.__id
                        })
                        .filter(Boolean) as string[],
                    configMessageIds: configMessages.map((message) => message.__id),
                    historyIds,
                }
            },
            [variantId],
        ),
    })
    const isComparisonView = viewType === "comparison"

    return (
        <section className="flex flex-col">
            {/**
             * Variables
             * only displayed in single view state
             * meaning when there's
             */}
            {!!variantId &&
                inputRowIds.map((inputRowId) => {
                    return (
                        <GenerationCompletionRow
                            key={inputRowId}
                            rowId={inputRowId}
                            inputOnly={true}
                            className={clsx([
                                {
                                    "bg-[#f5f7fa] border-0 border-r border-solid border-[rgba(5,23,41,0.06)]":
                                        isComparisonView,
                                },
                            ])}
                        />
                    )
                })}

            {/* Prompt chats */}
            <div
                className={clsx([
                    "flex flex-col gap-4 p-4 border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                    {"!border-none !p-0 !gap-0": isComparisonView},
                ])}
            >
                <div className="flex flex-col gap-1">
                    {!isComparisonView && <Typography>Chat</Typography>}
                    <div className={clsx(["flex flex-col gap-2", {"!gap-0": isComparisonView}])}>
                        {!isComparisonView
                            ? configMessageIds.map((messageId) => (
                                  <PromptMessageConfig
                                      key={messageId}
                                      variantId={variantId as string}
                                      messageId={messageId}
                                      editorClassName="w-full"
                                      isMessageDeletable={false}
                                      state="readOnly"
                                      disabled
                                      debug
                                  />
                              ))
                            : null}
                        {messageRowIds.map((messageRow) => {
                            return historyIds[messageRow].map((historyId, index) => {
                                return (
                                    <GenerationChatRow
                                        key={`${messageRow}-${historyId}`}
                                        variantId={variantId}
                                        rowId={messageRow}
                                        historyId={historyId}
                                        withControls={index === historyIds[messageRow].length - 1}
                                        isRunning={historyId.includes("isRunning")}
                                    />
                                )
                            })
                        })}
                    </div>
                </div>
            </div>
        </section>
    )
}

export default GenerationChat
