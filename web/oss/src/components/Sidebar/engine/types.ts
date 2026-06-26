import type {ComponentType} from "react"

import type {MenuProps} from "antd"
import type {PrimitiveAtom, WritableAtom} from "jotai"

export interface SidebarConfig {
    key: string
    title: string
    tooltip?: string
    link?: string
    icon: React.JSX.Element
    isHidden?: boolean
    submenu?: SidebarConfig[]
    defaultOpen?: boolean
    onClick?: (e: React.MouseEvent) => void
    tag?: string
    isCloudFeature?: boolean
    cloudFeatureTooltip?: string
    divider?: boolean
    disabled?: boolean
    dataTour?: string
    isDynamic?: boolean
    isLoading?: boolean
    isPlaceholder?: boolean
}

export interface SidebarMenuProps {
    items: SidebarConfig[]
    collapsed: boolean
    menuProps?: MenuProps
    mode?: "horizontal" | "vertical" | "inline"
    openKeys?: string[]
    onToggleOpenKey?: (key: string) => void
    onPopupOpenChange?: (key: string, open: boolean) => void
}

export type SidebarSelection =
    | {mode: "route"}
    | {mode: "controlled"; selectedKey: string; onSelect: (key: string) => void}

export interface SidebarSlotContext {
    collapsed: boolean
}

export type SidebarSlot = ComponentType<SidebarSlotContext>

export interface SidebarSection {
    key: string
    items: SidebarConfig[]
    before?: SidebarSlot
    dividerBefore?: boolean
    placement?: "top" | "bottom"
    mode?: SidebarMenuProps["mode"]
}

export interface SidebarScope {
    id: string
    useSelection: () => SidebarSelection
    useSections: () => SidebarSection[]
    header?: SidebarSlot
    footer?: SidebarSlot
}

export interface SidebarShellProps {
    collapsedAtom: PrimitiveAtom<boolean>
    currentPath?: string
    onPopupOpenChange?: (key: string, open: boolean) => void
    openGroupsAtomFamily: (scopeId: string) => WritableAtom<string[] | undefined, [string[]], void>
    scope: SidebarScope
    theme?: "light" | "dark"
}
