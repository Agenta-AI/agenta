import {useCallback} from "react"

import {Typography} from "antd"
import clsx from "clsx"

import {autoScrollToBottom} from "@/oss/components/NewPlayground/assets/utilities/utilityFunctions"
import type {PlaygroundStateData} from "@/oss/components/NewPlayground/hooks/usePlayground/types"
import useLazyEffect from "@/oss/hooks/useLazyEffect"
import {getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {ObjectMetadata} from "@/oss/lib/shared/variant/genericTransformer/types"

import usePlayground from "../../../../hooks/usePlayground"
import PromptMessageConfig from "../../../PromptMessageConfig"
import GenerationChatRow from "../GenerationChatRow"
import GenerationCompletionRow from "../GenerationCompletionRow"

import type {GenerationChatProps} from "./types"

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

                const historyIds = state.generationData.messages.value.reduce(
                    (acc, messageRow) => {
                        return {
                            ...acc,
                            [messageRow.__id]: messageRow.history.value.reduce(
                                (acc, historyItem) => {
                                    const copyItem = structuredClone(historyItem)
                                    delete copyItem.__runs
                                    return [
                                        ...acc,
                                        copyItem?.__id,
                                        variantId
                                            ? historyItem.__runs?.[variantId]?.__isRunning
                                                ? `isRunning-${copyItem?.__id}`
                                                : historyItem.__runs?.[variantId]?.__id
                                            : undefined,
                                    ].filter(Boolean) as string[]
                                },
                                [] as string[],
                            ),
                        }
                    },
                    {} as Record<string, string[]>,
                )

                return {
                    inputRowIds: (inputRows || [])
                        .filter((inputRow) => {
                            return (
                                Object.keys(
                                    (getMetadataLazy(inputRow.__metadata) as ObjectMetadata)
                                        ?.properties,
                                ).length > 0
                            )
                        })
                        .map((inputRow) => inputRow.__id),
                    messageRowIds: (messageRows || [])
                        .map((messageRow) => {
                            return messageRow.__id
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

    useLazyEffect(() => {
        if (isComparisonView) return

        const timer = autoScrollToBottom()
        return timer
    }, [messageRowIds])

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
