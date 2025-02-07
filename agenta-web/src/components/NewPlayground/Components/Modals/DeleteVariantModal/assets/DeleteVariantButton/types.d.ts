import {ButtonProps} from "antd"

export interface DeleteVariantButtonProps extends ButtonProps {
    variantId: string
    label?: React.ReactNode
    icon?: boolean
    children?: React.ReactNode
}
