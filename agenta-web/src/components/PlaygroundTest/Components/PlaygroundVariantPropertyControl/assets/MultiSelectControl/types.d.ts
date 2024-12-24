import type {SelectProps} from "antd"

type BaseOption = {
    label: string
    value: string
}

export type GroupedOptions = {
    label: string
    options: BaseOption[]
}

export type Options = BaseOption[] | Record<string, string[]>

export interface SelectControlProps {
    mode?: SelectProps["mode"]
    label: string
    options: Options
    value?: string | string[]
    onChange?: (value: string | string[]) => void
}
