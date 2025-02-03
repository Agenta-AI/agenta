import {ButtonProps} from "antd"

export interface PromptFocusButtonProps extends ButtonProps {
    variantId: string
    label?: React.ReactNode
    icon?: boolean
    children?: React.ReactNode
}
