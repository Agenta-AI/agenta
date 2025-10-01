import type {ComponentType} from "react"

import type {IconProps} from "@phosphor-icons/react"

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
