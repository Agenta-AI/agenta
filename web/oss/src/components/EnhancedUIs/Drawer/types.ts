import {DrawerProps} from "antd"

export interface EnhancedDrawerProps extends DrawerProps {
    children: React.ReactNode
    closeOnLayoutClick?: boolean
}
