import type {
    ArrayMetadata,
    BooleanMetadata,
    CompoundMetadata,
    EnhancedConfigValue,
    NumberMetadata,
    ObjectMetadata,
    StringMetadata,
    Enhanced,
} from "../../assets/utilities/genericTransformer/types"
import type {EnhancedVariant} from "../../assets/utilities/transformer/types"
import type {BaseContainerProps} from "../types"
import type {PlaygroundVariantPropertyControlProps} from "./types"

/**
 * Props for the property control component
 */
export interface PlaygroundVariantPropertyControlProps extends BaseContainerProps {
    /** ID of the variant containing the property */
    variantId?: EnhancedVariant["id"]
    rowId?: string
    /** Unique identifier for the property */
    propertyId: string
    /** Optional rendering variant for the control */
    as?: "SimpleDropdownSelect" | "PromptMessageContent"
    view?: string
    withTooltip?: boolean
    placeholder?: string
    disabled?: boolean
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

export type PropertyTypeMap = {
    string: {type: "string"; metadata: StringMetadata}
    number: {type: "number"; metadata: NumberMetadata}
    boolean: {type: "boolean"; metadata: BooleanMetadata}
    array: {
        type: "array"
        metadata: ArrayMetadata
        value: EnhancedConfigValue<any>[]
    }
    object: {type: "object"; metadata: ObjectMetadata}
    compound: {type: "compound"; metadata: CompoundMetadata}
}

export type RenderFunctions = {
    [K in keyof PropertyTypeMap]: (props: {
        metadata: PropertyTypeMap[K]["metadata"]
        value: any
        handleChange: (v: any) => void
        as?: string
        className?: string
        view?: string
        withTooltip?: boolean
        placeholder?: string
        disabled?: boolean
    }) => React.ReactElement | null
}

export type ArrayItemValue =
    | {__metadata: StringMetadata; value: string}
    | {__metadata: NumberMetadata; value: number}
    | {__metadata: BooleanMetadata; value: boolean}
    | {__metadata: ObjectMetadata; value: Record<string, unknown>}
    | {__metadata: CompoundMetadata; value: string}
