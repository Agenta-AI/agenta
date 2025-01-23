import dynamic from "next/dynamic"
import PlaygroundVariantPropertyControl from "../../../PlaygroundVariantPropertyControl"
import GenerationOutputText from "../GenerationOutputText"
import {GenerationChatRowProps} from "./types"
import {useCallback} from "react"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
const GenerationResultUtils = dynamic(() => import("../GenerationResultUtils"), {ssr: false})
import PromptMessageContentOptions from "../../../PlaygroundVariantPropertyControl/assets/PromptMessageContent/assets/PromptMessageContentOptions"

const GenerationChatRow = ({variantId, disabled = false, rowId}: GenerationChatRowProps) => {
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
    const isComparisonView = viewType === "comparison"

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

    if (!messageRow) return

    if (!isComparisonView) {
        return (
            <div className="w-full @[700px]:flex-row flex flex-col items-start gap-2 relative group/option">
                <div className="w-[120px]">
                    <PlaygroundVariantPropertyControl
                        propertyId={message.role.__id}
                        variantId={variantId}
                        rowId={rowId}
                        as="SimpleDropdownSelect"
                        className="!border border-solid border-[rgba(5,23,41,0.06)] px-2 bg-white"
                    />
                </div>

                {/** TODO: Update the condition here */}
                <div className="w-full @[700px]:mr-[70px]">
                    {message.content.value ? (
                        <div className="w-full flex flex-col gap-3 @[700px]:-mt-1">
                            <GenerationOutputText
                                text={message.content.value}
                                className="w-full mt-1"
                                disabled={false}
                            />

                            <GenerationResultUtils result={{}} />
                        </div>
                    ) : (
                        <PlaygroundVariantPropertyControl
                            rowId={rowId}
                            propertyId={message.content.__id}
                            variantId={variantId}
                            as="PromptMessageContent"
                            view={!isComparisonView ? "chat" : ""}
                            placeholder="Type your message here"
                        />
                    )}
                </div>

                <PromptMessageContentOptions
                    className="invisible group-hover/option:visible absolute top-0 right-0"
                    deleteMessage={deleteMessage}
                    propertyId={message.content.__id}
                    rowId={rowId}
                    variantId={variantId}
                    messageId={message.__id}
                    isMessageDeletable={false}
                />
            </div>
        )
    }

    return (
        <div className="flex-col !gap-0 relative group/option">
            <div className="h-[48px] !w-full px-4 flex items-center border-0 border-b border-r border-solid border-[rgba(5,23,41,0.06)]">
                <PlaygroundVariantPropertyControl
                    propertyId={message.role.__id}
                    variantId={variantId}
                    rowId={rowId}
                    as="SimpleDropdownSelect"
                    className="!border border-solid border-[rgba(5,23,41,0.06)] px-2 bg-white"
                />
            </div>

            <PlaygroundVariantPropertyControl
                rowId={rowId}
                propertyId={message.content.__id}
                variantId={variantId}
                as="PromptMessageContent"
                view={!isComparisonView ? "chat" : ""}
                placeholder="Type your message here"
                className="!bg-transparent border-0 border-b border-r border-solid border-[rgba(5,23,41,0.06)] hover:!border-[rgba(5,23,41,0.06)] focus:!border-[rgba(5,23,41,0.06)] px-4 py-2 !rounded-none !h-full"
            />

            <PromptMessageContentOptions
                className="absolute top-2 right-1 invisible group-hover/option:visible"
                deleteMessage={deleteMessage}
                propertyId={message.content.__id}
                rowId={rowId}
                variantId={variantId}
                messageId={message.__id}
                isMessageDeletable={false}
            />
        </div>
    )
}

export default GenerationChatRow
