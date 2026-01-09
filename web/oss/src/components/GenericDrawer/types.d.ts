import {ReactNode} from "react"

import {ButtonProps, DrawerProps} from "antd"

export interface GenericDrawerProps extends DrawerProps {
    expandable?: boolean
    expandButtonProps?: ButtonProps
    headerExtra?: ReactNode
    mainContent: ReactNode
    extraContent?: ReactNode
    sideContent?: ReactNode
    initialWidth?: number
    externalKey?: string
    sideContentDefaultSize?: number
    mainContentDefaultSize?: number
    extraContentDefaultSize?: number
    closeOnLayoutClick?: boolean
    closeButtonProps?: ButtonProps
}
