import AddButton from "../../../assets/AddButton"
import PromptMessageConfig from "../../PromptMessageConfig"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
import type {PromptCollapseContentProps} from "../types"
import clsx from "clsx"

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
    const {messageIds} = usePlayground({
        variantId,
        hookId: "PlaygroundConfigVariantPrompts",
        variantSelector: (variant) => {
            
            const prompt = (variant.prompts || []).find((p) => p.__id === promptId)
            const messages = prompt?.messages

            if (!messages) {
                return {messageIds: []}
            }

            return {
                messageIds: messages.value.map((message) => message.__id)
            }
        },
    })

    console.log(
        "usePlayground[%cComponent%c] - PlaygroundVariantConfigPromptCollapseContent - RENDER!",
        "color: orange",
        "",
        variantId,
        messageIds,
    )

    return (
        <div 
            className={clsx("flex flex-col gap-4", className)}
            {...props}
        >
            {messageIds.map((messageId) => (
                <PromptMessageConfig
                    key={messageId}
                    variantId={variantId}
                    messageId={messageId}
                />
            ))}
            <AddButton label="Message" />
        </div>
    )
}

export default PlaygroundVariantConfigPromptCollapseContent
