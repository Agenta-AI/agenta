import AddButton from "../../../assets/AddButton"
import PromptMessageConfig from "../../PromptMessageConfig"
import type {StateVariant} from "@/components/PlaygroundTest/state/types"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
import type {MessageConfig, PromptCollapseContentProps} from "../types"
import type {Path} from "@/components/PlaygroundTest/types/pathHelpers"
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
    promptIndex,
    className,
    ...props
}) => {
    const {messageConfigs} = usePlayground<{messageConfigs: MessageConfig[]}>({
        variantId,
        hookId: "PlaygroundConfigVariantPrompts",
        variantSelector: (variant) => {
            const messages = variant?.schema?.promptConfig?.[promptIndex]?.messages
            if (!messages) {
                return {messageConfigs: []}
            }

            return {
                messageConfigs: (Array.isArray(messages.value)
                    ? messages.value
                    : [messages.value]
                ).map((_, index) => ({
                    key: [messages.valueKey, index, variantId].join("-"),
                    variantId,
                    configKey: messages.configKey as Path<StateVariant>,
                    valueKey: `${messages.valueKey}.[${index}]` as Path<StateVariant>,
                })),
            }
        },
    })

    return (
        <div 
            className={clsx("flex flex-col gap-4", className)}
            {...props}
        >
            {(messageConfigs || []).map((messageConfig) => (
                <PromptMessageConfig
                    key={messageConfig.key}
                    variantId={messageConfig.variantId}
                    configKey={messageConfig.configKey}
                    valueKey={messageConfig.valueKey}
                />
            ))}
            <AddButton label="Message" />
        </div>
    )
}

export default PlaygroundVariantConfigPromptCollapseContent
