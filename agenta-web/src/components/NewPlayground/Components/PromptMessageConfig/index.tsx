import {useCallback} from "react"
import dynamic from "next/dynamic"
import clsx from "clsx"

import PlaygroundVariantPropertyControl from "../PlaygroundVariantPropertyControl"
import usePlayground from "../../hooks/usePlayground"
import {componentLogger} from "../../assets/utilities/componentLogger"

import type {PromptMessageConfigProps} from "./types"
import {PlaygroundStateData} from "../../hooks/usePlayground/types"
import {findPropertyInObject, findVariantById} from "../../hooks/usePlayground/assets/helpers"
const PromptMessageContentOptions = dynamic(
    () =>
        import(
            "../PlaygroundVariantPropertyControl/assets/PromptMessageContent/assets/PromptMessageContentOptions"
        ),
    {ssr: false},
)

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
    rowId,
    deleteMessage,
    isMessageDeletable,
    disabled,
    debug,
    inputClassName,
    ...props
}: PromptMessageConfigProps) => {
    const {message} = usePlayground({
        variantId,
        hookId: "PromptMessageConfig",
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                if (!rowId) {
                    const variant = findVariantById(state, variantId)
                    if (!variant) return {message: undefined}

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
                } else {
                    const object =
                        state.generationData.inputs.value.find((v) => v.__id === rowId) ||
                        state.generationData.messages.value.find((v) => v.__id === rowId)

                    let message = findPropertyInObject(object, messageId)

                    message = message?.value || message

                    if (!message) return {message: undefined}
                    return {
                        message: {
                            role: message.role.__id,
                            content: message.content.__id,
                        },
                    }
                }
            },
            [messageId, rowId, variantId],
        ),
    })

    if (!message) {
        return null
    }

    componentLogger("PromptMessageConfig", variantId, messageId, message)

    return (
        <div
            className={clsx(
                "w-full flex flex-col items-start gap-2 relative group/item",
                className,
            )}
            {...props}
        >
            <div className="w-full flex items-center justify-between">
                <PlaygroundVariantPropertyControl
                    propertyId={message.role}
                    variantId={variantId}
                    rowId={rowId}
                    as="SimpleDropdownSelect"
                    disabled={disabled}
                />

                {!disabled && (
                    <PromptMessageContentOptions
                        className="invisible group-hover/item:visible"
                        deleteMessage={deleteMessage}
                        propertyId={message.content}
                        variantId={variantId}
                        messageId={messageId}
                        isMessageDeletable={isMessageDeletable}
                        disabled={disabled}
                    />
                )}
            </div>
            <PlaygroundVariantPropertyControl
                rowId={rowId}
                propertyId={message.content}
                variantId={variantId}
                as="PromptMessageContent"
                className={clsx("w-full", inputClassName)}
                disabled={disabled}
            />
        </div>
    )
}

export default PromptMessageConfig
