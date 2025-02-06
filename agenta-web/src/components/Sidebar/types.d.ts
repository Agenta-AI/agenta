import {type Menu} from "antd"

export type SidebarConfig = {
    key: string
    title: string
    tooltip?: string
    link?: string
    icon: JSX.Element
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

export type SidebarMenuProps = {
    items: SidebarConfig[]
    collapsed: boolean
    menuProps?: React.ComponentProps<typeof Menu>
    mode?: "horizontal" | "vertical" | "inline"
}
