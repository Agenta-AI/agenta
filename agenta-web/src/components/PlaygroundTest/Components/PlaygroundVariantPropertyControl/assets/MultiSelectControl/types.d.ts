import {BaseOption, OptionGroup} from "../../../../betterTypes/baseTypes"
import type {SelectProps} from "antd"

export type GroupedOptions = OptionGroup

export type Options = BaseOption[] | Record<string, string[]>

export interface SelectControlProps {
    mode?: SelectProps["mode"]
    label: string
    options: Options
    value?: string | string[]
    onChange?: (value: string | string[]) => void
}
