import type {ComponentType} from "react"

import type {IconProps} from "@phosphor-icons/react"

export interface Props {
    filterData?: Filter[]
    columns: FilterMenuNode[]
    onApplyFilter: (filters: Filter[]) => void
    onClearFilter: (filters: Filter[]) => void
    buttonProps?: ButtonProps
}

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

export type FieldMenuItem = Required<MenuProps>["items"][number]

export interface ColumnOption {
    value: string
    label: string
    type?: string
    icon?: ComponentType<IconProps>
    children?: ColumnOption[]
}

export interface ColumnGroup {
    field: string
    label: string
    options: ColumnOption[]
}

export type IconType = ComponentType<{size?: number}>

type InputKind = "text" | "select" | "none"

export interface SelectOption {
    label: string
    value: string | number
    selectable?: boolean
    children?: SelectOption[]
    pathLabel?: string
}

type InputConfig =
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
    icon?: IconType
    operatorOptions?: {value: any; label: string}[]
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
    icon?: IconType
    defaultValue?: string
    titleClickDisplayLabel?: string
    leafDisplayLabel?: string
}
export type FilterMenuNode = FilterLeaf | FilterGroup
