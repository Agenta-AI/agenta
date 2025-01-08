import {useCallback} from "react"

import clsx from "clsx"
import {Typography} from "antd"

import usePlayground from "../../../hooks/usePlayground"
import AddButton from "../../../assets/AddButton"
import PromptMessageConfig from "../../PromptMessageConfig"
import {createObjectFromMetadata} from "../../../assets/utilities/genericTransformer/helpers/arrays"
import {componentLogger} from "../../../assets/utilities/componentLogger"

import type {PromptCollapseContentProps} from "../types"
import type {ArrayMetadata} from "../../../assets/utilities/genericTransformer/types"
import type {EnhancedVariant} from "../../../assets/utilities/transformer/types"

/**
 * PlaygroundVariantConfigPromptCollapseContent renders the configuration interface
 * for a single prompt's messages.
 *
 * Features:
 * - Displays a list of configurable messages for the prompt
 * - Allows adding new messages
 * - Manages message configurations through the playground state
 *
 * @component
 */
const PlaygroundVariantConfigPromptCollapseContent: React.FC<PromptCollapseContentProps> = ({
    variantId,
    promptId,
    className,
    ...props
}) => {
    const {inputKeys, messageIds, mutateVariant} = usePlayground({
        variantId,
        hookId: "PlaygroundConfigVariantPrompts",
        variantSelector: useCallback(
            (variant: EnhancedVariant) => {
                const prompt = (variant.prompts || []).find((p) => p.__id === promptId)
                const messages = prompt?.messages

                if (!messages) {
                    return {messageIds: []}
                }

                return {
                    messageIds: messages.value.map((message) => message.__id),
                    inputKeys: prompt.inputKeys.value || [],
                }
            },
            [promptId],
        ),
    })

    const addNewMessage = useCallback(() => {
        if (!mutateVariant) return

        mutateVariant((draft) => {
            const variantPrompt = draft.prompts?.find((p) => p.__id === promptId)
            const messages = variantPrompt?.messages.value
            const metadata = (variantPrompt?.messages.__metadata as ArrayMetadata).itemMetadata

            if (variantPrompt && messages && metadata) {
                const newMessage = createObjectFromMetadata(metadata) as (typeof messages)[number]
                if (newMessage) {
                    messages.push(newMessage)
                }
            }

            return draft
        })
    }, [mutateVariant, promptId])

    const deleteMessage = useCallback(
        (messageId: string) => {
            if (!mutateVariant) return

            mutateVariant((draft) => {
                const variantPrompt = draft.prompts?.find((p) => p.__id === promptId)
                const messages = variantPrompt?.messages.value

                if (variantPrompt && messages) {
                    // Filter out the message with the specified ID
                    variantPrompt.messages.value = messages.filter(
                        (message) => message.__id !== messageId,
                    )
                }

                return draft
            })
        },
        [mutateVariant, promptId],
    )

    componentLogger(
        "PlaygroundVariantConfigPromptCollapseContent",
        variantId,
        messageIds,
        inputKeys,
    )

    return (
        <div className={clsx("flex flex-col gap-4", className)} {...props}>
            {messageIds.map((messageId) => (
                <PromptMessageConfig
                    key={messageId}
                    variantId={variantId}
                    messageId={messageId}
                    deleteMessage={deleteMessage}
                />
            ))}
            <AddButton label="Message" onClick={addNewMessage} />

            <div className="flex flex-col gap-2">
                <Typography.Text strong>Input keys:</Typography.Text>
                {(inputKeys || []).map((inputKey) => (
                    <div key={inputKey.value}>{inputKey.value}</div>
                ))}
            </div>
        </div>
    )
}

export default PlaygroundVariantConfigPromptCollapseContent
