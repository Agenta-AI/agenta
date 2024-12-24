import {BaseContainerProps} from "../types"
import {StateVariant} from "../../state/types"
import {Path} from "../../types/pathHelpers"

/**
 * Props for the prompt message configuration component.
 * This component handles the configuration of individual prompt messages
 * including their roles and content.
 */
export interface PromptMessageConfigProps extends BaseContainerProps {
    /** Unique identifier for the variant being configured */
    variantId: StateVariant["variantId"]
    /**
     * Path to the configuration object in variant state.
     * Used to access the schema and configuration settings.
     */
    configKey: Path<StateVariant>
    /**
     * Path to the value in variant state.
     * Used to access and modify the actual message data.
     */
    valueKey: Path<StateVariant>
}
