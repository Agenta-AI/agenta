import type {ReactNode} from "react"

import {ButtonProps} from "antd"

export interface LoadTestsetButtonProps extends ButtonProps {
    label?: ReactNode
    icon?: boolean
    children?: ReactNode
    variantId?: string
}
