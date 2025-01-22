import dynamic from "next/dynamic"
import PlaygroundVariantPropertyControl from "../../../PlaygroundVariantPropertyControl"
import GenerationOutputText from "../GenerationOutputText"
import {GenerationChatRowProps} from "./types"
import {useCallback} from "react"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
const GenerationResultUtils = dynamic(() => import("../GenerationResultUtils"), {ssr: false})
import PromptMessageContentOptions from "../../../PlaygroundVariantPropertyControl/assets/PromptMessageContent/assets/PromptMessageContentOptions"
import clsx from "clsx"

const GenerationChatRowOutput = ({
    variantId,
    message,
    disabled = false,
    rowId,
    deleteMessage,
    viewAs,
}: GenerationChatRowProps) => {
    const {viewType} = usePlayground()
    const isComparisonView = viewType === "comparison"

    return (
        <div
            className={clsx([
                "w-full flex items-start gap-2 relative group/option",
                {"flex-col !gap-0": isComparisonView},
            ])}
        >
            <div
                className={clsx([
                    "w-[120px]",
                    {
                        "h-[48px] !w-full px-4 flex items-center border-0 border-b border-r border-solid border-[rgba(5,23,41,0.06)]":
                            isComparisonView,
                    },
                ])}
            >
                <PlaygroundVariantPropertyControl
                    propertyId={message.role.__id}
                    variantId={variantId}
                    rowId={rowId}
                    as="SimpleDropdownSelect"
                    className="!border border-solid border-[rgba(5,23,41,0.06)] px-2 bg-white"
                />
            </div>

            {/** TODO: Update the condition here */}
            {message.content.value && !isComparisonView && viewAs !== "input" ? (
                <div
                    className={clsx([
                        "w-full flex flex-col gap-3 -mt-1",
                        {"!m-0 !gap-0": isComparisonView},
                    ])}
                >
                    <div
                        className={clsx([
                            {
                                "h-[98px] px-4 py-2 border-0 border-b border-r border-solid border-[rgba(5,23,41,0.06)]":
                                    isComparisonView,
                            },
                        ])}
                    >
                        <GenerationOutputText
                            text={message.content.value}
                            className="w-full mt-1"
                            disabled={disabled}
                        />
                    </div>

                    <div
                        className={clsx([
                            {
                                "h-[48px] px-4 flex items-center border-0 border-b border-r border-solid border-[rgba(5,23,41,0.06)]":
                                    isComparisonView,
                            },
                        ])}
                    >
                        <GenerationResultUtils result={{}} />
                    </div>
                </div>
            ) : (
                <PlaygroundVariantPropertyControl
                    rowId={rowId}
                    propertyId={message.content.__id}
                    variantId={variantId}
                    as="PromptMessageContent"
                    view={!isComparisonView ? "chat" : ""}
                    placeholder="Type your message here"
                    className={clsx([
                        {
                            "!bg-transparent border-0 border-b border-r border-solid border-[rgba(5,23,41,0.06)] hover:!border-[rgba(5,23,41,0.06)] focus:!border-[rgba(5,23,41,0.06)] px-4 py-2 !rounded-none !h-full":
                                isComparisonView,
                        },
                    ])}
                />
            )}

            {!viewAs || viewAs == "input" ? (
                <PromptMessageContentOptions
                    className={clsx([
                        "invisible group-hover/option:visible",
                        {"absolute top-2 right-1": isComparisonView},
                    ])}
                    deleteMessage={deleteMessage}
                    propertyId={message.content.__id}
                    rowId={rowId}
                    variantId={variantId}
                    messageId={message.__id}
                    isMessageDeletable={false}
                />
            ) : null}
        </div>
    )
}

const GenerationChatRow = ({variantId, rowId, viewAs}: GenerationChatRowProps) => {
    const {messageRow, message, mutate, viewType} = usePlayground({
        variantId,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const messageRow = (state.generationData.messages.value || []).find((inputRow) => {
                    return inputRow.__id === rowId
                })
                return {
                    messageRow,
                    message: messageRow?.value,
                }
            },
            [rowId],
        ),
    })

    const deleteMessage = useCallback((messageId: string) => {
        mutate(
            (clonedState) => {
                if (!clonedState) return clonedState

                const generationMessages = clonedState.generationData.messages.value
                clonedState.generationData.messages.value = generationMessages.filter((message) => {
                    return message.value.__id !== messageId
                })

                return clonedState
            },
            {revalidate: false},
        )
    }, [])

    return messageRow ? (
        <div
            className={clsx([
                "flex items-start gap-2 w-full",
                {"!gap-0": viewType === "comparison"},
            ])}
        >
            <GenerationChatRowOutput
                message={message}
                variantId={variantId}
                rowId={messageRow.__id}
                deleteMessage={deleteMessage}
                viewAs={viewAs}
            />
        </div>
    ) : null
}

export default GenerationChatRow
