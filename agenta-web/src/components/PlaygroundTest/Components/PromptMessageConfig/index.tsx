import clsx from "clsx"
import PlaygroundVariantPropertyControl from "../PlaygroundVariantPropertyControl"
import type {PromptMessageConfigProps} from "./types"
import { EnhancedArrayMessage } from "../../betterTypes/types"
import usePlayground from "../../hooks/usePlayground"

interface SelectedData {
    message: {
        role: EnhancedArrayMessage['role']['__id']
        content: EnhancedArrayMessage['content']['__id']
    } | undefined
}

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
    ...props
}: PromptMessageConfigProps) => {
    const {message} = usePlayground<SelectedData>({
        variantId,
        hookId: "PromptMessageConfig",
        variantSelector: (variant) => {
            for (const prompt of variant.prompts || []) {
                const message = prompt.messages?.value.find(msg => msg.__id === messageId)
                if (message) {
                    return { 
                        message: {
                            role: message.role.__id,
                            content: message.content.__id,
                        }
                    }
                }
            }
            return { message: undefined }
        },
    })

    if (!message) {
        return null
    }

    console.log(
        "usePlayground[%cComponent%c] - PromptMessageConfig - RENDER!",
        "color: orange",
        "",
        variantId,
        messageId,
        message
    )

    return (
        <div 
            className={clsx("relative border-solid border border-[#bdc7d1] rounded-[theme(spacing.2)]", className)}
            {...props}
        >
            <PlaygroundVariantPropertyControl
                propertyId={message.role}
                variantId={variantId}
                as="SimpleDropdownSelect"
            />
            <PlaygroundVariantPropertyControl
                propertyId={message.content}
                variantId={variantId}
                as="PromptMessageContent"
            />
        </div>
    )
}

export default PromptMessageConfig
