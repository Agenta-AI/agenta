/**
 * Filter-menu metadata.
 *
 * The shapes the filter engine reads. Deliberately free of any rendering
 * dependency: `icon` is a slot the host fills with its own icon set (OSS uses
 * Phosphor, mobile uses Lucide), so the column table stays shareable.
 */
import type {ComponentType} from "react"

import type {Filter} from "../core/types"

export type IconSlot = ComponentType<{size?: number}>

export type CustomValueType = "string" | "number" | "boolean"

export type FilterItem = Filter & {
    selectedField?: string
    fieldType?: "string" | "number" | "exists"
    isCustomField?: boolean
    baseField?: string
    selectedLabel?: string
    customValueType?: CustomValueType
}

export interface RowValidation {
    isValid: boolean
    valueInvalid?: boolean
}

export interface ColumnOption {
    value: string
    label: string
    type?: string
    icon?: IconSlot
    children?: ColumnOption[]
}

export interface ColumnGroup {
    field: string
    label: string
    options: ColumnOption[]
}

export interface SelectOption {
    label: string
    value: string | number
    selectable?: boolean
    children?: SelectOption[]
    pathLabel?: string
}

export type InputConfig =
    | {kind: "text"; placeholder?: string}
    | {
          kind: "select"
          options?: SelectOption[]
          placeholder?: string
          usesAttributeKeyTree?: boolean
          treePath?: string
      }
    | {kind: "none"; display?: string}

export interface FilterLeaf {
    kind: "leaf"
    field: string
    value: string
    label: string
    type: "string" | "number" | "exists"
    icon?: IconSlot
    operatorOptions?: {value: Filter["operator"]; label: string}[]
    defaultValue?: Filter["value"]
    keyInput?: InputConfig
    valueInput?: InputConfig
    disableValueInput?: boolean
    valueDisplayText?: string
    displayLabel?: string
    optionKey?: string
    queryKey?: string
    referenceCategory?: string
    referenceProperty?: string
}

export interface FilterGroup {
    kind: "group"
    label: string
    children: (FilterLeaf | FilterGroup)[]
    icon?: IconSlot
    defaultValue?: string
    titleClickDisplayLabel?: string
    leafDisplayLabel?: string
}

export type FilterMenuNode = FilterLeaf | FilterGroup
