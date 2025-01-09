import {useCallback} from "react"

import clsx from "clsx"

import PlaygroundVariantPropertyControl from "../PlaygroundVariantPropertyControl"
import usePlayground from "../../hooks/usePlayground"
import {componentLogger} from "../../assets/utilities/componentLogger"

import type {PromptMessageConfigProps} from "./types"
import type {EnhancedVariant} from "../../assets/utilities/transformer/types"
import PromptMessageContentOptions from "../PlaygroundVariantPropertyControl/assets/PromptMessageContent/assets/PromptMessageContentOptions"

/**
 * PromptMessageConfig Component
 *
 * Renders a configuration interface for a single prompt message, including:
 * - Role selector (user/assistant/system)
 * - Content editor for the message
 *
 * The component uses PlaygroundVariantPropertyControl for both role and content
 * editing, configuring them with appropriate controls based on the schema.
 *
 * @param props - {@link PromptMessageConfigProps}
 * @param props.variantId - Unique identifier for the variant being configured
 */
const PromptMessageConfig = ({
    variantId,
    messageId,
    className,
    deleteMessage,
    ...props
}: PromptMessageConfigProps) => {
    const {message} = usePlayground({
        variantId,
        hookId: "PromptMessageConfig",
        variantSelector: useCallback(
            (variant: EnhancedVariant) => {
                for (const prompt of variant.prompts || []) {
                    const message = prompt.messages?.value.find((msg) => msg.__id === messageId)
                    if (message) {
                        return {
                            message: {
                                role: message.role.__id,
                                content: message.content.__id,
                            },
                        }
                    }
                }
                return {message: undefined}
            },
            [messageId],
        ),
    })

    if (!message) {
        return null
    }

    componentLogger("PromptMessageConfig", variantId, messageId, message)

    return (
        <>
            <div className={clsx("flex flex-col gap-1 group/item", className)} {...props}>
                <div className="w-full flex items-center justify-between">
                    <PlaygroundVariantPropertyControl
                        propertyId={message.role}
                        variantId={variantId}
                        as="SimpleDropdownSelect"
                    />

                    <PromptMessageContentOptions
                        className="invisible group-hover/item:visible"
                        deleteMessage={deleteMessage}
                        propertyId={message.content}
                        variantId={variantId}
                        messageId={messageId}
                    />
                </div>
                <PlaygroundVariantPropertyControl
                    propertyId={message.content}
                    variantId={variantId}
                    as="PromptMessageContent"
                />
            </div>
        </>
    )
}

export default PromptMessageConfig
