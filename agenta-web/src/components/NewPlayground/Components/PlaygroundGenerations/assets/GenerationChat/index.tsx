import {useCallback} from "react"
import {GenerationChatProps} from "./types"
import GenerationCompletionRow from "../GenerationCompletionRow"
import {EnhancedVariant} from "@/components/NewPlayground/assets/utilities/transformer/types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import clsx from "clsx"
import GenerationChatRow from "../GenerationChatRow"
import AddButton from "@/components/NewPlayground/assets/AddButton"
import {Typography} from "antd"
import {Plus} from "@phosphor-icons/react"

const GenerationChat = ({variantId}: GenerationChatProps) => {
    const {inputRowIds, messages} = usePlayground({
        variantId,
        hookId: "PlaygroundConfigVariantPrompts",
        variantSelector: useCallback((variant: EnhancedVariant) => {
            const inputRows = variant.inputs?.value || []

            // Flatten messages from all prompts
            const allMessages = variant.prompts
                ?.flatMap((prompt) => prompt.messages?.value || [])
                .filter(Boolean)

            return {
                inputRowIds: (inputRows || []).map((inputRow) => inputRow.__id),
                messages: allMessages || [],
            }
        }, []),
    })

    return (
        <section className="flex flex-col">
            {inputRowIds.map((inputRowId) => {
                return (
                    <GenerationCompletionRow
                        variantId={variantId}
                        rowId={inputRowId}
                        inputOnly={true}
                    />
                )
            })}

            <div className="flex flex-col gap-4 p-4 border-0 border-b border-solid border-[rgba(5,23,41,0.06)] group/item">
                <div className="flex flex-col gap-1">
                    <Typography>Chat</Typography>
                    <div className="flex flex-col gap-6">
                        {messages.map((msg) => (
                            <GenerationChatRow
                                variantId={variantId}
                                message={msg}
                                disabled={true}
                                type="output"
                            />
                        ))}
                    </div>
                </div>

                <div className="w-full flex gap-2 items-center cursor-pointer invisible group-hover/item:visible">
                    <div className="w-1/2 h-[1px] bg-[rgba(5,23,41,0.06)]" />
                    <Plus size={16} />
                    <div className="w-1/2 h-[1px] bg-[rgba(5,23,41,0.06)]" />
                </div>

                {/* TODO: properly support input on the GenerationChatRow  */}
                <div className="flex flex-col gap-6">
                    <GenerationChatRow variantId={variantId} message={messages[1]} type="input" />
                </div>
            </div>

            <div className={clsx(["flex items-center gap-2 px-4 mt-5"])}>
                <AddButton size="small" label="Input" />
            </div>
        </section>
    )
}

export default GenerationChat
