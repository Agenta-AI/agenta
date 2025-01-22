import dynamic from "next/dynamic"
import PlaygroundVariantPropertyControl from "../../../PlaygroundVariantPropertyControl"
import GenerationOutputText from "../GenerationOutputText"
import {GenerationChatRowProps} from "./types"
import {useCallback} from "react"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
const GenerationResultUtils = dynamic(() => import("../GenerationResultUtils"), {ssr: false})
import PromptMessageContentOptions from "../../../PlaygroundVariantPropertyControl/assets/PromptMessageContent/assets/PromptMessageContentOptions"

const GenerationChatRowOutput = ({
    variantId,
    message,
    disabled = false,
    rowId,
    deleteMessage,
}: GenerationChatRowProps) => {
    return (
        <div className="w-full flex items-start gap-2 group/item">
            <div className="w-[120px]">
                <PlaygroundVariantPropertyControl
                    propertyId={message.role.__id}
                    variantId={variantId}
                    rowId={rowId}
                    as="SimpleDropdownSelect"
                    className="!border border-solid border-[rgba(5,23,41,0.06)] px-2"
                />
            </div>

            {message.content.value ? (
                <div className="w-full flex flex-col gap-3 -mt-1">
                    <GenerationOutputText
                        text={message.content.value}
                        className="w-full mt-1"
                        disabled={disabled}
                    />

                    <GenerationResultUtils result={{}} />
                </div>
            ) : (
                <PlaygroundVariantPropertyControl
                    rowId={rowId}
                    propertyId={message.content.__id}
                    variantId={variantId}
                    as="PromptMessageContent"
                    view="chat"
                    placeholder="Type your message here"
                />
            )}

            <PromptMessageContentOptions
                className="invisible group-hover/item:visible"
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

const GenerationChatRow = ({variantId, rowId}: GenerationChatRowProps) => {
    const {messageRow, message, mutate} = usePlayground({
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
        <div className="flex items-start gap-2 w-full">
            <GenerationChatRowOutput
                message={message}
                variantId={variantId}
                rowId={messageRow.__id}
                deleteMessage={deleteMessage}
            />
        </div>
    ) : null
}

export default GenerationChatRow
