import clsx from "clsx"
import PlaygroundVariantPropertyControl from "../PlaygroundVariantPropertyControl"
import type {PromptMessageConfigProps} from "./types"
import type {StateVariant} from "../../state/types"
import type {Path} from "../../types/pathHelpers"

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
 * @param props.configKey - Path to the configuration object in variant state
 * @param props.valueKey - Path to the value in variant state
 */
const PromptMessageConfig = ({
    variantId,
    configKey,
    valueKey,
    className,
    ...props
}: PromptMessageConfigProps) => {
    console.log(
        "usePlayground[%cComponent%c] - PromptMessageConfig - RENDER!",
        "color: orange",
        "",
        variantId,
        configKey,
        valueKey,
    )

    return (
        <div
            className={clsx(
                "relative border-solid border border-[#bdc7d1] rounded-[theme(spacing.2)]",
                className,
            )}
            {...props}
        >
            <PlaygroundVariantPropertyControl
                configKey={`${configKey}.role` as Path<StateVariant>}
                valueKey={`${valueKey}.role` as Path<StateVariant>}
                variantId={variantId}
                as="SimpleDropdownSelect"
            />
            <PlaygroundVariantPropertyControl
                configKey={`${configKey}.content` as Path<StateVariant>}
                valueKey={`${valueKey}.content` as Path<StateVariant>}
                variantId={variantId}
                as="PromptMessageContent"
            />
        </div>
    )
}

export default PromptMessageConfig
