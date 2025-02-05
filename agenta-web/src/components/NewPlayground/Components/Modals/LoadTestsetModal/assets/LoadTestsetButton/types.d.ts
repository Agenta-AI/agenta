import {ButtonProps} from "antd"

export interface LoadTestsetButtonProps extends ButtonProps {
    label?: React.ReactNode
    icon?: boolean
    children?: React.ReactNode
    variantId?: string
}
