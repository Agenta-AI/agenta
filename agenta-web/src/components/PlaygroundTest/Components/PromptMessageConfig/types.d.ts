import {BaseContainerProps} from "../types"
import {EnhancedVariant} from "../../betterTypes/types"

/**
 * Props for the prompt message configuration component.
 * This component handles the configuration of individual prompt messages
 * including their roles and content.
 */
export interface PromptMessageConfigProps extends BaseContainerProps {
    /** Unique identifier for the variant being configured */
    variantId: EnhancedVariant["id"]
    /** Unique identifier for the message being configured */
    messageId: string
}
