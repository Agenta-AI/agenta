import {MenuProps} from "antd"

export interface SidebarConfig {
    key: string
    title: string
    tooltip?: string
    link?: string
    icon: React.JSX.Element
    isHidden?: boolean
    isBottom?: boolean
    submenu?: Omit<SidebarConfig, "submenu">[]
    onClick?: (e: React.MouseEvent) => void
    tag?: string
    isCloudFeature?: boolean
    cloudFeatureTooltip?: string
    divider?: boolean
    header?: boolean
    disabled?: boolean
    danger?: boolean
}

export interface SidebarMenuProps {
    items: SidebarConfig[]
    collapsed: boolean
    menuProps?: MenuProps
    mode?: "horizontal" | "vertical" | "inline"
}
