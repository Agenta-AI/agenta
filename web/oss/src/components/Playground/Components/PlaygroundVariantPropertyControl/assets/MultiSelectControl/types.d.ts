import type {SelectProps} from "antd"

export interface SelectControlProps extends Omit<SelectProps, "onChange"> {
    label: string
    options: SelectProps["options"] | Record<string, string[]>
    withTooltip?: boolean
    description?: string
    onChange?: (value: string | string[]) => void
}

// Export Ant Design types for convenience
export type {SelectProps}
