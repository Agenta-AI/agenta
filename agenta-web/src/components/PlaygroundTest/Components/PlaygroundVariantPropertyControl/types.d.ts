import {EnhancedVariant} from "../../betterTypes/types"
import type {Enhanced} from "../../betterTypes/types"
import type {PlaygroundVariantPropertyControlProps} from "./types"
import {BaseContainerProps} from "../types"
import type {PropertyMetadata} from "../../betterTypes/types"

/**
 * Props for the property control component
 */
export interface PlaygroundVariantPropertyControlProps extends BaseContainerProps {
    /** ID of the variant containing the property */
    variantId: EnhancedVariant["id"]
    /** Unique identifier for the property */
    propertyId: string
    /** Optional rendering variant for the control */
    as?: "SimpleDropdownSelect" | "PromptMessageContent"
}

export type ControlComponentType =
    | "SimpleDropdownSelect"
    | "MultiSelectControl"
    | "MinMaxControl"
    | "BooleanControl"
    | "PromptMessageContent"

// Common props that all control components might use
interface BaseControlProps {
    value: any
    onChange: (value: any) => void
    label?: string
    placeholder?: string
}

// Specific component prop types
export interface ControlComponents {
    SimpleDropdownSelect: BaseControlProps & {
        options: string[]
    }
    MultiSelectControl: BaseControlProps & {
        options: Array<{label: string; value: string}>
    }
    MinMaxControl: BaseControlProps & {
        min?: number
        max?: number
        step?: number
    }
    BooleanControl: BaseControlProps
    PromptMessageContent: BaseControlProps
}

// Re-export the component props type
export type {PlaygroundVariantPropertyControlProps}
