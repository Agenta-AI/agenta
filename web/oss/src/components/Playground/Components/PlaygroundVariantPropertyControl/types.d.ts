import type {
    ArrayMetadata,
    BooleanMetadata,
    CompoundMetadata,
    EnhancedConfigValue,
    NumberMetadata,
    ObjectMetadata,
    StringMetadata,
    ConfigMetadata,
    EnhancedObjectConfig,
} from "../../../../lib/shared/variant/genericTransformer/types"
import type {EnhancedVariant} from "../../../../lib/shared/variant/transformer/types"
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
    as?: "SimpleDropdownSelect" | "PromptMessageContent" | "SimpleInput"
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
        options: {label: string; value: string}[]
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

export interface PropertyTypeMap {
    string: {type: "string"; metadata: StringMetadata}
    number: {type: "number"; metadata: NumberMetadata}
    boolean: {type: "boolean"; metadata: BooleanMetadata}
    array: {
        type: "array"
        metadata: ArrayMetadata<ConfigMetadata>
        value: EnhancedConfigValue<any>[]
    }
    object: {type: "object"; metadata: ObjectMetadata}
    compound: {type: "compound"; metadata: CompoundMetadata}
}

export type RenderFunctions = {
    [K in keyof PropertyTypeMap]: (props: {
        metadata: PropertyTypeMap[K]["metadata"]
        value: any
        handleChange: (v: any, event?: any, propertyId?: string) => void
        as?: string
        className?: string
        view?: string
        withTooltip?: boolean
        placeholder?: string
        disabled?: boolean
        baseProperty?: EnhancedObjectConfig<any>
        allowClear?: boolean
        disableClear?: boolean
        mode?: "multiple" | "tags"
    }) => React.ReactElement | null
}

export type ArrayItemValue =
    | {__metadata: StringMetadata; value: string}
    | {__metadata: NumberMetadata; value: number}
    | {__metadata: BooleanMetadata; value: boolean}
    | {__metadata: ObjectMetadata; value: Record<string, unknown>}
    | {__metadata: CompoundMetadata; value: string}
