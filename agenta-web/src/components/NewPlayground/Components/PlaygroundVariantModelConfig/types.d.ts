import type {PopoverProps} from "antd"

import type {EnhancedVariant} from "../../assets/utilities/transformer/types"
import type {BaseContainerProps} from "../types"

/** Property configuration for model parameters */
export interface ModelConfigProperty {
    /** Unique key for property identification */
    key: string
}

/**
 * Props for the model configuration modal component.
 * Handles the configuration interface for model-specific parameters.
 */
export interface PlaygroundVariantModelConfigModalProps extends BaseContainerProps {
    /** ID of the variant being configured */
    variantId: EnhancedVariant["id"]
    /** List of configurable model properties */
    propertyIds: string[]
}

/**
 * Props for the modal actions component
 */
export interface ModelConfigModalActionsProps extends BaseContainerProps {
    /** Handler for saving changes */
    handleSave: () => void
    /** Handler for closing/canceling */
    handleClose: () => void
}

/**
 * Props for the modal content wrapper component
 */
export interface ModelConfigModalContentProps extends BaseContainerProps {
    /** Content elements to be rendered inside the modal */
    children: React.ReactNode
}

/**
 * Props for the main model configuration component.
 * Controls the model settings interface including the modal toggle.
 */
export interface PlaygroundVariantModelConfigProps extends PopoverProps {
    /** ID of the variant being configured */
    variantId: EnhancedVariant["id"]
    /** ID of the prompt being configured */
    promptId: EnhancedVariant["prompts"][number]["id"]
}

export interface PlaygroundVariantModelConfigTitleProps extends BaseContainerProps {
    /** Title for the model configuration modal */
    handleReset: () => void
}
