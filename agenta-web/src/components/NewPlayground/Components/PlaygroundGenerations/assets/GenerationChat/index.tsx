import {useCallback} from "react"

import {Typography} from "antd"
import clsx from "clsx"

import GenerationCompletionRow from "../GenerationCompletionRow"
import GenerationChatRow from "../GenerationChatRow"
import {getMetadataLazy} from "../../../../state"

import usePlayground from "../../../../hooks/usePlayground"

import type {GenerationChatProps} from "./types"
import type {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"

const GenerationChat = ({variantId, viewAs}: GenerationChatProps) => {
    const {inputRowIds, messageRowIds, viewType, configMessageIds, isChat} = usePlayground({
        variantId,
        registerToWebWorker: true,
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
                    isChat: state.variants[0].isChat,
                }
            },
            [variantId],
        ),
    })
    const isComparisonView = viewType === "comparison"

    return (
        <section className="flex flex-col">
            {/* Variables */}
            {!isChat &&
                inputRowIds.map((inputRowId) => {
                    return (
                        <GenerationCompletionRow
                            key={inputRowId}
                            variantId={variantId}
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
                    <div className={clsx(["flex flex-col gap-5", {"!gap-0": isComparisonView}])}>
                        {!isComparisonView
                            ? configMessageIds.map((messageId) => (
                                  <GenerationChatRow
                                      key={messageId}
                                      variantId={variantId}
                                      messageId={messageId}
                                      viewAs={viewAs}
                                  />
                              ))
                            : null}
                        {messageRowIds.map((messageRow) => (
                            <GenerationChatRow
                                key={messageRow}
                                variantId={variantId}
                                rowId={messageRow}
                                withControls
                            />
                        ))}
                    </div>
                </div>

                <div
                    className={clsx([{"flex items-center h-[48px] px-4": isComparisonView}])}
                ></div>
            </div>
        </section>
    )
}

export default GenerationChat
