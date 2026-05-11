import {InputProps} from "antd"

export interface LabelInputProps extends Omit<InputProps, "type"> {
    label: string
    multiLine?: boolean
    type?: InputProps["type"]
    /** @deprecated Use `type` instead. */
    inputType?: InputProps["type"]
}
