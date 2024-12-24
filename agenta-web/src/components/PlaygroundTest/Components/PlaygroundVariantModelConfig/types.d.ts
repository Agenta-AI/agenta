import {BaseContainerProps} from "../types"
import {StateVariant} from "../../state/types"
import {Path} from "../../types/pathHelpers"

/** Property configuration for model parameters */
export interface ModelConfigProperty {
    /** Unique key for property identification */
    key: string
    /** Path to property configuration in variant state */
    configKey: Path<StateVariant>
    /** Path to property value in variant state */
    valueKey: Path<StateVariant>
}

/**
 * Props for the model configuration modal component.
 * Handles the configuration interface for model-specific parameters.
 */
export interface PlaygroundVariantModelConfigModalProps extends BaseContainerProps {
    /** ID of the variant being configured */
    variantId: StateVariant["variantId"]
    /** List of configurable model properties */
    properties: ModelConfigProperty[]
    /** Handler for saving configuration changes */
    handleSave: () => void
    /** Handler for closing the modal */
    handleClose: () => void
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
export interface PlaygroundVariantModelConfigProps extends BaseContainerProps {
    /** ID of the variant being configured */
    variantId: StateVariant["variantId"]
    /** Index of the prompt in configuration array */
    promptIndex: number
}

export interface PlaygroundVariantModelConfigTitleProps extends BaseContainerProps {
    /** Title for the model configuration modal */
    handleReset: () => void
}
