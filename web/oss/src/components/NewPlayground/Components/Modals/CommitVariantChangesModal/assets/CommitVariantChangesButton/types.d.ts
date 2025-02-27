import {ButtonProps} from "antd"

export interface CommitVariantChangesButtonProps extends ButtonProps {
    variantId: string
    label?: React.ReactNode
    icon?: boolean
    children?: React.ReactNode
}
