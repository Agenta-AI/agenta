import {ReactNode} from "react"

import {DrawerProps} from "antd"

export interface GenericDrawerProps extends DrawerProps {
    expandable?: boolean
    headerExtra?: ReactNode
    mainContent: ReactNode
    extraContent?: ReactNode
    sideContent?: ReactNode
    initialWidth?: number
    externalKey?: string
    sideContentDefaultSize?: number
    mainContentDefaultSize?: number
    extraContentDefaultSize?: number
}
