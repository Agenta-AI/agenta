import {type CollapseProps} from "antd"
import {StateVariant} from "@/components/PlaygroundTest/state/types"
import {Path} from "@/components/PlaygroundTest/types/pathHelpers"
import {BaseContainerProps} from "../types"

export interface PlaygroundVariantConfigPromptComponentProps extends CollapseProps {
    /** Unique identifier for the variant being configured */
    variantId: string
    /** Index of the prompt in the variant's prompt configuration array */
    promptIndex: number
}

/** Configuration for a single message within a prompt */
export interface MessageConfig {
    /** Unique key for the message configuration */
    key: string
    /** ID of the variant this message belongs to */
    variantId: string
    /** Path to the configuration object in the variant state */
    configKey: Path<StateVariant>
    /** Path to the value in the variant state */
    valueKey: Path<StateVariant>
}

/**
 * Props for the collapse content component that manages prompt message configurations
 */
export interface PromptCollapseContentProps extends BaseContainerProps {
    /** ID of the variant being configured */
    variantId: StateVariant["variantId"]
    /** Index of the prompt in the configuration array */
    promptIndex: number
}

/**
 * Props for the prompt configuration collapse header component
 */
export interface PromptCollapseHeaderProps extends BaseContainerProps {
    /** Index of the prompt in the configuration */
    promptIndex: number
    /** ID of the variant being configured */
    variantId: string
}
