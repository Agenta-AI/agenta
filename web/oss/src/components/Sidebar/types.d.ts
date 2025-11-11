import {type Menu} from "antd"

export interface SidebarConfig {
    key: string
    title: string
    tooltip?: string
    link?: string
    icon: React.JSX.Element
    isHidden?: boolean
    isBottom?: boolean
    submenu?: Omit<SidebarConfig, "submenu">[]
    onClick?: () => void
    tag?: string
    isCloudFeature?: boolean
    cloudFeatureTooltip?: string
    divider?: boolean
    header?: boolean
}

export interface SidebarMenuProps {
    items: SidebarConfig[]
    collapsed: boolean
    menuProps?: React.ComponentProps<typeof Menu>
    mode?: "horizontal" | "vertical" | "inline"
}
