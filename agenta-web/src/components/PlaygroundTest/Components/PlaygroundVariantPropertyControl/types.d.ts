import type {StateVariant} from "../../state/types"
import type {Path} from "../../types/pathHelpers"
import type {SchemaObject} from "../../types/shared"

export interface PlaygroundVariantPropertyControlProps {
    configKey: Path<StateVariant>
    valueKey: Path<StateVariant>
    variantId: string
    as?: ControlComponentType
}

export type PropertyConfig = SchemaObject

export interface PropertyData {
    config: SchemaObject
    valueInfo: unknown
    handleChange: (e: {target: {value: ConfigValue}} | ConfigValue) => void
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
