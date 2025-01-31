import {ButtonProps} from "antd"

export interface GenerationFocusDrawerButtonProps extends ButtonProps {
    variantIds: string | string[]
    children?: React.ReactNode
    icon?: boolean
    rowId: string
}
