import {ButtonProps} from "antd"

export interface PromptComparisonFocusButtonProps extends ButtonProps {
    variantId: string
    label?: React.ReactNode
    icon?: boolean
    children?: React.ReactNode
}
