import {Input} from "antd"
import PlaygroundVariantPropertyControl from "../../../PlaygroundVariantPropertyControl"
import GenerationOutputText from "../GenerationOutputText"
import GenerationVariableOptions from "../GenerationVariableOptions"
import {GenerationChatRowProps} from "./types"
import {useCallback} from "react"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import PromptMessageConfig from "../../../PromptMessageConfig"

// const GenerationChatRow = ({
//     variantId,
//     message,
//     disabled = false,
//     type,
// }: GenerationChatRowProps) => {
//     return (
//         <div className="flex items-start gap-2 group/item">
//             <div className="w-[120px]">
//                 <PlaygroundVariantPropertyControl
//                     propertyId={message.role.__id}
//                     variantId={variantId}
//                     as="SimpleDropdownSelect"
//                     className="!border border-solid border-[rgba(5,23,41,0.06)] px-2 cursor-not-allowed"
//                 />
//             </div>

//             {type === "output" ? (
//                 <GenerationOutputText
//                     text={message.content.value}
//                     className="w-full mt-1"
//                     disabled={disabled}
//                 />
//             ) : (
//                 <Input bordered={false} />
//             )}

//             {!disabled && (
//                 <GenerationVariableOptions
//                     variantId={variantId}
//                     rowId={""}
//                     className="invisible group-hover/item:visible"
//                 />
//             )}
//         </div>
//     )
// }

const GenerationChatRow = ({
    variantId,
    rowId,
    className,
    inputOnly,
    view,
}: GenerationChatRowProps) => {
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

    console.log("message", messageRow, message)

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
        <div className="flex items-start gap-2 group/item w-full">
            <PromptMessageConfig
                key={message.__id}
                variantId={variantId}
                rowId={messageRow.__id}
                messageId={message.__id}
                className="w-full"
                deleteMessage={deleteMessage}
            />
        </div>
    ) : null
}

export default GenerationChatRow
